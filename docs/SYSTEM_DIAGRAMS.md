# System Architecture Diagrams

## 1. High-Level System Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER ACTIONS                                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
            ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
            │   Confirm    │ │    Cancel    │ │   Complete   │
            │   Booking    │ │   Booking    │ │   Booking    │
            └──────────────┘ └──────────────┘ └──────────────┘
                    │               │               │
                    ▼               ▼               ▼
            ┌──────────────────────────────────────────────┐
            │         Booking Service Layer                │
            │  - confirmBooking()                          │
            │  - cancelBooking()                           │
            │  - completeBooking()                         │
            └──────────────────────────────────────────────┘
                    │               │               │
                    ▼               ▼               ▼
            ┌──────────────────────────────────────────────┐
            │      Booking Scheduler Service               │
            │  - scheduleBookingNotifications()            │
            │  - cancelBookingNotifications()              │
            └──────────────────────────────────────────────┘
                    │               │
                    ▼               ▼
            ┌──────────────────────────────────────────────┐
            │              BullMQ Queue                    │
            │  - Add delayed jobs (24h, 3h)                │
            │  - Remove jobs                               │
            └──────────────────────────────────────────────┘
                    │               │
                    ▼               ▼
            ┌──────────────────────────────────────────────┐
            │               Redis Storage                  │
            │  - Store job IDs                             │
            │  - TTL: 7 days                               │
            └──────────────────────────────────────────────┘
                    │
                    ▼
            ┌──────────────────────────────────────────────┐
            │          BullMQ Worker (10 concurrent)       │
            │  - Process jobs at scheduled time            │
            │  - Retry on failure (3 attempts)             │
            └──────────────────────────────────────────────┘
                    │
                    ▼
            ┌──────────────────────────────────────────────┐
            │         Notification Delivery                │
            │  - DoctorNotification                        │
            │  - ClinicNotification                        │
            │  - Push Notification (FCM)                   │
            │  - Email (TODO)                              │
            │  - SMS (TODO)                                │
            └──────────────────────────────────────────────┘
```

## 2. Booking Confirmation Flow

```
┌──────────┐
│  Doctor  │
│ confirms │
│ booking  │
└────┬─────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ PATCH /api/v1/booking/:id/confirm       │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ BookingController.confirmBooking()      │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ BookingService.confirmBooking()         │
│  1. Update status to CONFIRMED          │
│  2. Call scheduler service              │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ BookingSchedulerService                 │
│  .scheduleBookingNotifications()        │
└─────────────────────────────────────────┘
     │
     ├─────────────────────────────────────┐
     │                                     │
     ▼                                     ▼
┌──────────────────────┐      ┌──────────────────────┐
│ Calculate 24h delay  │      │ Calculate 3h delay   │
│ appointmentTime - 24h│      │ appointmentTime - 3h │
└──────────────────────┘      └──────────────────────┘
     │                                     │
     ▼                                     ▼
┌──────────────────────┐      ┌──────────────────────┐
│ Create BullMQ job    │      │ Create BullMQ job    │
│ ID: {id}:24h         │      │ ID: {id}:3h          │
│ Delay: calculated    │      │ Delay: calculated    │
└──────────────────────┘      └──────────────────────┘
     │                                     │
     └─────────────┬───────────────────────┘
                   ▼
     ┌──────────────────────────────────────┐
     │ Store job IDs in Redis               │
     │ Key: booking:scheduled:{id}          │
     │ Value: ["{id}:24h", "{id}:3h"]       │
     │ TTL: 7 days                          │
     └──────────────────────────────────────┘
                   │
                   ▼
     ┌──────────────────────────────────────┐
     │ Return success response              │
     │ "Notifications scheduled"            │
     └──────────────────────────────────────┘
```

## 3. Notification Processing Flow

```
┌──────────────────────────────────────────┐
│  Job delay expires (24h or 3h before)    │
└──────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Worker picks up job from queue          │
└──────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Fetch appointment from database         │
└──────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Check: Does appointment exist?          │
└──────────────────────────────────────────┘
         │                    │
         │ No                 │ Yes
         ▼                    ▼
┌─────────────────┐  ┌──────────────────────┐
│ Skip & return   │  │ Check: Is CONFIRMED? │
└─────────────────┘  └──────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │ No                │ Yes
                    ▼                   ▼
          ┌─────────────────┐  ┌──────────────────────┐
          │ Skip & return   │  │ Fetch patient, doctor│
          └─────────────────┘  │ and clinic details   │
                               └──────────────────────┘
                                        │
                                        ▼
                               ┌──────────────────────┐
                               │ Create notifications │
                               │ - DoctorNotification │
                               │ - ClinicNotification │
                               └──────────────────────┘
                                        │
                                        ▼
                               ┌──────────────────────┐
                               │ Send push notification│
                               │ (if FCM token exists)│
                               └──────────────────────┘
                                        │
                                        ▼
                               ┌──────────────────────┐
                               │ Log success          │
                               │ Mark job complete    │
                               └──────────────────────┘
```

## 4. Cancellation Flow

```
┌──────────┐
│  User    │
│ cancels  │
│ booking  │
└────┬─────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ PATCH /api/v1/booking/:id/cancel        │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ BookingService.cancelBooking()          │
│  1. Update status to CANCELLED          │
│  2. Call scheduler service              │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ BookingSchedulerService                 │
│  .cancelBookingNotifications()          │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ Get job IDs from Redis                  │
│ Key: booking:scheduled:{id}             │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ For each job ID:                        │
│  1. Get job from BullMQ                 │
│  2. Remove job from queue               │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ Delete Redis key                        │
│ booking:scheduled:{id}                  │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│ Return success response                 │
│ "Notifications removed"                 │
└─────────────────────────────────────────┘
```

## 5. Cron Jobs Flow

### Daily Cleanup (2:00 AM)
```
┌──────────────────────────────────────────┐
│  Cron triggers at 2:00 AM daily          │
└──────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Find appointments from yesterday        │
│  Status: COMPLETE or CANCELLED           │
└──────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  For each expired appointment:           │
│   - Cancel remaining notifications       │
│   - Remove from Redis                    │
└──────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Clean up orphaned Redis entries         │
└──────────────────────────────────────────┘
```

### Hourly Auto-Complete
```
┌──────────────────────────────────────────┐
│  Cron triggers every hour                │
└──────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Find past appointments                  │
│  Status: CONFIRMED or INPROGRESS         │
└──────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  For each past appointment:              │
│   - Check if end time has passed         │
│   - Update status to COMPLETE            │
│   - Cancel remaining notifications       │
└──────────────────────────────────────────┘
```

## 6. Redis Data Structure

```
Redis Key-Value Store
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Key: booking:scheduled:clx123abc                       │
│  Value: ["clx123abc:24h", "clx123abc:3h"]               │
│  TTL: 604800 seconds (7 days)                           │
│                                                         │
│  Key: booking:scheduled:clx456def                       │
│  Value: ["clx456def:24h", "clx456def:3h"]               │
│  TTL: 604800 seconds (7 days)                           │
│                                                         │
│  ... (more bookings)                                    │
│                                                         │
└─────────────────────────────────────────────────────────┘

BullMQ Job Storage (also in Redis)
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Job ID: clx123abc:24h                                  │
│  Queue: booking-notifications                           │
│  Data: { appointmentId, patientId, ... }                │
│  Delay: 86400000 ms (24 hours)                          │
│  Status: delayed                                        │
│                                                         │
│  Job ID: clx123abc:3h                                   │
│  Queue: booking-notifications                           │
│  Data: { appointmentId, patientId, ... }                │
│  Delay: 10800000 ms (3 hours)                           │
│  Status: delayed                                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 7. Error Handling & Retry Flow

```
┌──────────────────────────────────────────┐
│  Job processing starts                   │
└──────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│  Try to send notification                │
└──────────────────────────────────────────┘
                   │
         ┌─────────┴─────────┐
         │ Success           │ Error
         ▼                   ▼
┌─────────────────┐  ┌──────────────────────┐
│ Mark complete   │  │ Attempt 1 failed     │
│ Log success     │  │ Wait 5 seconds       │
└─────────────────┘  └──────────────────────┘
                              │
                              ▼
                     ┌──────────────────────┐
                     │ Retry (Attempt 2)    │
                     └──────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │ Success           │ Error
                    ▼                   ▼
          ┌─────────────────┐  ┌──────────────────────┐
          │ Mark complete   │  │ Attempt 2 failed     │
          │ Log success     │  │ Wait 25 seconds      │
          └─────────────────┘  │ (exponential backoff)│
                               └──────────────────────┘
                                        │
                                        ▼
                               ┌──────────────────────┐
                               │ Retry (Attempt 3)    │
                               └──────────────────────┘
                                        │
                              ┌─────────┴─────────┐
                              │ Success           │ Error
                              ▼                   ▼
                    ┌─────────────────┐  ┌──────────────────────┐
                    │ Mark complete   │  │ All attempts failed  │
                    │ Log success     │  │ Mark as failed       │
                    └─────────────────┘  │ Keep for 7 days      │
                                         │ Log error            │
                                         └──────────────────────┘
```

## 8. Timeline Example

```
Day 1: 10:00 AM - Appointment created
Day 1: 11:00 AM - Doctor confirms appointment
                  ↓
                  Notifications scheduled:
                  - 24h reminder: Day 2, 10:00 AM
                  - 3h reminder: Day 2, 7:00 PM

Day 2: 10:00 AM - 24-hour reminder sent ✅
                  Patient receives notification

Day 2: 7:00 PM  - 3-hour reminder sent ✅
                  Patient receives notification

Day 2: 10:00 PM - Appointment time (actual appointment)

Day 2: 11:00 PM - Auto-complete cron runs
                  Appointment marked as COMPLETE
                  Redis entry removed
```

## 9. Component Interaction

```
┌─────────────────────────────────────────────────────────────┐
│                      Express Server                         │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │   Routes   │→ │ Controller │→ │  Service   │            │
│  └────────────┘  └────────────┘  └────────────┘            │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Scheduler Service                          │
│  - scheduleBookingNotifications()                           │
│  - cancelBookingNotifications()                             │
│  - cleanupExpiredBookings()                                 │
└───────────────────────────┬─────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│      BullMQ Queue        │  │    Redis Storage         │
│  - Add jobs              │  │  - Store job IDs         │
│  - Remove jobs           │  │  - TTL management        │
│  - Job persistence       │  │  - Fast lookup           │
└──────────────────────────┘  └──────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────┐
│                    BullMQ Worker Pool                        │
│  ┌────────┐ ┌────────┐ ┌────────┐ ... ┌────────┐           │
│  │Worker 1│ │Worker 2│ │Worker 3│     │Worker10│           │
│  └────────┘ └────────┘ └────────┘     └────────┘           │
│  Concurrency: 10 | Rate Limit: 100/min                      │
└──────────────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────┐
│                  Notification Services                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │   Database   │ │     FCM      │ │    Email     │        │
│  │Notifications │ │Push Notif.   │ │   (TODO)     │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

---

These diagrams provide a visual understanding of how the automated booking notification system works, from user actions to notification delivery.
