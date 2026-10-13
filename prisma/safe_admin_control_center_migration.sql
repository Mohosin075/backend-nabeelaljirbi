-- Safe Non-Destructive Migration for Section 9 Main Admin Control Center
-- Safe for Production: Zero table drops, zero column drops, zero data deletion.

-- 1. Create AdminTier enum
DO $$ BEGIN
    CREATE TYPE "AdminTier" AS ENUM ('SUPER_ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT', 'READ_ONLY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Add adminTier to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "adminTier" "AdminTier" DEFAULT 'SUPER_ADMIN';

-- Backfill existing ADMIN users to SUPER_ADMIN if null
UPDATE "users" SET "adminTier" = 'SUPER_ADMIN' WHERE "role" = 'ADMIN' AND "adminTier" IS NULL;

-- 3. Add isVisible to clinics table (default: true)
ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "isVisible" BOOLEAN NOT NULL DEFAULT true;

-- 4. Create admin_audit_logs table
CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminName" TEXT,
    "adminTier" "AdminTier",
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "admin_audit_logs_adminId_idx" ON "admin_audit_logs"("adminId");
CREATE INDEX IF NOT EXISTS "admin_audit_logs_action_idx" ON "admin_audit_logs"("action");
CREATE INDEX IF NOT EXISTS "admin_audit_logs_targetType_idx" ON "admin_audit_logs"("targetType");
CREATE INDEX IF NOT EXISTS "admin_audit_logs_createdAt_idx" ON "admin_audit_logs"("createdAt");

-- 5. Create settlements table
CREATE TABLE IF NOT EXISTS "settlements" (
    "id" TEXT NOT NULL,
    "settlementNumber" TEXT NOT NULL,
    "partyType" TEXT NOT NULL,
    "clinicId" TEXT,
    "doctorId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "receiptUrl" TEXT,
    "notes" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "processedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "settlements_settlementNumber_key" UNIQUE ("settlementNumber"),
    CONSTRAINT "settlements_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "settlements_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "settlements_processedByAdminId_fkey" FOREIGN KEY ("processedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "settlements_partyType_idx" ON "settlements"("partyType");
CREATE INDEX IF NOT EXISTS "settlements_status_idx" ON "settlements"("status");
CREATE INDEX IF NOT EXISTS "settlements_clinicId_idx" ON "settlements"("clinicId");
CREATE INDEX IF NOT EXISTS "settlements_doctorId_idx" ON "settlements"("doctorId");

-- 6. Create complaints table
CREATE TABLE IF NOT EXISTS "complaints" (
    "id" TEXT NOT NULL,
    "complaintNumber" TEXT NOT NULL,
    "complainantId" TEXT NOT NULL,
    "complainantRole" "UserRole" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "bookingId" TEXT,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "adminNotes" TEXT,
    "resolution" TEXT,
    "resolvedByAdminId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "complaints_complaintNumber_key" UNIQUE ("complaintNumber"),
    CONSTRAINT "complaints_complainantId_fkey" FOREIGN KEY ("complainantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "complaints_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "complaints_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "booking_appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "complaints_complainantId_idx" ON "complaints"("complainantId");
CREATE INDEX IF NOT EXISTS "complaints_status_idx" ON "complaints"("status");
CREATE INDEX IF NOT EXISTS "complaints_targetType_idx" ON "complaints"("targetType");

-- 7. Create platform_booking_settings table
CREATE TABLE IF NOT EXISTS "platform_booking_settings" (
    "id" TEXT NOT NULL,
    "advanceBookingDays" INTEGER NOT NULL DEFAULT 14,
    "cancellationCutoffHours" INTEGER NOT NULL DEFAULT 12,
    "reminder24hEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reminder3hEnabled" BOOLEAN NOT NULL DEFAULT true,
    "neglectedResolutionHours" INTEGER NOT NULL DEFAULT 12,
    "autoRejectTimeoutMinutes" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_booking_settings_pkey" PRIMARY KEY ("id")
);

-- Seed default booking setting if none exists
INSERT INTO "platform_booking_settings" ("id", "advanceBookingDays", "cancellationCutoffHours", "reminder24hEnabled", "reminder3hEnabled", "neglectedResolutionHours", "autoRejectTimeoutMinutes", "createdAt", "updatedAt")
SELECT 'default-platform-settings', 14, 12, true, true, 12, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "platform_booking_settings");
