# UTC Timezone Standards - Nabeelaljirbi Backend

## Overview

🌍 **All time-based operations and Redis scheduling in this backend system must operate exclusively in UTC (Coordinated Universal Time).**

This document establishes the standards for timezone handling across the entire project to ensure consistency, prevent bugs, and enable reliable scheduling across different server environments.

---

## Why UTC?

- **Server-Agnostic**: Servers deployed in different regions will operate consistently
- **Database Consistency**: PostgreSQL stores timestamps in UTC by default
- **Redis Scheduling**: BullMQ jobs execute based on UTC timestamps
- **No Ambiguity**: Eliminates timezone conversion errors that occur with local time
- **Audit Trail**: UTC timestamps provide consistent historical records

---

## Core Principles

### 1. Database Storage (Prisma)

- All `DateTime` fields in `schema.prisma` store timestamps in UTC
- `consultDate` for appointments is stored as UTC midnight of the appointment day
- `startTime` and `endTime` for doctor slots are stored as UTC HH:MM:SS format
- Prisma automatically handles UTC conversion with PostgreSQL

### 2. Application Layer

- **Always use `setUTCHours()`, `setUTCMinutes()`, `setUTCDate()`, etc.**
- **Never use `setHours()`, `setMinutes()`, `setDate()` etc.** (these apply local timezone)
- `Date.now()` is always UTC-based (milliseconds since epoch)
- When comparing dates, ensure both are in UTC

### 3. Cron Jobs (node-cron)

- Cron expressions are interpreted in UTC by default
- Format: `minute hour day month day-of-week` (0-based days)
- Example: `'0 2 * * *'` = 2:00 AM UTC every day
- Always document the UTC time in code comments

### 4. Redis & BullMQ Scheduling

- Job delays are calculated in milliseconds from UTC `Date.now()`
- Job execution times must be calculated using UTC
- Stored appointment metadata uses UTC timestamps
- Job data includes `consultDate` and time strings in UTC format

---

## Implementation Guidelines

### ✅ DO - Correct UTC Usage

```typescript
// ✅ Creating a date with UTC
const today = new Date();
today.setUTCHours(0, 0, 0, 0);

// ✅ Calculating tomorrow in UTC
const tomorrow = new Date(today);
tomorrow.setUTCDate(today.getUTCDate() + 1);

// ✅ Setting time on an appointment
const appointmentTime = new Date(consultDate);
appointmentTime.setUTCHours(hours, minutes, seconds, 0);

// ✅ Calculating delay from now to a future time
const futureTime = new Date(
  appointmentDateTime.getTime() - 24 * 60 * 60 * 1000,
);
const delayMs = futureTime.getTime() - Date.now();

// ✅ Comparing UTC dates
if (appointmentDate.getTime() >= today.getTime()) {
  // appointment is today or in future
}

// ✅ Using UTC day of month
const dayOfMonth = date.getUTCDate();
```

### ❌ DON'T - Incorrect Local Timezone Usage

```typescript
// ❌ WRONG: Uses server's local timezone
date.setHours(0, 0, 0, 0);

// ❌ WRONG: Uses local timezone
date.setMinutes(30);

// ❌ WRONG: Uses local day from local timezone
date.setDate(date.getDate() + 1);

// ❌ WRONG: Local day of week
const dayOfWeek = date.getDay();

// ❌ WRONG: Mixing UTC and local operations
const mixed = new Date(utcDate);
mixed.setHours(10, 0, 0); // This is WRONG - don't mix!
```

---

## Critical Implementation Areas

### 1. Booking Appointment Creation (`patient.service.ts`)

**File**: `src/app/modules/Patient/patient.service.ts`

When creating a booking appointment:

```typescript
// Always use setUTCHours for time calculations
const appointmentDateTime = new Date(consultDate);
appointmentDateTime.setUTCHours(hours, minutes, 0, 0);

// Store in database
consultDate: appointmentDateTime,
```

### 2. Notification Reminder Scheduling (`bookingScheduler.service.ts`)

**File**: `src/app/jobs/services/bookingScheduler.service.ts`

When calculating delays for 24h and 3h reminders:

```typescript
function calculateDelay(
  consultDate: Date,
  startTime: string,
  hoursBeforeAppointment: number,
): number {
  const [hours, minutes] = startTime.split(":").map(Number);
  const appointmentDateTime = new Date(consultDate);

  // ✅ Use setUTCHours for UTC calculation
  appointmentDateTime.setUTCHours(hours, minutes, 0, 0);

  const notificationTime = new Date(
    appointmentDateTime.getTime() - hoursBeforeAppointment * 60 * 60 * 1000,
  );

  const delay = notificationTime.getTime() - Date.now();
  return Math.max(0, delay);
}
```

### 3. Pending & Confirmed Timeouts

**File**: `src/app/jobs/services/bookingScheduler.service.ts`

Calculate timeout moments in UTC:

```typescript
function calculatePendingTimeoutAt(consultDate: Date, endTime: string): Date {
  const { hours, minutes, seconds } = parseTimeParts(endTime);

  // ✅ Use UTC methods for timezone-agnostic calculation
  const slotEndAt = new Date(consultDate);
  slotEndAt.setUTCHours(hours, minutes, seconds, 0);

  const midnightUTC = new Date(consultDate);
  midnightUTC.setUTCHours(0, 0, 0, 0);

  if (slotEndAt.getTime() <= midnightUTC.getTime()) {
    slotEndAt.setUTCDate(slotEndAt.getUTCDate() + 1);
  }

  // Add 30-minute grace period
  return new Date(slotEndAt.getTime() + 30 * 60 * 1000);
}
```

### 4. Booking History & Statistics (`clinic.service.ts`)

**File**: `src/app/modules/Clinic/clinic.service.ts`

When filtering by date range:

```typescript
if (filterData.consultDate) {
  const searchDate = new Date(filterData.consultDate);

  // ✅ Set boundaries using UTC
  const startOfDay = new Date(searchDate);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const endOfDay = new Date(searchDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  andConditions.push({
    consultDate: {
      gte: startOfDay,
      lte: endOfDay,
    },
  });
}
```

### 5. Daily Cleanup Cron Job (`bookingCron.ts`)

**File**: `src/app/jobs/cron/bookingCron.ts`

The cron job runs at 2:00 AM UTC:

```typescript
// ✅ UTC documentation in comments
cron.schedule("0 2 * * *", async () => {
  console.log("Running cleanup at 2:00 AM UTC...");

  // Calculate yesterday in UTC
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  // Process expired bookings...
});
```

---

## Testing UTC Compliance

### 1. Date Calculations

- Create appointments with consultDate in different timezones
- Verify the stored UTC time is correct
- Check that jobs fire at the expected UTC times

### 2. Cron Job Timing

- Monitor logs for cron job execution
- Verify it runs at 2:00 AM UTC consistently
- Check cleanup effectiveness across timezones

### 3. Redis Job Delays

- Create bookings and inspect job delays in Redis
- Verify notification jobs execute at correct UTC times
- Check timeout jobs fire 30 minutes after slot endTime UTC

### 4. Database Verification

```sql
-- Verify consultDate is stored as UTC midnight
SELECT id, consultDate, startTime, endTime
FROM booking_appointments
LIMIT 10;

-- All dates should be at 00:00:00 UTC for the appointment day
```

---

## Database Schema Considerations

All `DateTime` fields in Prisma are UTC:

- `User.otpExpiresAt` - UTC timestamp
- `User.dateOfBirth` - UTC date
- `BookingAppointment.consultDate` - UTC midnight of appointment day
- `createdAt` / `updatedAt` - UTC timestamps (automatic)

**Important**: The database automatically handles UTC conversion with the PostgreSQL driver.

---

## Node-cron UTC Details

The `node-cron` library uses UTC for all cron expressions when no `timezone` option is provided:

```typescript
import cron from "node-cron";

// Runs at 2:00 AM UTC every day
cron.schedule("0 2 * * *", () => {
  // Job logic
});

// Current configuration uses UTC (no explicit timezone option needed)
```

---

## Migration Path for Existing Code

If you encounter code using local timezone methods, apply these conversions:

| Local (❌)          | UTC (✅)               |
| ------------------- | ---------------------- |
| `date.setHours()`   | `date.setUTCHours()`   |
| `date.setMinutes()` | `date.setUTCMinutes()` |
| `date.setDate()`    | `date.setUTCDate()`    |
| `date.getHours()`   | `date.getUTCHours()`   |
| `date.getMinutes()` | `date.getUTCMinutes()` |
| `date.getDate()`    | `date.getUTCDate()`    |
| `date.getDay()`     | `date.getUTCDay()`     |

---

## Troubleshooting Common Issues

### Problem: Jobs firing at wrong time

**Solution**: Check if date calculations use UTC methods. Verify `consultDate` from database is UTC.

### Problem: Date filtering returns wrong results

**Solution**: Ensure `startOfDay` and `endOfDay` use `setUTCHours()` for boundaries.

### Problem: Cron job seems to run at wrong time

**Solution**: Remember node-cron uses UTC by default. Check server logs for actual execution time vs expected.

### Problem: Notifications arrive too early/late

**Solution**: Verify `calculateDelay()` uses UTC for appointment time. Check Redis job delays in queue.

---

## Maintenance & Updates

- **Before deploying**: Run UTC compliance checks on all time-sensitive operations
- **When adding features**: Always use UTC methods for new date/time code
- **Code reviews**: Flag any use of non-UTC date methods
- **Documentation**: Keep this file updated with new UTC-critical areas

---

## References

- [JavaScript Date UTC Methods](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date)
- [node-cron Documentation](https://www.npmjs.com/package/node-cron)
- [Prisma DateTime Handling](https://www.prisma.io/docs/reference/api-reference/prisma-client-reference#datetime)
- [PostgreSQL Timezone Documentation](https://www.postgresql.org/docs/current/datetime.html)

---

**Last Updated**: 2026-07-09
**Version**: 1.0
**Status**: Active - All systems must comply
