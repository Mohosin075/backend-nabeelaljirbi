import { Queue } from 'bullmq';
import { redis } from '../../../helpars/redisServer';

// ─── Existing: Appointment reminder notifications ─────────────────────────────
export interface BookingNotificationJobData {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  consultDate: Date;
  startTime: string;
  endTime: string;
  notificationType: '24_HOUR' | '3_HOUR';
}

// Create the booking notification queue
export const bookingNotificationQueue = new Queue<BookingNotificationJobData>(
  'booking-notifications',
  {
    connection: redis,
    defaultJobOptions: {
      removeOnComplete: {
        age: 24 * 3600, // Keep completed jobs for 24 hours
        count: 100,     // Keep last 100 completed jobs
      },
      removeOnFail: {
        age: 7 * 24 * 3600, // Keep failed jobs for 7 days
      },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    },
  }
);

// ─── Scenario 2: Pending booking timeout (clinic ignored PENDING) ─────────────
// Fires 30 minutes after the appointment slot endTime. If still PENDING -> NOT_UPDATED.
export interface PendingBookingTimeoutJobData {
  appointmentId: string;
  patientId: string;        // Patient.id (NOT User.id)
  patientUserId: string;    // User.id of the patient
  clinicUserId: string;     // User.id of the clinic
  adminUserId: string;      // User.id of admin
  patientServiceFee: number;
  consultDate: Date;
  endTime: string;
  pendingTimeoutAt: Date;
}

// ─── Scenario 4: Confirmed booking timeout (clinic never updated visit status) ─
// Fires 8 hours after consultDate. If still CONFIRMED/INPROGRESS → COMPLETE.
// Admin keeps the patientServiceFee (no refund to patient).
export interface ConfirmedBookingTimeoutJobData {
  appointmentId: string;
  patientId: string;       // Patient.id
  clinicId: string;        // Clinic.id
  clinicUserId: string;    // User.id of the clinic
  adminUserId: string;     // User.id of admin
  patientServiceFee: number;
  clinicServiceFee: number;
  consultDate: Date;
  endTime: string;         // Doctor's WorkingSlot endTime — job fires 30 min after this
}

// Appointment lifecycle queue — handles pending & confirmed timeouts
export const appointmentLifecycleQueue = new Queue<
  PendingBookingTimeoutJobData | ConfirmedBookingTimeoutJobData
>(
  'appointment-lifecycle',
  {
    connection: redis,
    defaultJobOptions: {
      removeOnComplete: {
        age: 48 * 3600,
        count: 200,
      },
      removeOnFail: {
        age: 7 * 24 * 3600,
      },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 10000,
      },
    },
  }
);

// Graceful shutdown
process.on('SIGTERM', async () => {
  await bookingNotificationQueue.close();
  await appointmentLifecycleQueue.close();
});
