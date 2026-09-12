# Clinic Module - Booking Notification Integration

## Overview
The Clinic module's `updateAppointmentStatus` function has been integrated with the automated booking notification system. This integration ensures that notifications are properly scheduled and cancelled when appointments are confirmed or cancelled from the clinic side.

## Integration Points

### 1. When Appointment is CONFIRMED
**Location:** `clinic.service.ts` - `updateAppointmentStatus()` function

**What happens:**
1. Clinic confirms the appointment (existing logic)
2. Wallet transactions are processed (existing logic)
3. **NEW:** Notifications are automatically scheduled:
   - 24-hour reminder before appointment
   - 3-hour reminder before appointment
4. Job IDs stored in Redis for later cancellation

**Code Added:**
```typescript
// Schedule notifications (Redis + BullMQ) for 24h and 3h before appointment
try {
  await BookingSchedulerService.scheduleBookingNotifications({
    appointmentId: updateBooking.id,
    patientId: updateBooking.patientId,
    doctorId: updateBooking.doctorId,
    clinicId: updateBooking.clinicId,
    consultDate: updateBooking.consultDate,
    startTime: updateBooking.startTime!,
    endTime: updateBooking.endTime!,
    status: updateBooking.status,
  });
  console.log(`✅ Scheduled notifications for appointment ${bookingId}`);
} catch (error) {
  console.error(`⚠️ Error scheduling notifications for appointment ${bookingId}:`, error);
  // Don't throw error - confirmation is successful even if notification scheduling fails
}
```

**Console Output:**
```
✅ Scheduled notifications for appointment clx123abc
📅 Scheduled 24-hour notification for appointment clx123abc (delay: 1380 minutes)
📅 Scheduled 3-hour notification for appointment clx123abc (delay: 1620 minutes)
```

### 2. When Appointment is CANCELLED
**Location:** `clinic.service.ts` - `updateAppointmentStatus()` function

**What happens:**
1. Appointment is cancelled (existing logic)
2. Wallet refunds are processed (existing logic)
3. **NEW:** All scheduled notifications are automatically removed:
   - 24-hour reminder job removed from queue
   - 3-hour reminder job removed from queue
   - Redis entry deleted

**Code Added:**
```typescript
// Cancel scheduled notifications (Redis + BullMQ)
try {
  await BookingSchedulerService.cancelBookingNotifications(bookingId);
  console.log(`✅ Cancelled notifications for appointment ${bookingId}`);
} catch (error) {
  console.error(`⚠️ Error cancelling notifications for appointment ${bookingId}:`, error);
  // Don't throw error - cancellation is successful even if notification cleanup fails
}
```

**Console Output:**
```
🗑️ Removed notification job clx123abc:24h for appointment clx123abc
🗑️ Removed notification job clx123abc:3h for appointment clx123abc
✅ Cancelled all notifications for appointment clx123abc
```

## Notification Flow

### Confirmation Flow
```
Clinic confirms appointment
    ↓
updateAppointmentStatus(status: CONFIRMED)
    ↓
Database transaction:
  - Deduct clinic wallet
  - Add to admin wallet
  - Create TopUp records
  - Update appointment status to CONFIRMED
    ↓
BookingSchedulerService.scheduleBookingNotifications()
    ↓
Calculate delays (24h and 3h before appointment)
    ↓
Create BullMQ jobs
    ↓
Store job IDs in Redis
    ↓
Return success to clinic
```

### Cancellation Flow
```
Clinic cancels appointment
    ↓
updateAppointmentStatus(status: CANCELLED)
    ↓
Database transaction:
  - Refund patient wallet
  - Refund clinic wallet
  - Deduct from admin wallet
  - Update appointment status to CANCELLED
    ↓
BookingSchedulerService.cancelBookingNotifications()
    ↓
Retrieve job IDs from Redis
    ↓
Remove jobs from BullMQ queue
    ↓
Delete Redis entry
    ↓
Return success to clinic
```

## Notification Recipients

When notifications are sent (at scheduled time):

### 1. Patient Notification
- **Method**: Push notification (FCM) if `fcmToken` exists
- **Message**: "You have an appointment with Dr. {doctorName} at {clinicName} in {timeBeforeAppointment}. Date: {date}, Time: {time}"

### 2. Doctor Notification
- **Database**: `DoctorNotification` record created
- **Fields**:
  - `doctorId`: Doctor's ID
  - `bookingAppointmentId`: Appointment ID
  - `notificationType`: "APPOINTMENT_REMINDER_24_HOUR" or "APPOINTMENT_REMINDER_3_HOUR"

### 3. Clinic Notification
- **Database**: `ClinicNotification` record created
- **Fields**:
  - `clinicId`: Clinic's ID
  - `bookingAppointmentId`: Appointment ID
  - `notificationType`: "APPOINTMENT_REMINDER_24_HOUR" or "APPOINTMENT_REMINDER_3_HOUR"

## Error Handling

### Non-Blocking Errors
The notification scheduling/cancellation is wrapped in try-catch blocks to ensure that:
- ✅ Appointment confirmation/cancellation always succeeds
- ✅ Notification errors are logged but don't block the main operation
- ✅ Users get immediate feedback on appointment status change

**Example:**
```typescript
try {
  await BookingSchedulerService.scheduleBookingNotifications(...);
} catch (error) {
  console.error(`⚠️ Error scheduling notifications:`, error);
  // Don't throw - confirmation is successful even if notification fails
}
```

## Testing

### Test Confirmation
```bash
# 1. Confirm appointment from clinic side
PATCH /api/v1/clinic/booking/{appointmentId}/status
Authorization: Bearer <clinic_token>
Content-Type: application/json

{
  "status": "CONFIRMED"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Appointment status updated successfully",
  "data": {
    "id": "clx123abc",
    "status": "CONFIRMED",
    ...
  }
}
```

**Check Redis:**
```bash
redis-cli GET booking:scheduled:clx123abc
# Output: ["clx123abc:24h","clx123abc:3h"]
```

### Test Cancellation
```bash
# 2. Cancel appointment from clinic side
PATCH /api/v1/clinic/booking/{appointmentId}/status
Authorization: Bearer <clinic_token>
Content-Type: application/json

{
  "status": "CANCELLED"
}
```

**Check Redis:**
```bash
redis-cli GET booking:scheduled:clx123abc
# Output: (nil) - entry removed
```

## Monitoring

### Console Logs to Watch
```bash
# When confirming
✅ Scheduled notifications for appointment clx123abc
📅 Scheduled 24-hour notification for appointment clx123abc
📅 Scheduled 3-hour notification for appointment clx123abc

# When cancelling
🗑️ Removed notification job clx123abc:24h for appointment clx123abc
🗑️ Removed notification job clx123abc:3h for appointment clx123abc
✅ Cancelled all notifications for appointment clx123abc

# When notification is sent (at scheduled time)
📨 Processing 24_HOUR notification for appointment clx123abc
✅ Notification sent to patient {patientId} for appointment clx123abc
```

### Redis Monitoring
```bash
# View all scheduled bookings
redis-cli KEYS booking:scheduled:*

# View specific booking
redis-cli GET booking:scheduled:{appointmentId}

# Check TTL
redis-cli TTL booking:scheduled:{appointmentId}
```

## Important Notes

1. **No Changes to Main Logic**: The existing appointment confirmation/cancellation logic remains unchanged. Notifications are added as a non-blocking enhancement.

2. **Graceful Degradation**: If Redis or BullMQ is down, appointments can still be confirmed/cancelled. Notifications simply won't be scheduled.

3. **Patient Data**: The system automatically fetches patient data from the appointment's `patientId` to send notifications to the correct user.

4. **Automatic Cleanup**: The cron jobs will automatically clean up expired bookings and their Redis entries.

5. **Idempotent Operations**: Scheduling notifications for an already-scheduled appointment will update the existing jobs. Cancelling non-existent notifications is safe.

## Future Enhancements

1. **Email Notifications**: Add email sending in `bookingWorker.ts`
2. **SMS Notifications**: Add SMS sending in `bookingWorker.ts`
3. **Custom Notification Times**: Allow clinics to configure reminder times
4. **Notification Preferences**: Let patients choose which reminders they want

## Related Files

- `src/app/modules/Clinic/clinic.service.ts` - Main integration point
- `src/app/jobs/services/bookingScheduler.service.ts` - Scheduling logic
- `src/app/jobs/workers/bookingWorker.ts` - Notification processing
- `src/app/jobs/queues/bookingQueue.ts` - Queue configuration

## Support

For detailed system documentation, see:
- [Complete Documentation](../../../docs/BOOKING_NOTIFICATION_SYSTEM.md)
- [Quick Start Guide](../../../docs/QUICK_START_BOOKING_NOTIFICATIONS.md)
- [System Diagrams](../../../docs/SYSTEM_DIAGRAMS.md)
