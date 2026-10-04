-- ============================================================================
-- Production-Safe Migration: Add Optional qualifications Column to doctors
-- Zero-Data-Loss: Adds nullable column if not exists. Never drops or alters data.
-- ============================================================================

ALTER TABLE "doctors" ADD COLUMN IF NOT EXISTS "qualifications" TEXT;
