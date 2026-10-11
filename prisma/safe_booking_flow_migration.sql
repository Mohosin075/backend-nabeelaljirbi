-- Safe Booking Flow Migration (Phase 1)
-- 100% Non-destructive: Uses ADD COLUMN IF NOT EXISTS, DEFAULT values, and safe enum expansion

-- 1. Ensure REJECTED is in BookingStatus enum
DO $$ BEGIN
    ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Add columns to booking_appointments table
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "workingSlotId" TEXT;
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "holdAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "collectionMode" TEXT NOT NULL DEFAULT 'MODE_A';
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "consultFee" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "serviceFeePercentage" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "serviceFeeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "bookedFor" TEXT NOT NULL DEFAULT 'SELF';
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "familyMemberName" TEXT;
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "familyMemberRelation" TEXT;
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "approximateEstimatedTime" TEXT;
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "cancelledBy" TEXT;
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;

-- Index for workingSlotId on booking_appointments
CREATE INDEX IF NOT EXISTS "booking_appointments_workingSlotId_idx" ON "booking_appointments"("workingSlotId");

-- Foreign key for workingSlotId if not exists
DO $$ BEGIN
    ALTER TABLE "booking_appointments" 
    ADD CONSTRAINT "booking_appointments_workingSlotId_fkey" 
    FOREIGN KEY ("workingSlotId") REFERENCES "working_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Add columns to clinics table
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "collectionMode" TEXT NOT NULL DEFAULT 'MODE_A';
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "advanceBookingDays" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "serviceFeePercentage" DOUBLE PRECISION NOT NULL DEFAULT 10.0;

-- 4. Add columns to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "frozenWallet" DOUBLE PRECISION NOT NULL DEFAULT 0;
