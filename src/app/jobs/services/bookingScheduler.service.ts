import { bookingNotificationQueue, appointmentLifecycleQueue } from '../queues/bookingQueue';
import { redis } from '../../../helpars/redisServer';
import { BookingStatus } from '@prisma/client';
import prisma from '../../../shared/prisma';

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
const PENDING_TIMEOUT_GRACE_MINUTES = 30;

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
  endTime: string;
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
 * 🌍 IMPORTANT: All times are UTC. consultDate is stored as UTC from DB,
 * startTime is interpreted as UTC HH:MM format.
 */
function calculateDelay(consultDate: Date, startTime: string, hoursBeforeAppointment: number): number {
  const [hours, minutes] = startTime.split(':').map(Number);
  const appointmentDateTime = new Date(consultDate);
  // Use setUTCHours() to ensure UTC timezone is applied
  appointmentDateTime.setUTCHours(hours, minutes, 0, 0);

  const notificationTime = new Date(
    appointmentDateTime.getTime() - hoursBeforeAppointment * 60 * 60 * 1000
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

function calculatePendingTimeoutAt(consultDate: Date, endTime: string): Date {
  const { hours, minutes, seconds } = parseTimeParts(endTime);

  // Use UTC methods so the calculation is timezone-agnostic.
  // 🌍 CRITICAL UTC LOGIC:
  // - consultDate from DB is stored as UTC midnight (00:00:00 UTC)
  // - endTime is stored as HH:MM:SS in UTC format (from doctor's working slot)
  // - We calculate the slot end moment in UTC by setting UTC hours/minutes/seconds
  // - This ensures the timeout fires at the correct UTC moment regardless of server timezone
  const slotEndAt = new Date(consultDate);
  slotEndAt.setUTCHours(hours, minutes, seconds, 0);

  // If applying the time lands at or before midnight UTC of the same day (e.g. endTime = '00:00:00'),
  // advance by one day to avoid an instant or negative delay.
  const midnightUTC = new Date(consultDate);
  midnightUTC.setUTCHours(0, 0, 0, 0);
  if (slotEndAt.getTime() <= midnightUTC.getTime()) {
    slotEndAt.setUTCDate(slotEndAt.getUTCDate() + 1);
  }

  return new Date(slotEndAt.getTime() + PENDING_TIMEOUT_GRACE_MINUTES * 60 * 1000);
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
    const delay24Hours = calculateDelay(new Date(consultDate), startTime, 24);
    const delay3Hours = calculateDelay(new Date(consultDate), startTime, 3);
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
// Fires 30 minutes after the working slot endTime. If still PENDING -> NOT_UPDATED + refund patient.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schedule a delayed job that fires 30 minutes after the appointment slot endTime.
 * If the clinic has not accepted/rejected by then, the job marks the booking
 * as NOT_UPDATED and refunds the patient's service fee.
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
    endTime,
  } = params;

  try {
    const now = Date.now();
    const pendingTimeoutAt = calculatePendingTimeoutAt(new Date(consultDate), endTime);
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
        endTime,
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
      `(fires in ${Math.round(delay / 1000 / 60)} min, 30 min after slot endTime ${endTime})`
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

/**
 * Schedule a delayed job that fires 30 minutes after the doctor's WorkingSlot
 * endTime on the consultDate (same pattern as PENDING_TIMEOUT).
 * If the clinic still has not updated the visit status by then,
 * the job auto-closes the appointment and the admin keeps all funds.
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
    // Reuse calculatePendingTimeoutAt: slot endTime + 30 minutes on the consultDate
    const fireAt = calculatePendingTimeoutAt(new Date(consultDate), endTime);
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
            endTime: booking.endTime!,
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
