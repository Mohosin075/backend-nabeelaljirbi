import { Worker, Job } from 'bullmq';
import { redis } from '../../../helpars/redisServer';
import {
  BookingNotificationJobData,
  PendingBookingTimeoutJobData,
  ConfirmedBookingTimeoutJobData,
} from '../queues/bookingQueue';
import prisma from '../../../shared/prisma';
import { BookingStatus, TopUpType } from '@prisma/client';
import { BookingService } from '../../modules/Booking/booking.service';
import { broadcastBookingUpdate } from '../../../helpars/socket/socketHandler';

import admin from '../../../helpars/firebase/firebase';
import { NotificationTemplateService } from '../../modules/NotificationTemplate/notificationTemplate.service';

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
    const [patient, doctor, clinic, appointment] = await Promise.all([
      prisma.patient.findUnique({ where: { id: patientId }, include: { user: true } }),
      prisma.doctor.findUnique({ where: { id: doctorId }, include: { user: true } }),
      prisma.clinic.findUnique({ where: { id: clinicId }, include: { user: true } }),
      prisma.bookingAppointment.findUnique({ where: { id: appointmentId } }),
    ]);

    if (!patient || !doctor || !clinic) {
      console.error('Missing patient, doctor, or clinic data for notification');
      return;
    }

    const eventKey = notificationType === '24_HOUR' ? 'REMINDER_24H' : 'REMINDER_3H';
    const queueNumber = appointment?.serialNumber ? String(appointment.serialNumber) : '1';
    const formattedDate = new Date(consultDate).toISOString().split('T')[0];

    // Patient language preference: 'en' if set, otherwise default to 'ar'
    const patientLang: 'ar' | 'en' = (patient.user as any)?.language === 'en' ? 'en' : 'ar';
    const isEn = patientLang === 'en';

    // Render reminder using independent Arabic / English templates
    const rendered = await NotificationTemplateService.renderNotification(eventKey, patientLang, {
      doctorName: doctor.user.fullName || (isEn ? 'Doctor' : 'الطبيب'),
      clinicName: clinic.clinicName || (isEn ? 'Clinic' : 'العيادة'),
      clinicAddress: clinic.location || clinic.user.address || '',
      date: formattedDate,
      time: startTime,
      queueNumber,
      patientName: patient.user.fullName || (isEn ? 'Patient' : 'المريض'),
    });

    if (!rendered.isActive) {
      console.log(`Notification template ${eventKey} is inactive, skipping send`);
      return;
    }

    // 1. In-app notifications
    if (rendered.inAppEnabled) {
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
            title: rendered.title,
            description: rendered.body,
          },
        }),
        prisma.patientNotification.create({
          data: {
            patientId,
            bookingAppointmentId: appointmentId,
            notificationType: `APPOINTMENT_REMINDER_${notificationType}`,
            title: rendered.title,
            description: rendered.body,
          },
        }),
      ]);
    }

    // 2. FCM Push Notification (Primary Channel)
    if (rendered.pushEnabled && patient.user.fcmToken) {
      const fcmPayload: any = {
        notification: {
          title: rendered.title,
          body: rendered.body,
        },
        data: {
          appointmentId,
          notificationType: eventKey,
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
        },
        android: {
          priority: 'high' as const,
          notification: {
            channelId: 'default_channel',
            sound: 'notification_sound',
            priority: 'high' as const,
            defaultSound: true,
            defaultVibrateTimings: true,
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'notification_sound.aiff',
              alert: {
                title: rendered.title,
                body: rendered.body,
              },
              badge: 1,
              category: 'APPOINTMENT_REMINDER',
            },
          },
        },
        token: patient.user.fcmToken,
      };

      try {
        const response = await admin.messaging().send(fcmPayload);
        console.log(`📱 FCM Reminder sent successfully to patient (${eventKey}):`, response);
      } catch (fcmErr) {
        console.error(`❌ FCM error sending reminder to patient:`, fcmErr);
      }
    }

    console.log(
      `✅ Reminder (${eventKey}) processed for appointment ${appointmentId} to patient ${patientId}`
    );
  } catch (error) {
    console.error('Error sending reminder notification:', error);
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

      const didAutoReject = await prisma.$transaction(async (tx) => {
        // Claim the pending state first. A clinic approval/rejection racing
        // this deadline must win exactly once, including all wallet effects.
        const claimed = await tx.bookingAppointment.updateMany({
          where: { id: appointmentId, status: BookingStatus.PENDING },
          data: {
            status: BookingStatus.REJECTED,
            rejectionReason: 'Auto-rejected: Clinic silence by deadline',
            cancellationReason: 'Auto-rejected: Clinic silence by deadline',
            cancelledBy: 'CLINIC',
          },
        });
        if (claimed.count !== 1) return false;

        // 1. Fetch clinic user to get serviceFree amount for penalty
        const clinicUser = await tx.user.findUnique({
          where: { id: clinicUserId },
          select: { serviceFree: true },
        });
        const clinicPenalty = clinicUser?.serviceFree || 0;

        // 2. Unfreeze the patient hold
        const holdAmount = (appointment as any).holdAmount || 0;
        if (holdAmount > 0) {
          await tx.user.update({
            where: { id: patientUserId },
            data: { frozenWallet: { decrement: holdAmount } },
          });
        } else if (patientServiceFee > 0) {
          await tx.user.update({
            where: { id: patientUserId },
            data: { wallet: { increment: patientServiceFee } },
          });
        }

        // 3. Unfreeze clinic hold in full on auto-rejection
        const clinicHold = (appointment as any).clinicServiceFee || 0;
        if (clinicHold > 0 && clinicUserId) {
          await tx.user.update({
            where: { id: clinicUserId },
            data: { frozenWallet: { decrement: clinicHold } },
          });
        }

        // 4. Penalty for clinic: deduct from clinic wallet
        if (clinicPenalty > 0) {
          await tx.user.update({
            where: { id: clinicUserId },
            data: { wallet: { decrement: clinicPenalty } },
          });
        }

        // 5. Admin wallet: adjust for clinic penalty and patient refund (if deducted)
        const patientDeductedFee = holdAmount > 0 ? 0 : patientServiceFee;
        const adminNetChange = clinicPenalty - patientDeductedFee;
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
        if (patientDeductedFee > 0) {
          // Patient refund
          await tx.topUp.create({
            data: {
              userId: patientUserId,
              amount: patientDeductedFee,
              appointmentId,
              type: TopUpType.REFUND,
            },
          });
          // Admin giving back patient refund
          await tx.topUp.create({
            data: {
              userId: adminUserId,
              amount: patientDeductedFee,
              appointmentId,
              type: TopUpType.REFUND,
            },
          });
        }

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
            notificationType: 'APPOINTMENT_REJECTED',
            title: 'Booking Auto-Rejected',
            description:
              'Your appointment request was not accepted by the clinic before the deadline. ' +
              'Your service fee hold has been unreleased / refunded in full.',
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
              notificationType: 'APPOINTMENT_REJECTED',
              title: 'Booking Ignored Penalty',
              description: `You missed a booking request before the deadline. A penalty of ${clinicPenalty} has been deducted from your wallet.`,
            },
          });
        }

        return true;
      });

      if (!didAutoReject) {
        return { status: 'skipped', reason: 'booking_handled_concurrently' };
      }

      try {
        broadcastBookingUpdate({
          bookingId: appointment.id,
          status: BookingStatus.REJECTED,
          clinicId: appointment.clinicId,
          doctorId: appointment.doctorId,
          patientId: appointment.patientId,
          patientUserId,
          clinicUserId,
          reason: 'Auto-rejected: Clinic silence by deadline',
          serialNumber: appointment.serialNumber,
          consultDate: appointment.consultDate,
        });
      } catch (wsErr) {
        console.error('WS broadcast error on pending timeout:', wsErr);
      }

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
        clinicUserId,
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

      // Actionable if CONFIRMED, INPROGRESS, or ARRIVED (clinic never finalised status)
      const actionableStatuses: BookingStatus[] = [
        BookingStatus.CONFIRMED,
        BookingStatus.INPROGRESS,
        BookingStatus.ARRIVED,
      ];

      if (!actionableStatuses.includes(appointment.status)) {
        console.log(
          `⚠️ [CONFIRMED_TIMEOUT] Appointment ${appointmentId} is already ${appointment.status}, skipping`
        );
        return { status: 'skipped', reason: `already_${appointment.status}` };
      }

      // 🌍 Section 5 Auto-Settle Rule:
      // "An unresolved confirmed appointment auto-settles 12 hours after period end:
      // Completed if Arrived was ever recorded, otherwise Neglected (service fee stays with the platform, consultation amount refunded)."
      if (
        appointment.status === BookingStatus.ARRIVED ||
        appointment.status === BookingStatus.INPROGRESS
      ) {
        console.log(`✅ [CONFIRMED_TIMEOUT] Appointment ${appointmentId} was ${appointment.status} → Auto-Completing.`);
        await BookingService.completeBooking(appointmentId, undefined, "SYSTEM");
        return { status: 'success', outcome: 'AUTO_COMPLETED', appointmentId };
      }

      // Otherwise: Neglected (arrival was never recorded)
      console.log(
        `🚨 [CONFIRMED_TIMEOUT] Appointment ${appointmentId} unresolved & no arrival recorded — ` +
        `auto-settling as Neglected. Service fee stays with platform; refunding consultation amount if collected.`
      );

      const patient = await prisma.patient.findUnique({
        where: { id: patientId },
        select: { userId: true },
      });

      const consultFee = appointment.consultFee || 0;
      const isModeB = appointment.collectionMode === "MODE_B";

      const didAutoSettle = await prisma.$transaction(async (tx) => {
        // A manual completion/cancellation must not race and receive a second settlement.
        const claimed = await tx.bookingAppointment.updateMany({
          where: { id: appointmentId, status: BookingStatus.CONFIRMED },
          data: {
            status: BookingStatus.NOT_SHOW,
            cancellationReason: "Auto-settled: Neglected (no arrival recorded)",
            ...({ noShowReason: "Auto-settled: Neglected (no arrival recorded)" } as any),
          },
        });
        if (claimed.count !== 1) return false;

        // 2. Refund consultation fee if Mode B
        if (isModeB && consultFee > 0 && patient?.userId) {
          await tx.user.update({
            where: { id: patient.userId },
            data: { wallet: { increment: consultFee } },
          });

          await tx.topUp.create({
            data: {
              userId: patient.userId,
              amount: consultFee,
              appointmentId: appointment.id,
              type: TopUpType.REFUND,
            },
          });
        }

        // 3. Notify patient
        await tx.patientNotification.create({
          data: {
            patientId,
            bookingAppointmentId: appointmentId,
            notificationType: 'APPOINTMENT_AUTO_CLOSED',
            title: 'Appointment Auto-Settled',
            description:
              isModeB && consultFee > 0
                ? `Your appointment was unresolved after the period end. The consultation amount of ${consultFee} LYD has been refunded to your wallet. The service fee captured at confirmation is non-refundable.`
                : 'Your appointment was marked as unresolved after the scheduled period. The service fee captured at confirmation is non-refundable.',
          },
        });

        // 4. Notify clinic
        await tx.clinicNotification.create({
          data: {
            clinicId,
            bookingAppointmentId: appointmentId,
            notificationType: 'APPOINTMENT_AUTO_CLOSED',
            title: 'Appointment Neglected & Auto-Closed',
            description:
              `Appointment ${appointmentId} auto-settled after period end without recorded arrival. Service fee of ${clinicServiceFee} was retained by platform.`,
          },
        });

        return true;
      });

      if (!didAutoSettle) {
        // The clinic may have recorded arrival while the neglected settlement
        // was claiming CONFIRMED. Preserve the auto-completion rule in that race.
        const latest = await prisma.bookingAppointment.findUnique({
          where: { id: appointmentId },
          select: { status: true },
        });
        if (
          latest?.status === BookingStatus.ARRIVED ||
          latest?.status === BookingStatus.INPROGRESS
        ) {
          await BookingService.completeBooking(appointmentId, undefined, "SYSTEM");
          return { status: 'success', outcome: 'AUTO_COMPLETED', appointmentId };
        }
        if (latest?.status === BookingStatus.CONFIRMED) {
          // A transient write/transaction conflict left the booking actionable;
          // throw so the queue can retry instead of dropping its timeout job.
          throw new Error(`Could not claim confirmed timeout for ${appointmentId}`);
        }
        return { status: 'skipped', reason: 'booking_handled_concurrently' };
      }

      try {
        broadcastBookingUpdate({
          bookingId: appointment.id,
          status: BookingStatus.NOT_SHOW,
          clinicId: appointment.clinicId,
          doctorId: appointment.doctorId,
          patientId: appointment.patientId,
          patientUserId: patient?.userId,
          clinicUserId: clinicUserId,
          reason: "Auto-settled: Neglected (no arrival recorded)",
          serialNumber: appointment.serialNumber,
          consultDate: appointment.consultDate,
        });
      } catch (e) {
        console.error("WS broadcast error:", e);
      }

      console.log(`✅ [CONFIRMED_TIMEOUT] Appointment ${appointmentId} → Neglected / NOT_SHOW auto-settled`);
      return { status: 'success', outcome: 'AUTO_NEGLECTED', appointmentId };
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
