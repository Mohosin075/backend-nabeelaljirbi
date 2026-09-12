# Patient Module - Booking Notification Integration

## Overview
The Patient module's `cancelAppointment` function has been integrated with the automated booking notification system. This ensures that when a patient cancels their appointment, all scheduled notifications are automatically removed, preventing unnecessary alerts.

## Integration Points

### When Appointment is CANCELLED by Patient
**Location:** `patient.service.ts` - `cancelAppointment()` function

**What happens:**
1. Patient cancels the appointment (existing logic)
2. Wallet refunds/transactions are processed (existing logic)
3. **NEW:** All scheduled notifications are automatically removed from Redis and BullMQ queues.

**Code Added:**
```typescript
// Cancel scheduled notifications
try {
  await BookingSchedulerService.cancelBookingNotifications(bookingId);
} catch (error) {
  console.error("Failed to cancel booking notifications:", error);
}
```

## How It Works

```
Patient cancels appointment
    ↓
cancelAppointment(bookingId)
    ↓
Database transaction:
  - Update appointment status to CANCELLED
  - Process wallet refunds (if applicable)
    ↓
BookingSchedulerService.cancelBookingNotifications(bookingId)
    ↓
Retrieve job IDs from Redis
    ↓
Remove jobs from BullMQ queue (24h & 3h reminders)
    ↓
Delete Redis entry
    ↓
Return success message
```

## Verification

To verify the integration is working:

1. **Schedule an Appointment** (from Clinic side or Admin) until it is CONFIRMED.
   - Check Redis: `redis-cli GET booking:scheduled:{appointmentId}`
   - You should see the job IDs.

2. **Cancel Appointment from Patient App**
   - Call `PATCH /api/v1/patient/appointment/{bookingId}/cancel`
   - Check Redis: `redis-cli GET booking:scheduled:{appointmentId}`
   - result should be `(nil)` (deleted).

## Related Files
- `src/app/modules/Patient/patient.service.ts`
- `src/app/jobs/services/bookingScheduler.service.ts`
