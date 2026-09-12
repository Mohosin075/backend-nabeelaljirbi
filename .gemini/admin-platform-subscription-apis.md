# Admin Platform Subscription APIs

## Overview
Two new admin endpoints for retrieving patient and clinic platform subscriptions with comprehensive search, filter, and pagination capabilities.

---

## 1. Get Patient Platform Subscriptions

### Endpoint
```
GET /api/v1/admin/patient-platform-subscription
```

### Authentication
- **Role Required**: ADMIN (currently commented out)

### Query Parameters

#### Pagination
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Items per page (default: 10)
- `sortBy` (string, optional): Field to sort by
- `sortOrder` (string, optional): 'asc' or 'desc'

#### Search
- `searchTerm` (string, optional): Search across multiple fields

**Searchable Fields:**
- `phoneNumber`
- `fullName`
- `gender`
- `country`
- `city`
- `address`
- `email`

#### Filters
- `banned` (string, optional): Filter by banned status ('true' or 'false')

### Example Requests

```http
# Get all patient subscriptions
GET /api/v1/admin/patient-platform-subscription

# Search by phone number
GET /api/v1/admin/patient-platform-subscription?searchTerm=123

# Filter by banned users
GET /api/v1/admin/patient-platform-subscription?banned=true

# Search with pagination
GET /api/v1/admin/patient-platform-subscription?searchTerm=john&page=1&limit=20

# Combined search and filter
GET /api/v1/admin/patient-platform-subscription?searchTerm=cairo&banned=false&page=1&limit=10
```

### Response

```json
{
  "success": true,
  "message": "Patient platform subscriptions retrieved successfully",
  "data": {
    "meta": {
      "page": 1,
      "limit": 10,
      "total": 25
    },
    "data": [
      {
        "id": "subscription_id",
        "amount": 100.00,
        "card": "VISA",
        "usdAmount": 50.00,
        "active": true,
        "subscriptionId": "stripe_subscription_id",
        "createdAt": "2026-01-27T12:00:00.000Z",
        "updatedAt": "2026-01-27T12:00:00.000Z",
        "userId": "user_id",
        "phoneNumber": "+1234567890",
        "fullName": "John Doe",
        "gender": "Male",
        "country": "Egypt",
        "city": "Cairo",
        "address": "123 Main St",
        "email": "john@example.com",
        "profileImage": "https://...",
        "banned": false
      }
    ]
  }
}
```

---

## 2. Get Clinic Platform Subscriptions

### Endpoint
```
GET /api/v1/admin/clinic-platform-subscription
```

### Authentication
- **Role Required**: ADMIN (currently commented out)

### Query Parameters

#### Pagination
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Items per page (default: 10)
- `sortBy` (string, optional): Field to sort by
- `sortOrder` (string, optional): 'asc' or 'desc'

#### Search
- `searchTerm` (string, optional): Search across multiple fields

**Searchable Fields (User):**
- `phoneNumber`
- `fullName`
- `gender`
- `country`
- `city`
- `address`
- `email`

**Searchable Fields (Clinic):**
- `managerName`
- `managerPhone`
- `clinicName`
- `about`
- `contactPhone`
- `location`

#### Filters
- `banned` (string, optional): Filter by banned status ('true' or 'false')
- `adminVerified` (string, optional): Filter by admin verification status ('true' or 'false')

### Example Requests

```http
# Get all clinic subscriptions
GET /api/v1/admin/clinic-platform-subscription

# Search by clinic name
GET /api/v1/admin/clinic-platform-subscription?searchTerm=healthcare

# Filter by verified clinics
GET /api/v1/admin/clinic-platform-subscription?adminVerified=true

# Filter by banned status
GET /api/v1/admin/clinic-platform-subscription?banned=false

# Search with pagination
GET /api/v1/admin/clinic-platform-subscription?searchTerm=cairo&page=1&limit=20

# Combined search and filters
GET /api/v1/admin/clinic-platform-subscription?searchTerm=care&adminVerified=true&banned=false&page=1&limit=10
```

### Response

```json
{
  "success": true,
  "message": "Clinic platform subscriptions retrieved successfully",
  "data": {
    "meta": {
      "page": 1,
      "limit": 10,
      "total": 15
    },
    "data": [
      {
        "id": "subscription_id",
        "amount": 200.00,
        "card": "MASTERCARD",
        "usdAmount": 100.00,
        "active": true,
        "subscriptionId": "stripe_subscription_id",
        "createdAt": "2026-01-27T12:00:00.000Z",
        "updatedAt": "2026-01-27T12:00:00.000Z",
        "userId": "user_id",
        "phoneNumber": "+1234567890",
        "fullName": "Clinic Owner",
        "gender": "Male",
        "country": "Egypt",
        "city": "Cairo",
        "address": "456 Clinic St",
        "email": "clinic@example.com",
        "profileImage": "https://...",
        "banned": false,
        "managerName": "Manager Name",
        "managerPhone": "+0987654321",
        "logo": "https://...",
        "clinicName": "Healthcare Center",
        "about": "Premium healthcare services",
        "contactPhone": "+1111111111",
        "location": "Downtown Cairo",
        "adminVerified": true
      }
    ]
  }
}
```

---

## Features

### ✅ Partial Matching Search
Both endpoints support partial, case-insensitive search:
- Searching "123" will match "+1234567890", "0123456789"
- Searching "care" will match "Healthcare", "Primary Care"

### ✅ Multiple Filter Support
- Filter by `banned` status
- Filter by `adminVerified` status (clinic only)
- Combine multiple filters together

### ✅ Pagination
- Configurable page size
- Total count included in response
- Sorting support

### ✅ Comprehensive Data
- All subscription details
- Complete user information
- Clinic details (for clinic subscriptions)

---

## Implementation Details

### Search Logic
```typescript
// Patient subscriptions search
if (searchTerm) {
  andConditions.push({
    user: {
      OR: [
        { phoneNumber: { contains: searchTerm, mode: "insensitive" } },
        { fullName: { contains: searchTerm, mode: "insensitive" } },
        // ... more fields
      ]
    }
  });
}
```

### Filter Logic
```typescript
// Banned filter
if (banned !== undefined) {
  andConditions.push({
    user: { banned: banned === 'true' }
  });
}

// Admin verified filter (clinic only)
if (adminVerified !== undefined) {
  andConditions.push({
    user: {
      clinic: { adminVerified: adminVerified === 'true' }
    }
  });
}
```

---

## Database Models

### PurchasePatientPlatformSubscription
```prisma
model PurchasePatientPlatformSubscription {
  id             String   @id @default(cuid())
  userId         String
  amount         Float
  card           String
  usdAmount      Float
  active         Boolean  @default(true)
  subscriptionId String
  user           User     @relation(fields: [userId], references: [id])
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

### PurchaseClinicPlatformSubscription
```prisma
model PurchaseClinicPlatformSubscription {
  id             String   @id @default(cuid())
  userId         String
  amount         Float
  card           String
  usdAmount      Float
  active         Boolean  @default(true)
  subscriptionId String
  user           User     @relation(fields: [userId], references: [id])
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

---

## Testing

### Test Patient Subscriptions
```bash
# Basic retrieval
curl http://localhost:5000/api/v1/admin/patient-platform-subscription

# Search by name
curl "http://localhost:5000/api/v1/admin/patient-platform-subscription?searchTerm=john"

# Filter banned users
curl "http://localhost:5000/api/v1/admin/patient-platform-subscription?banned=true"
```

### Test Clinic Subscriptions
```bash
# Basic retrieval
curl http://localhost:5000/api/v1/admin/clinic-platform-subscription

# Search by clinic name
curl "http://localhost:5000/api/v1/admin/clinic-platform-subscription?searchTerm=healthcare"

# Filter verified clinics
curl "http://localhost:5000/api/v1/admin/clinic-platform-subscription?adminVerified=true"
```

---

## Notes

- Search is **partial** and **case-insensitive**
- All filters can be combined
- Default sorting is by `createdAt` (descending)
- Authentication is currently commented out for testing
- Both endpoints return flattened data for easier frontend consumption
