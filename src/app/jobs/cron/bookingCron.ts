import cron from 'node-cron';
import { BookingSchedulerService } from '../services/bookingScheduler.service';
import prisma from '../../../shared/prisma';
import { BookingStatus } from '@prisma/client';

/**
 * 🌍 CRON JOBS UTC STANDARDS:
 * All cron jobs in this service operate on UTC times exclusively.
 * - Cron expressions are interpreted in UTC by default
 * - All date calculations use UTC methods (setUTCHours, setUTCDate, etc.)
 * - No server-local timezone conversions are applied
 * 
 * For detailed standards, see docs/UTC_STANDARDS.md
 */

/**
 * Cron job to clean up expired booking Redis entries and notification jobs.
 * 🌍 Runs every day at 2:00 AM UTC.
 * Note: node-cron interprets cron expressions in UTC when no timezone is specified.
 * Format: minute hour day-of-month month day-of-week
 * '0 2 * * *' = 2:00 AM UTC every day
 */
export function initializeBookingCleanupCron() {
  cron.schedule('0 2 * * *', async () => {
    console.log('🧹 Running booking cleanup cron job at 2:00 AM UTC...');

    try {
      // 🌍 UTC HANDLING: Calculate yesterday's date using UTC
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      // Find completed or cancelled appointments from the past to clean Redis entries
      const expiredBookings = await prisma.bookingAppointment.findMany({
        where: {
          consultDate: { lt: yesterday },
          status: {
            in: [
              BookingStatus.COMPLETE,
              BookingStatus.CANCELLED,
              BookingStatus.NOT_UPDATED,
            ],
          },
        },
        select: { id: true },
      });

      console.log(`Found ${expiredBookings.length} expired bookings to clean up`);

      for (const booking of expiredBookings) {
        try {
          await BookingSchedulerService.cancelBookingNotifications(booking.id);
        } catch (error) {
          console.error(`Error cleaning up booking ${booking.id}:`, error);
        }
      }

      await BookingSchedulerService.cleanupExpiredBookings();

      console.log('✅ Booking cleanup completed successfully');
    } catch (error) {
      console.error('❌ Error during booking cleanup:', error);
    }
  });

  console.log('📅 Booking cleanup cron job initialized (runs daily at 2:00 AM UTC)');
}

/**
 * NOTE: The auto-complete logic (scenario 4) is now handled by BullMQ
 * CONFIRMED_TIMEOUT delayed jobs — scheduled precisely when the clinic confirms
 * an appointment. These jobs fire 8 hours after the consultDate if the clinic
 * has not updated the visit status, auto-closing the appointment and retaining
 * the platform fee.
 *
 * The old hourly cron `initializeAutoCompleteCron` has been removed and replaced
 * by the BullMQ approach for more accurate timing and reliability.
 */

// Initialize all booking-related cron jobs
export function initializeBookingCronJobs() {
  initializeBookingCleanupCron();
}
