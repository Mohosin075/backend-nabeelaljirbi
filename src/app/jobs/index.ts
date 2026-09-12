// Import workers to start them
import './workers/bookingWorker';
import './workers/notificationWorker';
import { BookingSchedulerService as bookingSchedulerService } from './services/bookingScheduler.service';

// Import and initialize cron jobs
import { initializeBookingCronJobs } from './cron/bookingCron';

// Export queues and services
export { bookingNotificationQueue, appointmentLifecycleQueue } from './queues/bookingQueue';
export { bookingNotificationWorker, appointmentLifecycleWorker } from './workers/bookingWorker';
export { adminNotificationQueue } from './queues/notificationQueue';
export { adminNotificationWorker } from './workers/notificationWorker';
export { BookingSchedulerService } from './services/bookingScheduler.service';

// Initialize cron jobs
initializeBookingCronJobs();
bookingSchedulerService.repairActiveLifecycleJobs().catch((error) => {
  console.error('Error running lifecycle job repair on startup:', error);
});

console.log('🚀 Job queues, workers, and cron jobs initialized');
