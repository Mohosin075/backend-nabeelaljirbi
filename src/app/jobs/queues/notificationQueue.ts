import { Queue } from 'bullmq';
import { redis } from '../../../helpars/redisServer';

export interface AdminNotificationJobData {
  userIds: string[];
  title: string;
  description: string;
  type: 'PATIENT' | 'CLINIC';
}

// Create the admin notification queue
export const adminNotificationQueue = new Queue<AdminNotificationJobData>(
  'admin-notifications',
  {
    connection: redis,
    defaultJobOptions: {
      removeOnComplete: {
        age: 24 * 3600, // Keep completed jobs for 24 hours
        count: 100, // Keep last 100 completed jobs
      },
      removeOnFail: {
        age: 7 * 24 * 3600, // Keep failed jobs for 7 days
      },
      attempts: 3, // Retry failed jobs 3 times
      backoff: {
        type: 'exponential',
        delay: 5000, // Start with 5 seconds delay
      },
    },
  }
);

// Graceful shutdown
process.on('SIGTERM', async () => {
  await adminNotificationQueue.close();
});
