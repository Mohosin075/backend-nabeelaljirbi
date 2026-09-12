import { Worker, Job } from 'bullmq';
import { redis } from '../../../helpars/redisServer';
import { AdminNotificationJobData } from '../queues/notificationQueue';
import prisma from '../../../shared/prisma';
import { Notification } from '../../modules/Notification/notification.service';

// Send patient notification function
async function sendPatientNotification(
  userId: string,
  title: string,
  description: string
) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { patient: true }
    });

    if (!user || !user.patient) {
      console.log(`⚠️ Patient ${userId} not found, skipping notification`);
      return;
    }

    await Notification.PatientNotification(
      undefined,
      user.patient.id,
      "ADMIN_NOTIFICATION",
      title,
      description,
      user.fcmToken || undefined
    );
    
    console.log(`✅ Admin notification sent to patient ${userId}`);
  } catch (error) {
    console.error(`Error sending admin notification to patient ${userId}:`, error);
  }
}

// Send clinic notification function
async function sendClinicNotification(
  userId: string,
  title: string,
  description: string
) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { clinic: true }
    });

    if (!user || !user.clinic) {
      console.log(`⚠️ Clinic ${userId} not found, skipping notification`);
      return;
    }

    await Notification.ClinicNotification(
      undefined,
      user.clinic.id,
      "ADMIN_NOTIFICATION",
      title,
      description,
      user.fcmToken || undefined
    );

    console.log(`✅ Admin notification sent to clinic ${userId}`);
  } catch (error) {
    console.error(`Error sending admin notification to clinic ${userId}:`, error);
  }
}


// Worker to process admin notification jobs
export const adminNotificationWorker = new Worker<AdminNotificationJobData>(
  'admin-notifications',
  async (job: Job<AdminNotificationJobData>) => {
    const { userIds, title, description, type } = job.data;

    console.log(
      `📨 Processing admin notification chunk for ${userIds.length} ${type.toLowerCase()}s`
    );

    const chunkSize = 10;
    for (let i = 0; i < userIds.length; i += chunkSize) {
      const chunk = userIds.slice(i, i + chunkSize);
      
      await Promise.all(chunk.map(async (userId) => {
        if (type === 'PATIENT') {
          await sendPatientNotification(userId, title, description);
        } else if (type === 'CLINIC') {
          await sendClinicNotification(userId, title, description);
        }
      }));
    }

    return { status: 'success', type, count: userIds.length };
  },
  {
    connection: redis,
    concurrency: 5, // Process up to 5 chunks concurrently
    limiter: {
      max: 50, // Maximum 50 jobs
      duration: 60000, // per 60 seconds (rate limiting)
    },
  }
);

// Event listeners for monitoring
adminNotificationWorker.on('completed', (job) => {
  console.log(`✅ Admin notification chunk job ${job.id} completed successfully`);
});

adminNotificationWorker.on('failed', (job, err) => {
  console.error(`❌ Admin notification chunk job ${job?.id} failed:`, err.message);
});

adminNotificationWorker.on('error', (err) => {
  console.error('❌ Admin notification worker error:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await adminNotificationWorker.close();
});
