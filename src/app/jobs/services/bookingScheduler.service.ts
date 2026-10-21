import { bookingNotificationQueue, appointmentLifecycleQueue } from '../queues/bookingQueue';
import { redis } from '../../../helpars/redisServer';
import { BookingStatus } from '@prisma/client';
import prisma from '../../../shared/prisma';
import { getAppointmentStartUTC, DEFAULT_CLINIC_TIMEZONE } from '../../../utils/timezoneHelper';

/**
 * 🌍 CRITICAL UTC NOTE:
 * All time calculations in this service use UTC. No local timezone conversions are applied.
 * - consultDate from DB is UTC midnight (00:00:00 UTC) of the appointment day
 * - startTime/endTime are UTC HH:MM:SS format strings
 * - All Date methods use setUTCHours(), setUTCMinutes(), setUTCDate(), etc.
 * - Delays are calculated from Date.now() (which is always UTC-based)
 * - Jobs are scheduled using these UTC calculations
 * 
 * For detailed standards, see docs/UTC_STANDARDS.md
 */

const REDIS_BOOKING_PREFIX = 'booking:scheduled:';
const REDIS_PENDING_TIMEOUT_PREFIX = 'booking:pending-timeout:';
const REDIS_CONFIRMED_TIMEOUT_PREFIX = 'booking:confirmed-timeout:';

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

interface ScheduleNotificationParams {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  consultDate: Date;
  startTime: string;
  endTime: string;
  status: BookingStatus;
}

interface SchedulePendingTimeoutParams {
  appointmentId: string;
  patientId: string;        // Patient.id
  patientUserId: string;    // User.id of patient
  clinicUserId: string;     // User.id of clinic
  adminUserId: string;      // User.id of admin
  patientServiceFee: number;
  deadlineTime: string;
  consultDate: Date;        // Appointment date/time — job fires at this moment
}

interface ScheduleConfirmedTimeoutParams {
  appointmentId: string;
  patientId: string;        // Patient.id
  clinicId: string;         // Clinic.id
  clinicUserId: string;     // User.id of clinic
  adminUserId: string;      // User.id of admin
  patientServiceFee: number;
  clinicServiceFee: number;
  consultDate: Date;        // Appointment date
  endTime: string;          // Doctor's WorkingSlot endTime — job fires 30 min after this
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate delay in ms for notification reminders (X hours before appointment).
 * Deadlines are computed against the clinic's local IANA timezone without hardcoded offsets.
 */
function calculateDelay(
  consultDate: Date,
  startTime: string,
  hoursBeforeAppointment: number,
  timeZone: string = DEFAULT_CLINIC_TIMEZONE
): number {
  const appointmentUTC = getAppointmentStartUTC(consultDate, startTime, timeZone);
  const notificationTime = new Date(
    appointmentUTC.getTime() - hoursBeforeAppointment * 60 * 60 * 1000
  );

  const delay = notificationTime.getTime() - Date.now();
  return Math.max(0, delay);
}

function buildBullJobId(...parts: string[]): string {
  return parts.map((part) => part.replace(/:/g, '-')).join('-');
}

function parseTimeParts(time: string): { hours: number; minutes: number; seconds: number } {
  const [hoursPart, minutesPart, secondsPart = '0'] = time.split('.')[0].split(':');
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  const seconds = Number(secondsPart);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    throw new Error(`Invalid time format: ${time}`);
  }

  return { hours, minutes, seconds };
}

function calculatePendingTimeoutAt(
  consultDate: Date,
  deadlineTime: string,
  timeZone: string = DEFAULT_CLINIC_TIMEZONE
): Date {
  // Clinic response closes at the start of the working period.
  return getAppointmentStartUTC(consultDate, deadlineTime, timeZone);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXISTING: Reminder notifications (24h / 3h before appointment)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schedule 24h and 3h reminder notifications for a CONFIRMED booking.
 */
export async function scheduleBookingNotifications(
  params: ScheduleNotificationParams
): Promise<void> {
  const { appointmentId, patientId, doctorId, clinicId, consultDate, startTime, endTime, status } = params;

  if (status !== BookingStatus.CONFIRMED) {
    console.log(`⚠️ Appointment ${appointmentId} is not confirmed, skipping reminder scheduling`);
    return;
  }

  try {
    let timeZone = DEFAULT_CLINIC_TIMEZONE;
    if (clinicId) {
      const clinic = await prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { timezone: true },
      });
      if (clinic?.timezone) {
        timeZone = clinic.timezone;
      }
    }

    const delay24Hours = calculateDelay(new Date(consultDate), startTime, 24, timeZone);
    const delay3Hours = calculateDelay(new Date(consultDate), startTime, 3, timeZone);
    const jobIds: string[] = [];

    if (delay24Hours > 0) {
      const job24h = await bookingNotificationQueue.add(
        '24-hour-reminder',
        { appointmentId, patientId, doctorId, clinicId, consultDate: new Date(consultDate), startTime, endTime, notificationType: '24_HOUR' },
        { delay: delay24Hours, jobId: buildBullJobId(appointmentId, '24h') }
      );
      jobIds.push(job24h.id!);
      console.log(`📅 Scheduled 24h reminder for ${appointmentId} (delay: ${Math.round(delay24Hours / 1000 / 60)} min)`);
    }

    if (delay3Hours > 0) {
      const job3h = await bookingNotificationQueue.add(
        '3-hour-reminder',
        { appointmentId, patientId, doctorId, clinicId, consultDate: new Date(consultDate), startTime, endTime, notificationType: '3_HOUR' },
        { delay: delay3Hours, jobId: buildBullJobId(appointmentId, '3h') }
      );
      jobIds.push(job3h.id!);
      console.log(`📅 Scheduled 3h reminder for ${appointmentId} (delay: ${Math.round(delay3Hours / 1000 / 60)} min)`);
    }

    if (jobIds.length > 0) {
      await redis.set(
        `${REDIS_BOOKING_PREFIX}${appointmentId}`,
        JSON.stringify(jobIds),
        'EX',
        7 * 24 * 60 * 60
      );
    }
  } catch (error) {
    console.error(`Error scheduling reminders for ${appointmentId}:`, error);
    throw error;
  }
}

/**
 * Cancel scheduled reminder notifications for a booking.
 */
export async function cancelBookingNotifications(appointmentId: string): Promise<void> {
  try {
    const jobIdsJson = await redis.get(`${REDIS_BOOKING_PREFIX}${appointmentId}`);

    if (!jobIdsJson) {
      console.log(`⚠️ No scheduled reminders found for ${appointmentId}`);
      return;
    }

    const jobIds: string[] = JSON.parse(jobIdsJson);

    await Promise.all(
      jobIds.map(async (jobId) => {
        try {
          const job = await bookingNotificationQueue.getJob(jobId);
          if (job) {
            await job.remove();
            console.log(`🗑️ Removed reminder job ${jobId} for ${appointmentId}`);
          }
        } catch (error) {
          console.error(`Error removing reminder job ${jobId}:`, error);
        }
      })
    );

    await redis.del(`${REDIS_BOOKING_PREFIX}${appointmentId}`);
    console.log(`✅ Cancelled all reminders for ${appointmentId}`);
  } catch (error) {
    console.error(`Error cancelling reminders for ${appointmentId}:`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 2: Pending booking timeout
// Fires at the working period start. If still PENDING -> auto-reject and release the full hold.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schedule a delayed job at the clinic-local start of the appointment period.
 * If the clinic has not accepted/rejected by then, the job marks the booking
 * as NOT_UPDATED and releases the patient's held amount before confirmation.
 */
export async function schedulePendingBookingTimeout(
  params: SchedulePendingTimeoutParams
): Promise<void> {
  const {
    appointmentId,
    patientId,
    patientUserId,
    clinicUserId,
    adminUserId,
    patientServiceFee,
    consultDate,
    deadlineTime,
  } = params;

  try {
    const now = Date.now();
    let timeZone = DEFAULT_CLINIC_TIMEZONE;
    if (appointmentId) {
      const appt = await prisma.bookingAppointment.findUnique({
        where: { id: appointmentId },
        select: { clinic: { select: { timezone: true } } },
      });
      if (appt?.clinic?.timezone) {
        timeZone = appt.clinic.timezone;
      }
    }

    const pendingTimeoutAt = calculatePendingTimeoutAt(new Date(consultDate), deadlineTime, timeZone);
    const delay = Math.max(0, pendingTimeoutAt.getTime() - now);
    const jobId = buildBullJobId(appointmentId, 'pending-timeout');
    const previousJobId = await redis.get(`${REDIS_PENDING_TIMEOUT_PREFIX}${appointmentId}`);
    const existingJob = await appointmentLifecycleQueue.getJob(previousJobId || jobId);

    if (existingJob) {
      await existingJob.remove();
    }

    const job = await appointmentLifecycleQueue.add(
      'PENDING_TIMEOUT',
      {
        appointmentId,
        patientId,
        patientUserId,
        clinicUserId,
        adminUserId,
        patientServiceFee,
        consultDate: new Date(consultDate),
        deadlineTime,
        pendingTimeoutAt,
      },
      {
        delay,
        jobId,
      }
    );

    await redis.set(
      `${REDIS_PENDING_TIMEOUT_PREFIX}${appointmentId}`,
      job.id!,
      'EX',
      14 * 24 * 60 * 60 // 14 days
    );

    console.log(
      `⏳ Scheduled PENDING_TIMEOUT for ${appointmentId} ` +
      `(fires in ${Math.round(delay / 1000 / 60)} min at period start ${deadlineTime})`
    );
  } catch (error) {
    console.error(`Error scheduling pending timeout for ${appointmentId}:`, error);
    throw error;
  }
}

/**
 * Cancel a pending booking timeout job (call when clinic accepts or rejects).
 */
export async function cancelPendingBookingTimeout(appointmentId: string): Promise<void> {
  try {
    const jobId =
      (await redis.get(`${REDIS_PENDING_TIMEOUT_PREFIX}${appointmentId}`)) ||
      buildBullJobId(appointmentId, 'pending-timeout');

    if (!jobId) {
      console.log(`⚠️ No pending timeout job found for ${appointmentId}`);
      return;
    }

    const job = await appointmentLifecycleQueue.getJob(jobId);
    if (job) {
      await job.remove();
      console.log(`🗑️ Cancelled PENDING_TIMEOUT job for ${appointmentId}`);
    }

    await redis.del(`${REDIS_PENDING_TIMEOUT_PREFIX}${appointmentId}`);
  } catch (error) {
    console.error(`Error cancelling pending timeout for ${appointmentId}:`, error);
    // Non-fatal — log and continue
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 4: Confirmed booking timeout (no-show / visit status not updated)
// Fires 30 minutes after the doctor's WorkingSlot endTime on the consultDate.
// If still CONFIRMED/INPROGRESS → NOT_SHOW. Admin keeps all fees.
// ─────────────────────────────────────────────────────────────────────────────

function calculateConfirmedTimeoutAt(
  consultDate: Date,
  endTime: string,
  timeZone: string = DEFAULT_CLINIC_TIMEZONE
): Date {
  const slotEndAt = getAppointmentStartUTC(consultDate, endTime, timeZone);
  // 🌍 Section 5: Unresolved confirmed appointment auto-settles 12 hours after period end
  return new Date(slotEndAt.getTime() + 12 * 60 * 60 * 1000);
}

/**
 * Schedule a delayed job that fires 12 hours after the doctor's WorkingSlot
 * endTime on the consultDate (Section 5 Auto-Settle rule).
 */
export async function scheduleConfirmedBookingTimeout(
  params: ScheduleConfirmedTimeoutParams
): Promise<void> {
  const {
    appointmentId,
    patientId,
    clinicId,
    clinicUserId,
    adminUserId,
    patientServiceFee,
    clinicServiceFee,
    consultDate,
    endTime,
  } = params;

  try {
    const now = Date.now();
    let timeZone = DEFAULT_CLINIC_TIMEZONE;
    if (clinicId) {
      const clinic = await prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { timezone: true },
      });
      if (clinic?.timezone) {
        timeZone = clinic.timezone;
      }
    }

    const fireAt = calculateConfirmedTimeoutAt(new Date(consultDate), endTime, timeZone);
    const delay = Math.max(0, fireAt.getTime() - now);

    const jobId = buildBullJobId(appointmentId, 'confirmed-timeout');
    // Remove any previously scheduled job for this appointment before adding a new one
    const previousJobId = await redis.get(`${REDIS_CONFIRMED_TIMEOUT_PREFIX}${appointmentId}`);
    const existingJob = await appointmentLifecycleQueue.getJob(previousJobId || jobId);
    if (existingJob) {
      await existingJob.remove();
    }

    const job = await appointmentLifecycleQueue.add(
      'CONFIRMED_TIMEOUT',
      {
        appointmentId,
        patientId,
        clinicId,
        clinicUserId,
        adminUserId,
        patientServiceFee,
        clinicServiceFee,
        consultDate: new Date(consultDate),
        endTime,
      },
      {
        delay,
        jobId,
      }
    );

    await redis.set(
      `${REDIS_CONFIRMED_TIMEOUT_PREFIX}${appointmentId}`,
      job.id!,
      'EX',
      30 * 24 * 60 * 60 // 30 days
    );

    console.log(
      `⏳ Scheduled CONFIRMED_TIMEOUT for ${appointmentId} ` +
      `(fires in ${Math.round(delay / 1000 / 60)} min — 30 min after slot endTime ${endTime})`
    );
  } catch (error) {
    console.error(`Error scheduling confirmed timeout for ${appointmentId}:`, error);
    throw error;
  }
}

/**
 * Cancel a confirmed booking timeout job (call if clinic updates status before 8h window).
 */
export async function cancelConfirmedBookingTimeout(appointmentId: string): Promise<void> {
  try {
    const jobId = await redis.get(`${REDIS_CONFIRMED_TIMEOUT_PREFIX}${appointmentId}`);

    if (!jobId) {
      console.log(`⚠️ No confirmed timeout job found for ${appointmentId}`);
      return;
    }

    const job = await appointmentLifecycleQueue.getJob(jobId);
    if (job) {
      await job.remove();
      console.log(`🗑️ Cancelled CONFIRMED_TIMEOUT job for ${appointmentId}`);
    }

    await redis.del(`${REDIS_CONFIRMED_TIMEOUT_PREFIX}${appointmentId}`);
  } catch (error) {
    console.error(`Error cancelling confirmed timeout for ${appointmentId}:`, error);
    // Non-fatal — log and continue
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clean up expired bookings from Redis (called from cron).
 */
export async function cleanupExpiredBookings(): Promise<void> {
  try {
    const keys = await redis.keys(`${REDIS_BOOKING_PREFIX}*`);
    console.log(`🧹 Redis has ${keys.length} booking reminder entries`);
  } catch (error) {
    console.error('Error cleaning up expired bookings:', error);
  }
}

/**
 * Rebuild active lifecycle jobs after deploy/restart.
 * This repairs appointments whose BullMQ jobs failed before the jobId format fix.
 */
export async function repairActiveLifecycleJobs(): Promise<void> {
  try {
    const adminUser = await prisma.user.findUnique({
      where: { phoneNumber: `${process.env.ADMIN_PHONE_NUMBER}` },
      select: { id: true },
    });

    if (!adminUser) {
      console.log('Skipping lifecycle job repair: admin user not found');
      return;
    }

    const bookings = await prisma.bookingAppointment.findMany({
      where: {
        status: {
          in: [
            BookingStatus.PENDING,
            BookingStatus.CONFIRMED,
            BookingStatus.INPROGRESS,
          ],
        },
      },
      select: {
        id: true,
        patientId: true,
        doctorId: true,
        clinicId: true,
        consultDate: true,
        startTime: true,
        endTime: true,
        status: true,
        patientServiceFee: true,
        clinicServiceFee: true,
        patient: {
          select: {
            userId: true,
          },
        },
        clinic: {
          select: {
            id: true,
            userId: true,
          },
        },
      },
    });

    let repairedCount = 0;

    for (const booking of bookings) {
      try {
        if (booking.status === BookingStatus.PENDING) {
          await schedulePendingBookingTimeout({
            appointmentId: booking.id,
            patientId: booking.patientId,
            patientUserId: booking.patient.userId,
            clinicUserId: booking.clinic.userId,
            adminUserId: adminUser.id,
            patientServiceFee: booking.patientServiceFee,
            consultDate: booking.consultDate,
            deadlineTime: booking.startTime!,
          });
          repairedCount += 1;
          continue;
        }

        await scheduleConfirmedBookingTimeout({
          appointmentId: booking.id,
          patientId: booking.patientId,
          clinicId: booking.clinic.id,
          clinicUserId: booking.clinic.userId,
          adminUserId: adminUser.id,
          patientServiceFee: booking.patientServiceFee,
          clinicServiceFee: booking.clinicServiceFee,
          consultDate: booking.consultDate,
          endTime: booking.endTime!,
        });
        repairedCount += 1;

        if (
          booking.status === BookingStatus.CONFIRMED &&
          booking.startTime &&
          booking.endTime
        ) {
          await scheduleBookingNotifications({
            appointmentId: booking.id,
            patientId: booking.patientId,
            doctorId: booking.doctorId,
            clinicId: booking.clinicId,
            consultDate: booking.consultDate,
            startTime: booking.startTime,
            endTime: booking.endTime,
            status: booking.status,
          });
        }
      } catch (error) {
        console.error(`Failed to repair lifecycle jobs for ${booking.id}:`, error);
      }
    }

    console.log(`Lifecycle job repair completed for ${repairedCount} active bookings`);
  } catch (error) {
    console.error('Error repairing active lifecycle jobs:', error);
  }
}

export const BookingSchedulerService = {
  scheduleBookingNotifications,
  cancelBookingNotifications,
  schedulePendingBookingTimeout,
  cancelPendingBookingTimeout,
  scheduleConfirmedBookingTimeout,
  cancelConfirmedBookingTimeout,
  cleanupExpiredBookings,
  repairActiveLifecycleJobs,
};
