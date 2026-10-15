-- Safe Backend, Timezone & Data Integrity Migration
-- 100% Non-destructive: Adds timezone column to clinics with default 'Africa/Tripoli'
-- and adds performance composite indexes for high-concurrency booking operations

ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'Africa/Tripoli';

-- Indexes
CREATE INDEX IF NOT EXISTS "clinics_timezone_idx" ON "clinics"("timezone");
CREATE INDEX IF NOT EXISTS "booking_appointments_slot_date_status_idx" ON "booking_appointments"("workingSlotId", "consultDate", "status");
CREATE INDEX IF NOT EXISTS "booking_appointments_doc_clinic_date_status_idx" ON "booking_appointments"("doctorId", "clinicId", "consultDate", "status");
