-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable working_days
ALTER TABLE "working_days" ADD COLUMN IF NOT EXISTS "clinicId" TEXT;

-- Drop old unique constraint if present to allow clinic-specific unique days
DROP INDEX IF EXISTS "working_days_doctorId_day_key";

-- Create Table doctor_clinic_requests
CREATE TABLE IF NOT EXISTS "doctor_clinic_requests" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_clinic_requests_pkey" PRIMARY KEY ("id")
);

-- Create Table doctor_clinics
CREATE TABLE IF NOT EXISTS "doctor_clinics" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_clinics_pkey" PRIMARY KEY ("id")
);

-- Create Indexes
CREATE INDEX IF NOT EXISTS "working_days_doctorId_idx" ON "working_days"("doctorId");
CREATE INDEX IF NOT EXISTS "working_days_clinicId_idx" ON "working_days"("clinicId");
CREATE INDEX IF NOT EXISTS "doctor_clinic_requests_doctorId_idx" ON "doctor_clinic_requests"("doctorId");
CREATE INDEX IF NOT EXISTS "doctor_clinic_requests_clinicId_idx" ON "doctor_clinic_requests"("clinicId");
CREATE INDEX IF NOT EXISTS "doctor_clinics_doctorId_idx" ON "doctor_clinics"("doctorId");
CREATE INDEX IF NOT EXISTS "doctor_clinics_clinicId_idx" ON "doctor_clinics"("clinicId");

DO $$ BEGIN
    CREATE UNIQUE INDEX "doctor_clinics_doctorId_clinicId_key" ON "doctor_clinics"("doctorId", "clinicId");
EXCEPTION
    WHEN duplicate_table THEN null;
END $$;

-- Add Foreign Keys
ALTER TABLE "working_days" DROP CONSTRAINT IF EXISTS "working_days_clinicId_fkey";
ALTER TABLE "working_days" ADD CONSTRAINT "working_days_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "doctor_clinic_requests" DROP CONSTRAINT IF EXISTS "doctor_clinic_requests_doctorId_fkey";
ALTER TABLE "doctor_clinic_requests" ADD CONSTRAINT "doctor_clinic_requests_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "doctor_clinic_requests" DROP CONSTRAINT IF EXISTS "doctor_clinic_requests_clinicId_fkey";
ALTER TABLE "doctor_clinic_requests" ADD CONSTRAINT "doctor_clinic_requests_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "doctor_clinics" DROP CONSTRAINT IF EXISTS "doctor_clinic_requests_doctorId_fkey";
ALTER TABLE "doctor_clinics" ADD CONSTRAINT "doctor_clinics_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "doctor_clinics" DROP CONSTRAINT IF EXISTS "doctor_clinics_clinicId_fkey";
ALTER TABLE "doctor_clinics" ADD CONSTRAINT "doctor_clinics_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
