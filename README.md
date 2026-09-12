# 🏥 Medical App Backend - Nabeel Aljirbi

A comprehensive medical appointment booking system with phone-based OTP authentication, supporting three user roles: **Patient**, **Doctor**, and **Clinic**.

## 🌟 Features

- 📱 **Phone-Based Authentication** - OTP via SMS & WhatsApp (Twilio)
- 👥 **Multi-Role System** - Patient, Doctor, Clinic, and Admin
- 📅 **Appointment Booking** - Slot-based booking with capacity management
- ⭐ **Doctor Ratings** - Patients can rate doctors after completed appointments
- 📍 **Location-Based Search** - Find nearest clinics using GPS coordinates
- 🔍 **Advanced Filtering** - Search doctors by rating, fee, city, country
- 💰 **Wallet System** - Track patient and doctor wallet balances
- 🎁 **Referral Program** - Track and reward user referrals
- 🏥 **Clinic Management** - Specialists, insurance, and photo galleries
- ⏰ **Working Hours** - Doctors can set availability schedules

## 🚀 Quick Start

### Prerequisites
- Node.js (v18+)
- PostgreSQL database
- Twilio account (for OTP)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd nabeelaljirbi-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   
   Create a `.env` file in the root directory:
   ```env
   # Database
   DATABASE_URL="postgresql://user:password@host:port/database"
   
   # Server
   NODE_ENV=development
   PORT=8003
   
   # Twilio (OTP)
   TWILIO_ACCOUNT_SID=your_account_sid
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_PHONE_NUMBER=+1234567890
   
   # JWT
   JWT_SECRET=your_jwt_secret_key
   EXPIRES_IN=1d
   REFRESH_TOKEN_SECRET=your_refresh_token_secret
   REFRESH_TOKEN_EXPIRES_IN=7d
   
   # Frontend
   FRONTEND_URL=http://localhost:3000
   BACKEND_IMAGE_URL=http://localhost:8003/uploads
   ```

4. **Setup database**
   ```bash
   # Generate Prisma Client
   npx prisma generate
   
   # Push schema to database
   npx prisma db push
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:8003`

## 📚 Documentation

- **[API Documentation](./API_DOCUMENTATION.md)** - Complete API reference with examples
- **[Implementation Summary](./IMPLEMENTATION_SUMMARY.md)** - Feature checklist and architecture overview
- **[API Testing Guide](./API_TESTING_GUIDE.md)** - cURL examples and testing workflows

## 🏗️ Project Structure

```
nabeelaljirbi-backend/
├── prisma/
│   └── schema.prisma          # Database schema
├── src/
│   ├── app/
│   │   ├── middlewares/       # Auth, validation, error handling
│   │   ├── modules/           # Feature modules
│   │   │   ├── Auth/          # OTP authentication
│   │   │   ├── Patient/       # Patient management
│   │   │   ├── Doctor/        # Doctor management
│   │   │   ├── Clinic/        # Clinic management
│   │   │   ├── Booking/       # Appointment booking
│   │   │   ├── Rating/        # Doctor ratings
│   │   │   └── Referral/      # Referral system
│   │   └── routes/            # Route configuration
│   ├── config/                # App configuration
│   ├── utils/                 # Helper functions
│   └── server.ts             # Entry point
├── .env                       # Environment variables
└── package.json
```

## 🔑 Authentication Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant Twilio
    participant Database

    Client->>API: POST /auth/send-otp (phoneNumber)
    API->>Database: Create/Update user with OTP
    API->>Twilio: Send SMS & WhatsApp OTP
    Twilio-->>Client: Receive OTP
    Client->>API: POST /auth/verify-otp (phoneNumber, otp)
    API->>Database: Verify OTP
    API-->>Client: Return access & refresh tokens
```

## 👥 User Roles

### Patient 🧑‍⚕️
- Complete profile with personal information
- Search and filter doctors
- Find nearest clinics
- Book appointments
- Rate doctors after appointments
- Manage wallet balance

### Doctor 👨‍⚕️
- Complete professional profile
- Set working hours and availability
- View appointment bookings
- Link to clinic
- Manage wallet earnings

### Clinic 🏥
- Manage clinic information
- Add specialists and specialties
- Upload insurance information
- Create photo galleries
- Update appointment statuses
- View all clinic bookings

## 🗄️ Database Schema

Built with **Prisma ORM** and **PostgreSQL**

### Main Models:
- **User** - Base user model with phone authentication
- **Patient** - Patient-specific data (location, wallet)
- **Doctor** - Doctor-specific data (specialty, experience, fees)
- **Clinic** - Clinic details and management
- **BookingAppointment** - Appointment bookings
- **WorkingHours** - Doctor availability schedules
- **Rating** - Doctor ratings by patients
- **Referral** - User referral tracking

## 🔌 API Endpoints

### Authentication
- `POST /api/v1/auth/send-otp` - Send OTP to phone
- `POST /api/v1/auth/verify-otp` - Verify OTP and login
- `POST /api/v1/auth/refresh-token` - Refresh access token

### Patient
- `PATCH /api/v1/patient/profile` - Update profile
- `GET /api/v1/patient/profile` - Get profile
- `GET /api/v1/patient/doctors/popular` - Get popular doctors
- `GET /api/v1/patient/clinics/nearest` - Get nearest clinics

### Doctor
- `PATCH /api/v1/doctor/profile` - Update profile
- `GET /api/v1/doctor/profile` - Get profile
- `POST /api/v1/doctor/working-hours` - Add working hours
- `GET /api/v1/doctor/appointments` - Get appointments

### Clinic
- `PATCH /api/v1/clinic/profile` - Update clinic
- `POST /api/v1/clinic/specialists` - Add specialist
- `POST /api/v1/clinic/insurances` - Add insurance
- `POST /api/v1/clinic/galleries` - Add photos
- `PATCH /api/v1/clinic/bookings/status` - Update booking

### Booking
- `POST /api/v1/booking` - Create appointment
- `GET /api/v1/booking` - Get all bookings

### Rating
- `POST /api/v1/rating` - Rate a doctor
- `GET /api/v1/rating/doctor/:doctorId` - Get doctor ratings

### Referral
- `GET /api/v1/referral/code` - Get referral code
- `POST /api/v1/referral` - Create referral
- `GET /api/v1/referral/my-referrals` - Get referrals

## 🧪 Testing

### Using cURL
See [API_TESTING_GUIDE.md](./API_TESTING_GUIDE.md) for detailed examples.

### Using Postman
1. Import the API collection
2. Set environment variables:
   - `baseUrl`: http://localhost:8003
   - Save tokens after authentication
3. Follow the test sequence in the testing guide

### Quick Test
```bash
# 1. Send OTP
curl -X POST http://localhost:8003/api/v1/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+1234567890"}'

# 2. Verify OTP (use OTP from SMS/WhatsApp)
curl -X POST http://localhost:8003/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+1234567890", "otp": "123456"}'
```

## 🔒 Security

- JWT-based authentication
- Role-based access control (RBAC)
- Token expiration and refresh mechanism
- OTP with 5-minute expiration
- Password hashing (for future features)
- Input validation using Zod

## 📦 Tech Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Authentication**: JWT + Twilio OTP
- **Validation**: Zod
- **Development**: ts-node-dev

## 🎯 Key Features Implementation

### ✅ Phone Authentication
- Dual OTP delivery (SMS + WhatsApp)
- Automatic user creation on first login
- Token-based session management

### ✅ Smart Appointment Booking
- Slot availability checking
- Capacity management per time slot
- Serial number generation
- Three-stage status workflow

### ✅ Location-Based Search
- Haversine formula for distance calculation
- Auto-sorted nearest clinics
- Coordinate-based filtering

### ✅ Comprehensive Filtering
- Multi-criteria doctor search
- Rating-based sorting
- Fee range filtering
- Location-based results

## 📱 Figma Design Integration

The backend fully supports the Figma design requirements:
- Multi-step registration flow
- Role selection and profile completion
- Advanced search and filtering
- Booking flow with time slots
- Profile management screens
- Referral program interface

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch  
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License.

## 👨‍💻 Author

**Nabeel Aljirbi** - Medical Appointment Booking System

## 📞 Support

For issues, questions, or feature requests:
- Create an issue in the repository
- Contact: [your-email@example.com]

---

**Made with ❤️ for better healthcare access**
