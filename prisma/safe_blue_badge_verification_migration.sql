-- Safe Non-Destructive Migration for Section 3 Blue Badge Verification
-- Adds verification and badge columns to Doctor and Clinic tables
-- Safe for Production: Zero table drops, zero column drops, zero data deletion.

-- 1. Doctor table verification columns
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "badgeActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED';
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "verificationDocuments" JSONB;
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "verificationNotes" TEXT;
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "verificationAdminNote" TEXT;
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "verificationSubmittedAt" TIMESTAMP(3);
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "verificationReviewedAt" TIMESTAMP(3);

-- 2. Clinic table verification columns
ALTER TABLE "Clinic" ADD COLUMN IF NOT EXISTS "badgeActive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Clinic" ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED';
ALTER TABLE "Clinic" ADD COLUMN IF NOT EXISTS "verificationDocuments" JSONB;
ALTER TABLE "Clinic" ADD COLUMN IF NOT EXISTS "verificationNotes" TEXT;
ALTER TABLE "Clinic" ADD COLUMN IF NOT EXISTS "verificationAdminNote" TEXT;
ALTER TABLE "Clinic" ADD COLUMN IF NOT EXISTS "verificationSubmittedAt" TIMESTAMP(3);
ALTER TABLE "Clinic" ADD COLUMN IF NOT EXISTS "verificationReviewedAt" TIMESTAMP(3);
