-- Additive upgrade only. Run against a restored staging backup before production.
-- No enum replacement, UPDATE, DELETE, DROP, TRUNCATE or historical balance rewrite.
-- Existing installations use the versioned SQL upgrades in this directory; do
-- not run migrate reset/db push or invent a Prisma migration baseline on prod.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Never coerce a pre-existing field with the same name into another type.
DO $$
DECLARE mismatch RECORD;
BEGIN
  SELECT c.table_name, c.column_name, c.udt_name, expected.udt_name AS expected_type
  INTO mismatch
  FROM information_schema.columns c
  JOIN (VALUES
    ('users','profileApproved','bool'),
    ('users','remoteConsultationsEnabled','bool'),
    ('users','bankDetails','jsonb'),
    ('booking_appointments','absenceType','text'),
    ('booking_appointments','feeCountry','text'),
    ('patient_service_fees','modelBPercentage','float8'),
    ('patient_service_fees','clinicFeePercentage','float8'),
    ('settlements','payoutMethod','text'),
    ('settlements','payoutCountry','text'),
    ('settlements','bankDetails','jsonb'),
    ('platform_booking_settings','arrivalWindowHours','int4')
  ) AS expected(table_name, column_name, udt_name)
  ON c.table_name = expected.table_name AND c.column_name = expected.column_name
  WHERE c.table_schema = 'public' AND c.udt_name <> expected.udt_name LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Existing %.% has type %, expected %. No conversion was attempted.',
      mismatch.table_name, mismatch.column_name, mismatch.udt_name, mismatch.expected_type;
  END IF;
END $$;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profileApproved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "remoteConsultationsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bankDetails" JSONB;
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "absenceType" TEXT;
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "feeCountry" TEXT;
ALTER TABLE "patient_service_fees" ADD COLUMN IF NOT EXISTS "modelBPercentage" DOUBLE PRECISION;
ALTER TABLE "patient_service_fees" ADD COLUMN IF NOT EXISTS "clinicFeePercentage" DOUBLE PRECISION;
ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "payoutMethod" TEXT;
ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "payoutCountry" TEXT;
ALTER TABLE "settlements" ADD COLUMN IF NOT EXISTS "bankDetails" JSONB;
ALTER TABLE "platform_booking_settings" ADD COLUMN IF NOT EXISTS "arrivalWindowHours" INTEGER NOT NULL DEFAULT 3;
CREATE TABLE IF NOT EXISTS "profile_change_requests" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "changes" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "adminResponse" TEXT,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "profile_change_requests_userId_status_idx" ON "profile_change_requests"("userId", "status");
COMMIT;
