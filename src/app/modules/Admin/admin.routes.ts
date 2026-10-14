import express from "express";
import auth from "../../middlewares/auth";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { AdminTier, UserRole } from "@prisma/client";
import { AdminController } from "./admin.controller";

const router = express.Router();

// General Stats & Directory
router.get("/stats", auth(UserRole.ADMIN), AdminController.AdminStats);
router.get("/get-doctor", auth(UserRole.ADMIN), AdminController.getDoctors);
router.get("/get-patient", auth(UserRole.ADMIN), AdminController.getPatients);
router.get("/get-clinic", auth(UserRole.ADMIN), AdminController.getClinics);

// Clinic Controls
router.patch(
  "/clinic-verified/:clinicId",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  AdminController.AdminClinicVerified
);
router.patch(
  "/clinic-visibility/:clinicId",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  AdminController.updateClinicVisibility
);
router.patch(
  "/set-service-free/:userId",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  AdminController.SetServiceFree
);

// Moderation & Suspension
router.patch(
  "/banned-user/:userId",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  AdminController.bannedUser
);
router.patch(
  "/suspend-doctor/:doctorId",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  AdminController.suspendDoctor
);
router.patch(
  "/suspend-clinic/:clinicId",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  AdminController.suspendClinic
);

// Wallet & Financials (Finance or Super Admin)
router.patch(
  "/update-wallet",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  AdminController.updateWallet
);
router.get(
  "/financial-overview",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  AdminController.getPlatformFinancialOverview
);
router.get(
  "/financial-ledger",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE, AdminTier.OPERATIONS, AdminTier.READ_ONLY),
  AdminController.getFinancialLedger
);

// Subscriptions
router.get(
  "/patient-platform-subscription",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  AdminController.getPatientPlatformSubscription
);
router.get(
  "/clinic-platform-subscription",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  AdminController.getClinicPlatformSubscription
);

// Push Notifications
router.post(
  "/patient-notification",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS, AdminTier.SUPPORT),
  AdminController.patientNotification
);
router.post(
  "/clinic-notification",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS, AdminTier.SUPPORT),
  AdminController.clinicNotification
);

// Booking Override
router.patch(
  "/appointments/:appointmentId/override-status",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  AdminController.overrideAppointmentStatus
);

// ================= SECTION 9: NEW CONTROL CENTER ROUTES =================

// 1. Admin Staff Management (Super Admin Only)
router.get(
  "/staff",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN),
  AdminController.getAdminStaff
);
router.post(
  "/staff",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN),
  AdminController.createAdminStaff
);
router.patch(
  "/staff/:staffId/tier",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN),
  AdminController.updateAdminStaffTier
);
router.patch(
  "/staff/:staffId/status",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN),
  AdminController.toggleAdminStaffStatus
);

// 2. Audit Logs (Super Admin & Operations)
router.get(
  "/audit-logs",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  AdminController.getAuditLogs
);

// 3. Platform Booking Settings
router.get("/booking-settings", auth(UserRole.ADMIN), AdminController.getBookingSettings);
router.patch(
  "/booking-settings",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  AdminController.updateBookingSettings
);

// 4. Settlements (Finance & Super Admin)
router.get(
  "/settlements",
  auth(UserRole.ADMIN, UserRole.CLINIC, UserRole.MANAGER),
  AdminController.getSettlements
);
router.post(
  "/settlements",
  auth(UserRole.ADMIN, UserRole.CLINIC, UserRole.MANAGER),
  AdminController.createSettlement
);
router.patch(
  "/settlements/:settlementId/status",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  AdminController.updateSettlementStatus
);

// 5. Complaints & Disputes
router.get(
  "/complaints",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.SUPPORT, AdminTier.OPERATIONS),
  AdminController.getComplaints
);
router.get(
  "/complaints/:complaintId",
  auth(UserRole.ADMIN),
  AdminController.getComplaintById
);
router.post(
  "/complaints",
  auth(UserRole.PATIENT, UserRole.DOCTOR, UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  AdminController.createComplaint
);
router.patch(
  "/complaints/:complaintId/resolve",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.SUPPORT, AdminTier.OPERATIONS),
  AdminController.resolveComplaint
);

export const AdminRoutes = router;
