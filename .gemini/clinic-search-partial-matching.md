# Clinic Search - Partial Matching Implementation

## Overview
The `getClinics` function now supports **partial matching** across multiple fields in both the User and Clinic models.

## How Partial Matching Works

### 1. **Prisma `contains` Operator**
The `contains` operator performs a partial text search (like SQL's `LIKE '%searchTerm%'`):
```typescript
{ phoneNumber: { contains: searchTerm, mode: "insensitive" } }
```

### 2. **Case-Insensitive Search**
Using `mode: "insensitive"` makes the search case-insensitive:
- Searching for "john" will match "John", "JOHN", "JoHn", etc.

### 3. **Searchable Fields**

#### User Fields (Direct):
- `fullName`
- `email`
- `phoneNumber`
- `city`
- `country`
- `address`
- `gender`

#### Clinic Fields (Related):
- `clinicName`
- `managerName`
- `managerPhone`
- `about`
- `location`
- `contactPhone`

## Example Searches

### Phone Number Search
```
Search: "123"
Matches: "+1234567890", "0123456789", "555-123-4567"
```

### Clinic Name Search
```
Search: "care"
Matches: "Healthcare Center", "Primary Care Clinic", "Urgent Care"
```

### Manager Name Search
```
Search: "john"
Matches: "John Smith", "Johnny Doe", "Johnson"
```

## Implementation Details

### Query Structure
```typescript
if (searchTerm) {
  andConditions.push({
    OR: [
      // User fields
      { fullName: { contains: searchTerm, mode: "insensitive" } },
      { phoneNumber: { contains: searchTerm, mode: "insensitive" } },
      
      // Clinic fields (through relation)
      { clinic: { clinicName: { contains: searchTerm, mode: "insensitive" } } },
      { clinic: { managerPhone: { contains: searchTerm, mode: "insensitive" } } },
      // ... more fields
    ]
  });
}
```

### Why This Works
Each clinic field is a **separate condition** in the OR array using the syntax:
```typescript
{ clinic: { fieldName: { contains: searchTerm } } }
```

This tells Prisma to:
1. Join the User table with the Clinic table
2. Search for the term in the specified clinic field
3. Return the user if ANY of the OR conditions match

## Debugging

### Console Logs
The function includes debug logging:
```typescript
console.log("searchTerm:", searchTerm);
console.log(`Found ${total} clinics matching search criteria`);
```

### Testing the Search
1. Make a request: `GET /api/v1/admin/clinics?searchTerm=test`
2. Check the console output for:
   - The trimmed search term
   - Total number of matches
   - Sample of the first result

## Common Issues & Solutions

### Issue: No results found
**Solutions:**
1. Verify data exists in the database
2. Check if the search term has extra spaces (now auto-trimmed)
3. Ensure the clinic relation exists for the user

### Issue: Search not working on clinic fields
**Solution:** 
✅ Fixed by flattening the OR conditions. Each clinic field is now a separate condition.

### Issue: Case-sensitive search
**Solution:**
✅ Using `mode: "insensitive"` for all fields

## Performance Considerations

- **Indexes**: The schema has indexes on `phoneNumber` and `role` for faster queries
- **Pagination**: Always use pagination to limit result sets
- **Selective Fields**: Only necessary fields are selected to reduce data transfer

## API Usage

### Request
```http
GET /api/v1/admin/clinics?searchTerm=john&page=1&limit=10
```

### Response
```json
{
  "success": true,
  "message": "Clinics retrieved successfully",
  "data": {
    "meta": {
      "page": 1,
      "limit": 10,
      "total": 5
    },
    "data": [
      {
        "id": "...",
        "phoneNumber": "+1234567890",
        "clinicName": "John's Healthcare",
        "managerName": "John Smith",
        "managerPhone": "+0987654321",
        // ... other fields
      }
    ]
  }
}
```

## Notes
- The search is **partial** - searching "123" will find "01234", "91234", "12345"
- The search is **case-insensitive** - searching "john" will find "John", "JOHN"
- The search uses **OR logic** - matching ANY field will return the result
- Search term is **automatically trimmed** to remove leading/trailing spaces
