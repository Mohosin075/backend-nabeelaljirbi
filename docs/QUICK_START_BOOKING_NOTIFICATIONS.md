# Quick Start Guide - Booking Notification System

## Prerequisites
- Redis server running on localhost:6379 (or configure via environment variables)
- Node.js and npm installed
- PostgreSQL database configured

## Installation

The system is already integrated into your project. No additional installation needed.

## Configuration

### Environment Variables
Add to your `.env` file:
```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
```

## Usage

### 1. Start Redis Server
```bash
# Windows (if using WSL)
redis-server

# Or using Docker
docker run -d -p 6379:6379 redis:latest
```

### 2. Start Your Application
```bash
npm run dev
```

You should see:
```
🚀 Job queues, workers, and cron jobs initialized
📅 Booking cleanup cron job initialized (runs daily at 2:00 AM)
📅 Auto-complete cron job initialized (runs every hour)
```

### 3. Test the System

#### Create a Booking
```bash
POST /api/v1/booking
Authorization: Bearer <patient_token>
Content-Type: application/json

{
  "clinicId": "clinic_id",
  "doctorId": "doctor_id",
  "workingSlotId": "slot_id",
  "consultDate": "2026-02-20T00:00:00.000Z"
}
```

#### Confirm the Booking (This schedules notifications)
```bash
PATCH /api/v1/booking/{appointmentId}/confirm
Authorization: Bearer <doctor_token>
```

**Response:**
```json
{
  "success": true,
  "message": "Booking confirmed successfully. Notifications scheduled.",
  "data": {
    "id": "clx123abc",
    "status": "CONFIRMED",
    ...
  }
}
```

**Console Output:**
```
📅 Scheduled 24-hour notification for appointment clx123abc (delay: 1380 minutes)
📅 Scheduled 3-hour notification for appointment clx123abc (delay: 1620 minutes)
```

#### Check Redis
```bash
redis-cli
> GET booking:scheduled:clx123abc
"[\"clx123abc:24h\",\"clx123abc:3h\"]"
```

#### Cancel the Booking (This removes notifications)
```bash
PATCH /api/v1/booking/{appointmentId}/cancel
Authorization: Bearer <patient_token>
```

**Console Output:**
```
🗑️ Removed notification job clx123abc:24h for appointment clx123abc
🗑️ Removed notification job clx123abc:3h for appointment clx123abc
✅ Cancelled all notifications for appointment clx123abc
```

## Testing Notifications Immediately

For testing purposes, you can modify the delay calculation to trigger notifications immediately:

### Option 1: Modify the delay in scheduler service (for testing only)
```typescript
// In bookingScheduler.service.ts
const delay24Hours = 5000; // 5 seconds instead of calculated delay
const delay3Hours = 10000; // 10 seconds instead of calculated delay
```

### Option 2: Create a test endpoint
Add to `booking.controller.ts`:
```typescript
const testNotification = catchAsync(async (req: Request, res: Response) => {
  const { appointmentId } = req.params;
  
  // Schedule immediate notification (5 seconds delay)
  await bookingNotificationQueue.add(
    'test-notification',
    {
      appointmentId,
      // ... other required fields
      notificationType: '24_HOUR',
    },
    { delay: 5000 }
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Test notification scheduled for 5 seconds",
  });
});
```

## Monitoring

### Check Queue Status
```bash
# In Node.js console or create a monitoring endpoint
import { bookingNotificationQueue } from './app/jobs/queues/bookingQueue';

// Get job counts
const counts = await bookingNotificationQueue.getJobCounts();
console.log(counts);
// Output: { waiting: 5, active: 2, completed: 100, failed: 1, delayed: 10 }
```

### View Logs
```bash
# Watch for notification logs
npm run dev | grep "notification"
```

**Expected logs:**
- `📅 Scheduled 24-hour notification...` - When notification is scheduled
- `📨 Processing 24_HOUR notification...` - When worker picks up job
- `✅ Notification sent to patient...` - When notification is sent
- `🗑️ Removed notification job...` - When notification is cancelled

### Redis Monitoring
```bash
redis-cli
> KEYS booking:scheduled:*
> GET booking:scheduled:{appointmentId}
> TTL booking:scheduled:{appointmentId}
```

## Common Issues

### Issue: Jobs not processing
**Solution:**
1. Check Redis connection: `redis-cli ping` should return `PONG`
2. Check worker is running: Look for "Job queues and workers initialized" in logs
3. Restart the application

### Issue: Notifications not sent
**Solution:**
1. Verify appointment status is CONFIRMED
2. Check worker error logs
3. Verify patient/doctor/clinic data exists in database

### Issue: Redis connection error
**Solution:**
1. Start Redis server: `redis-server`
2. Check Redis host/port in `.env`
3. Test connection: `redis-cli ping`

## Production Deployment

### 1. Use Redis Cluster (for high availability)
```typescript
// In redisServer.ts
const redis = new Redis.Cluster([
  { host: 'redis-1', port: 6379 },
  { host: 'redis-2', port: 6379 },
  { host: 'redis-3', port: 6379 },
]);
```

### 2. Monitor with Bull Board (optional)
```bash
npm install @bull-board/express
```

```typescript
// In app.ts
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { bookingNotificationQueue } from './app/jobs/queues/bookingQueue';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(bookingNotificationQueue)],
  serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());
```

Access at: `http://localhost:5000/admin/queues`

### 3. Set up proper logging
```typescript
// Use winston or similar for production logging
import logger from './utils/logger';

worker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed`, { jobId: job.id, data: job.data });
});
```

### 4. Configure Redis persistence
```bash
# In redis.conf
save 900 1
save 300 10
save 60 10000
```

## API Examples

### Full Workflow Example
```bash
# 1. Create booking
curl -X POST http://localhost:5000/api/v1/booking \
  -H "Authorization: Bearer <patient_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "clinicId": "clinic_123",
    "doctorId": "doctor_456",
    "workingSlotId": "slot_789",
    "consultDate": "2026-02-20T00:00:00.000Z"
  }'

# 2. Confirm booking (schedules notifications)
curl -X PATCH http://localhost:5000/api/v1/booking/clx123abc/confirm \
  -H "Authorization: Bearer <doctor_token>"

# 3. Check Redis
redis-cli GET booking:scheduled:clx123abc

# 4. Cancel booking (removes notifications)
curl -X PATCH http://localhost:5000/api/v1/booking/clx123abc/cancel \
  -H "Authorization: Bearer <patient_token>"
```

## Next Steps

1. ✅ System is ready to use
2. 📧 Integrate email notifications (see documentation)
3. 📱 Integrate push notifications (FCM)
4. 📊 Set up monitoring dashboard (Bull Board)
5. 🧪 Write unit tests
6. 📈 Monitor performance in production

## Support

For detailed information, see:
- [Full Documentation](./BOOKING_NOTIFICATION_SYSTEM.md)
- [Architecture Details](./BOOKING_NOTIFICATION_SYSTEM.md#architecture)
- [Troubleshooting Guide](./BOOKING_NOTIFICATION_SYSTEM.md#troubleshooting)
