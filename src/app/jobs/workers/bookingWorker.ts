import { Worker, Job } from 'bullmq';
import { redis } from '../../../helpars/redisServer';
import {
  BookingNotificationJobData,
  PendingBookingTimeoutJobData,
  ConfirmedBookingTimeoutJobData,
} from '../queues/bookingQueue';
import prisma from '../../../shared/prisma';
import { BookingStatus, TopUpType } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Booking Notification Worker (existing — 24h / 3h reminders)
// ─────────────────────────────────────────────────────────────────────────────

async function sendNotification(
  patientId: string,
  doctorId: string,
  clinicId: string,
  appointmentId: string,
  notificationType: '24_HOUR' | '3_HOUR',
  consultDate: Date,
  startTime: string
) {
  try {
    const [patient, doctor, clinic] = await Promise.all([
      prisma.patient.findUnique({ where: { id: patientId }, include: { user: true } }),
      prisma.doctor.findUnique({ where: { id: doctorId }, include: { user: true } }),
      prisma.clinic.findUnique({ where: { id: clinicId }, include: { user: true } }),
    ]);

    if (!patient || !doctor || !clinic) {
      console.error('Missing patient, doctor, or clinic data for notification');
      return;
    }

    const timeBeforeAppointment = notificationType === '24_HOUR' ? '24 hours' : '3 hours';
    const message =
      `You have an appointment with Dr. ${doctor.user.fullName || 'Doctor'} ` +
      `at ${clinic.clinicName || 'Clinic'} in ${timeBeforeAppointment}. ` +
      `Date: ${new Date(consultDate).toLocaleDateString()}, Time: ${startTime}`;

    await Promise.all([
      prisma.doctorNotification.create({
        data: {
          doctorId,
          bookingAppointmentId: appointmentId,
          notificationType: `APPOINTMENT_REMINDER_${notificationType}`,
        },
      }),
      prisma.clinicNotification.create({
        data: {
          clinicId,
          bookingAppointmentId: appointmentId,
          notificationType: `APPOINTMENT_REMINDER_${notificationType}`,
        },
      }),
      prisma.patientNotification.create({
        data: {
          patientId,
          bookingAppointmentId: appointmentId,
          notificationType: `APPOINTMENT_REMINDER_${notificationType}`,
          title: 'Appointment Reminder',
          description: message,
        },
      }),
    ]);

    if (patient.user.fcmToken) {
      console.log(`📱 Would send FCM to patient: ${message}`);
    }

    console.log(
      `✅ Reminder sent to patient ${patientId} for appointment ${appointmentId} (${timeBeforeAppointment})`
    );
  } catch (error) {
    console.error('Error sending notification:', error);
    throw error;
  }
}

export const bookingNotificationWorker = new Worker<BookingNotificationJobData>(
  'booking-notifications',
  async (job: Job<BookingNotificationJobData>) => {
    const { appointmentId, patientId, doctorId, clinicId, consultDate, startTime, notificationType } =
      job.data;

    console.log(`📨 Processing ${notificationType} reminder for appointment ${appointmentId}`);

    const appointment = await prisma.bookingAppointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      console.log(`⚠️ Appointment ${appointmentId} not found, skipping`);
      return { status: 'skipped', reason: 'appointment_not_found' };
    }

    if (appointment.status !== BookingStatus.CONFIRMED) {
      console.log(`⚠️ Appointment ${appointmentId} is not confirmed (${appointment.status}), skipping`);
      return { status: 'skipped', reason: 'appointment_not_confirmed' };
    }

    await sendNotification(patientId, doctorId, clinicId, appointmentId, notificationType, consultDate, startTime);

    return { status: 'success', notificationType, appointmentId };
  },
  {
    connection: redis,
    concurrency: 10,
    limiter: { max: 100, duration: 60000 },
  }
);

bookingNotificationWorker.on('completed', (job) => {
  console.log(`✅ Reminder job ${job.id} completed`);
});
bookingNotificationWorker.on('failed', (job, err) => {
  console.error(`❌ Reminder job ${job?.id} failed:`, err.message);
});
bookingNotificationWorker.on('error', (err) => {
  console.error('❌ Reminder worker error:', err);
});

// ─────────────────────────────────────────────────────────────────────────────
// Appointment Lifecycle Worker
// Handles: PENDING_TIMEOUT (scenario 2) and CONFIRMED_TIMEOUT (scenario 4)
// ─────────────────────────────────────────────────────────────────────────────

export const appointmentLifecycleWorker = new Worker<
  PendingBookingTimeoutJobData | ConfirmedBookingTimeoutJobData
>(
  'appointment-lifecycle',
  async (job: Job<PendingBookingTimeoutJobData | ConfirmedBookingTimeoutJobData>) => {
    const jobName = job.name;
    console.log(`🔄 Processing lifecycle job [${jobName}] for appointment ${job.data.appointmentId}`);

    // ── SCENARIO 2: PENDING_TIMEOUT ─────────────────────────────────────────
    if (jobName === 'PENDING_TIMEOUT') {
      const data = job.data as PendingBookingTimeoutJobData;
      const { appointmentId, patientId, patientUserId, clinicUserId, adminUserId, patientServiceFee } = data;

      const appointment = await prisma.bookingAppointment.findUnique({
        where: { id: appointmentId },
      });

      if (!appointment) {
        console.log(`⚠️ [PENDING_TIMEOUT] Appointment ${appointmentId} not found, skipping`);
        return { status: 'skipped', reason: 'not_found' };
      }

      // Only act if still PENDING — clinic may have already accepted/rejected
      if (appointment.status !== BookingStatus.PENDING) {
        console.log(
          `⚠️ [PENDING_TIMEOUT] Appointment ${appointmentId} is already ${appointment.status}, skipping`
        );
        return { status: 'skipped', reason: `already_${appointment.status}` };
      }

      console.log(
        `🚨 [PENDING_TIMEOUT] Clinic ignored booking ${appointmentId} — marking NOT_UPDATED, refunding patient, and penalizing clinic`
      );

      await prisma.$transaction(async (tx) => {
        // 1. Fetch clinic user to get serviceFree amount for penalty
        const clinicUser = await tx.user.findUnique({
          where: { id: clinicUserId },
          select: { serviceFree: true },
        });
        const clinicPenalty = clinicUser?.serviceFree || 0;

        // 2. Update status to NOT_UPDATED
        await tx.bookingAppointment.update({
          where: { id: appointmentId },
          data: { status: BookingStatus.NOT_UPDATED },
        });

        // 3. Refund patientServiceFee back to the patient
        await tx.user.update({
          where: { id: patientUserId },
          data: { wallet: { increment: patientServiceFee } },
        });

        // 4. Penalty for clinic: deduct from clinic wallet
        if (clinicPenalty > 0) {
          await tx.user.update({
            where: { id: clinicUserId },
            data: { wallet: { decrement: clinicPenalty } },
          });
        }

        // 5. Admin wallet: decrement patient refund, increment clinic penalty
        const adminNetChange = clinicPenalty - patientServiceFee;
        if (adminNetChange !== 0) {
          if (adminNetChange > 0) {
            await tx.user.update({
              where: { id: adminUserId },
              data: { wallet: { increment: adminNetChange } },
            });
          } else {
            await tx.user.update({
              where: { id: adminUserId },
              data: { wallet: { decrement: Math.abs(adminNetChange) } },
            });
          }
        }

        // 6. TopUp records for audit trail
        // Patient refund
        await tx.topUp.create({
          data: {
            userId: patientUserId,
            amount: patientServiceFee,
            appointmentId,
            type: TopUpType.REFUND,
          },
        });
        // Admin giving back patient refund
        await tx.topUp.create({
          data: {
            userId: adminUserId,
            amount: patientServiceFee,
            appointmentId,
            type: TopUpType.REFUND,
          },
        });

        // Audit trail for clinic penalty
        if (clinicPenalty > 0) {
          await tx.topUp.create({
            data: {
              userId: clinicUserId,
              amount: clinicPenalty,
              appointmentId,
              type: TopUpType.PENALTY,
            },
          });
          // Admin receiving clinic penalty
          await tx.topUp.create({
            data: {
              userId: adminUserId,
              amount: clinicPenalty,
              appointmentId,
              type: TopUpType.PENALTY,
            },
          });
        }

        // 7. Notify patient
        await tx.patientNotification.create({
          data: {
            patientId,
            bookingAppointmentId: appointmentId,
            notificationType: 'APPOINTMENT_NOT_UPDATED',
            title: 'Booking Not Confirmed',
            description:
              'Your appointment request was not accepted by the clinic before the appointment time. ' +
              'Your service fee has been refunded.',
          },
        });

        // 8. Notify clinic about the penalty
        const clinic = await tx.clinic.findUnique({
          where: { userId: clinicUserId },
          select: { id: true },
        });
        if (clinic) {
          await tx.clinicNotification.create({
            data: {
              clinicId: clinic.id,
              bookingAppointmentId: appointmentId,
              notificationType: 'APPOINTMENT_NOT_UPDATED',
              title: 'Booking Ignored Penalty',
              description: `You missed a booking request before the appointment time. A penalty of ${clinicPenalty} has been deducted from your wallet.`,
            },
          });
        }
      });

      console.log(`✅ [PENDING_TIMEOUT] Appointment ${appointmentId} → NOT_UPDATED, patient refunded`);
      return { status: 'success', outcome: 'NOT_UPDATED', appointmentId };
    }

    // ── SCENARIO 4: CONFIRMED_TIMEOUT ────────────────────────────────────────
    if (jobName === 'CONFIRMED_TIMEOUT') {
      const data = job.data as ConfirmedBookingTimeoutJobData;
      const {
        appointmentId,
        patientId,
        clinicId,
        adminUserId,
        patientServiceFee,
        clinicServiceFee,
      } = data;

      const appointment = await prisma.bookingAppointment.findUnique({
        where: { id: appointmentId },
      });

      if (!appointment) {
        console.log(`⚠️ [CONFIRMED_TIMEOUT] Appointment ${appointmentId} not found, skipping`);
        return { status: 'skipped', reason: 'not_found' };
      }

      // Only act if still CONFIRMED or INPROGRESS (clinic never marked complete/no-show)
      const actionableStatuses: BookingStatus[] = [
        BookingStatus.CONFIRMED,
        BookingStatus.INPROGRESS,
      ];

      if (!actionableStatuses.includes(appointment.status)) {
        console.log(
          `⚠️ [CONFIRMED_TIMEOUT] Appointment ${appointmentId} is already ${appointment.status}, skipping`
        );
        return { status: 'skipped', reason: `already_${appointment.status}` };
      }

      console.log(
        `🚨 [CONFIRMED_TIMEOUT] Clinic did not update visit status for ${appointmentId} — ` +
        `auto-closing. Admin keeps patientServiceFee=${patientServiceFee}.`
      );

      await prisma.$transaction(async (tx) => {
        // 1. Close the appointment
        await tx.bookingAppointment.update({
          where: { id: appointmentId },
          data: { status: BookingStatus.NOT_SHOW },
        });

        // 3. Notify the patient that the appointment was auto-closed
        await tx.patientNotification.create({
          data: {
            patientId,
            bookingAppointmentId: appointmentId,
            notificationType: 'APPOINTMENT_AUTO_CLOSED',
            title: 'Appointment Closed',
            description:
              'Your appointment has been automatically closed because the clinic did not update ' +
              'the visit status within the configured timeout after the appointment end time.',
          },
        });

        // 4. Notify the clinic
        await tx.clinicNotification.create({
          data: {
            clinicId,
            bookingAppointmentId: appointmentId,
            notificationType: 'APPOINTMENT_AUTO_CLOSED',
            title: 'Appointment Auto-Closed',
            description:
              `Appointment ${appointmentId} was automatically closed because the visit status ` +
              `was not updated within the configured timeout. Service fee of ${clinicServiceFee} has been retained by the platform.`,
          },
        });
      });

      console.log(`✅ [CONFIRMED_TIMEOUT] Appointment ${appointmentId} → NOT_SHOW, admin retains fees`);
      return { status: 'success', outcome: 'AUTO_CLOSED', appointmentId };
    }

    console.warn(`⚠️ Unknown lifecycle job name: ${jobName}`);
    return { status: 'skipped', reason: 'unknown_job_name' };
  },
  {
    connection: redis,
    concurrency: 5,
    limiter: { max: 50, duration: 60000 },
  }
);

appointmentLifecycleWorker.on('completed', (job) => {
  console.log(`✅ Lifecycle job ${job.id} (${job.name}) completed`);
});
appointmentLifecycleWorker.on('failed', (job, err) => {
  console.error(`❌ Lifecycle job ${job?.id} (${job?.name}) failed:`, err.message);
});
appointmentLifecycleWorker.on('error', (err) => {
  console.error('❌ Lifecycle worker error:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await bookingNotificationWorker.close();
  await appointmentLifecycleWorker.close();
});
