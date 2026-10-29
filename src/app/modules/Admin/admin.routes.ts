import express from "express";
import auth from "../../middlewares/auth";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { AdminTier, UserRole } from "@prisma/client";
import { AdminController } from "./admin.controller";
import prisma from "../../../shared/prisma";
import catchAsync from "../../../shared/catchAsync";
import ApiError from "../../../errors/ApiErrors";
import { money } from "../../../utils/money";

const router = express.Router();

router.patch("/clinic-payment-settings/:clinicId", auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE), catchAsync(async (req, res) => {
    const clinic = await prisma.clinic.findFirst({ where: { OR: [{ id: req.params.clinicId }, { userId: req.params.clinicId }] } });
    if (!clinic) throw new ApiError(404, "Clinic not found");
    const { collectionMode, serviceFeePercentage } = req.body;
    if (!["MODE_A", "MODE_B"].includes(collectionMode)) throw new ApiError(400, "Select Model A or Model B");
    const percentage = money(serviceFeePercentage);
    if (percentage > 100) throw new ApiError(400, "Patient fee percentage must not exceed 100");
    const result = await prisma.$transaction(async tx => {
      const updated = await tx.clinic.update({ where: { id: clinic.id }, data: { collectionMode, serviceFeePercentage: percentage } });
      await tx.adminAuditLog.create({ data: {
        adminId: req.user.id, adminTier: req.user.adminTier, action: "CLINIC_PAYMENT_SETTINGS_UPDATED",
        targetType: "CLINIC", targetId: clinic.id,
        details: { before: { collectionMode: clinic.collectionMode, serviceFeePercentage: clinic.serviceFeePercentage }, after: { collectionMode, serviceFeePercentage: percentage } },
      } });
      return updated;
    });
    res.json({ success: true, message: "Clinic payment settings updated for future bookings", data: result });
  }));

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
  "/doctor-verified/:doctorId",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  AdminController.AdminDoctorVerified
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
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE, AdminTier.READ_ONLY),
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
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE, AdminTier.READ_ONLY),
  AdminController.getPatientPlatformSubscription
);
router.get(
  "/clinic-platform-subscription",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE, AdminTier.READ_ONLY),
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

// 2. Audit Logs (All Admin Tiers)
router.get(
  "/audit-logs",
  auth(UserRole.ADMIN),
  adminTierAuth(
    AdminTier.SUPER_ADMIN,
    AdminTier.OPERATIONS,
    AdminTier.FINANCE,
    AdminTier.SUPPORT,
    AdminTier.READ_ONLY
  ),
  AdminController.getAuditLogs
);

// 3. Platform Booking Settings
router.get(
  "/booking-settings",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS, AdminTier.READ_ONLY),
  AdminController.getBookingSettings
);
router.patch(
  "/booking-settings",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  AdminController.updateBookingSettings
);

// 4. Settlements (Finance, Super Admin & Clinic)
router.get(
  "/settlements",
  auth(UserRole.ADMIN, UserRole.CLINIC),
  (req: any, res: any, next: any) => {
    if (req.user?.role === UserRole.CLINIC) return next();
    return adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE, AdminTier.READ_ONLY)(req, res, next);
  },
  AdminController.getSettlements
);
router.post(
  "/settlements",
  auth(UserRole.ADMIN, UserRole.CLINIC),
  (req: any, res: any, next: any) => {
    if (req.user?.role === UserRole.CLINIC) return next();
    return adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE)(req, res, next);
  },
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
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.SUPPORT, AdminTier.OPERATIONS, AdminTier.READ_ONLY),
  AdminController.getComplaints
);
router.get(
  "/complaints/:complaintId",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.SUPPORT, AdminTier.OPERATIONS, AdminTier.READ_ONLY),
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
