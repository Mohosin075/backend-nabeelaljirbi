import express from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { AdminTier, UserRole } from "@prisma/client";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { ClinicController } from "./clinic.controller";
import { AdminController } from "../Admin/admin.controller";
import { clinicValidation } from "./clinic.validation";
import { s3Uploader } from "../../../helpars/s3Bucket/fileUploadToS3";

const router = express.Router();

// Clinic staff use these operational endpoints directly; an Admin override is
// reserved for Super Admin because the Phase 1 spec calls it an exception path.
const requireSuperAdminForAdminOverride = (req: any, res: any, next: any) => {
  if (req.user?.role !== UserRole.ADMIN) return next();
  return adminTierAuth(AdminTier.SUPER_ADMIN)(req, res, next);
};
const adminReadAccess = (...tiers: AdminTier[]) => (req: any, res: any, next: any) => {
  if (req.user?.role !== UserRole.ADMIN) return next();
  return adminTierAuth(...tiers)(req, res, next);
};

router.get("/", ClinicController.getClinics);

const fileUpload = s3Uploader.single("companyLogo");
const imageUpload = s3Uploader.single("image");
const galleryUpload = s3Uploader.fields([
  { name: "images", maxCount: 20 },
]);

router.patch(
  "/update-info",
  auth(),
  fileUpload,
  ClinicController.updateClinicProfile
);

router.get(
  "/info",
  auth(UserRole.CLINIC),
  ClinicController.getClinicProfile
);

router.post(
  "/specialists",
  auth(UserRole.CLINIC),
  imageUpload,
  ClinicController.createClinicSpecialist
);

router.get(
  "/specialists",
  auth(UserRole.CLINIC),
  ClinicController.getClinicSpecialists
);

router.delete(
  "/specialists/:id",
  auth(UserRole.CLINIC),
  ClinicController.deleteClinicSpecialist
);

router.post(
  "/insurances",
  auth(UserRole.CLINIC),
  imageUpload,
  ClinicController.createClinicInsurance
);

router.get(
  "/insurances",
  auth(UserRole.CLINIC),
  ClinicController.getClinicInsurances
);

router.delete(
  "/insurances/:id",
  auth(UserRole.CLINIC),
  ClinicController.deleteClinicInsurance
);
router.post(
  "/galleries",
  auth(UserRole.CLINIC),
  galleryUpload,
  ClinicController.createPhotoGallery
);

router.get(
  "/galleries",
  auth(UserRole.CLINIC),
  ClinicController.getPhotoGalleries
);

router.delete(
  "/clear-galleries",
  auth(UserRole.CLINIC),
  ClinicController.clearPhotoGalleries
);

router.delete(
  "/galleries/:id",
  auth(UserRole.CLINIC),
  ClinicController.deletePhotoGallery
);

router.patch(
  "/bookings/status",
  auth(UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  requireSuperAdminForAdminOverride,
  validateRequest(clinicValidation.updateBookingStatusValidationSchema),
  ClinicController.updateBookingStatus
);

router.get(
  "/manager-stats",
  auth(UserRole.CLINIC, UserRole.MANAGER),
  ClinicController.getClinicManagerStats
);

router.get(
  "/stats",
  auth(UserRole.CLINIC, UserRole.MANAGER),
  ClinicController.getClinicStats
);

router.patch(
  "/update/appointment-status",
  auth(UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN, UserRole.DOCTOR),
  requireSuperAdminForAdminOverride,
  validateRequest(clinicValidation.updateBookingStatusValidationSchema),
  ClinicController.updateAppointmentStatus
);

router.patch(
  "/manager-update/appointment-status",
  auth(UserRole.MANAGER, UserRole.CLINIC, UserRole.ADMIN),
  requireSuperAdminForAdminOverride,
  validateRequest(clinicValidation.updateBookingStatusValidationSchema),
  ClinicController.managerUpdateAppointmentStatus
);

router.get(
  "/doctor-absence/caseload",
  auth(UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  ClinicController.getDoctorAbsenceCaseload
);

router.post(
  "/doctor-absence/execute",
  auth(UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(clinicValidation.executeDoctorAbsenceValidationSchema),
  ClinicController.executeDoctorAbsence
);

router.patch(
  "/remove-clinic-doctor/:doctorId",
  auth(UserRole.CLINIC),
  ClinicController.removeDoctorFromClinic
);

router.get(
  "/booking-history",
  auth(UserRole.CLINIC, UserRole.MANAGER),
  ClinicController.getBookingHistory
);

router.get(
  "/manager/booking-history",
  auth(UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  ClinicController.getManagerBookingHistory
);

router.get(
  "/doctors",
  auth(UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  ClinicController.getClinicDoctor
);

router.get(
  "/manager/doctors",
  auth(UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  ClinicController.getClinicManagerDoctor
);

router.get(
  "/doctor-appointments",
  auth(UserRole.CLINIC, UserRole.MANAGER),
  ClinicController.getDoctorAppointments
);

router.get(
  "/doctor-appointments/:doctorId",
  auth(UserRole.CLINIC, UserRole.MANAGER),
  ClinicController.getDoctorAppointments
);

router.get(
  "/join-requests",
  auth(UserRole.CLINIC),
  ClinicController.getClinicJoinRequests
);

router.patch(
  "/join-request/:requestId/status",
  auth(UserRole.CLINIC),
  validateRequest(clinicValidation.respondJoinRequestValidationSchema),
  ClinicController.respondJoinRequest
);

router.get(
  "/reconciliation-reports",
  auth(UserRole.CLINIC, UserRole.ADMIN),
  adminReadAccess(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS, AdminTier.FINANCE, AdminTier.READ_ONLY),
  ClinicController.getClinicReconciliationReports
);

router.get(
  "/financial-summary",
  auth(UserRole.CLINIC, UserRole.ADMIN),
  adminReadAccess(AdminTier.SUPER_ADMIN, AdminTier.FINANCE, AdminTier.READ_ONLY),
  ClinicController.getClinicFinancialSummary
);

router.get(
  "/settlements",
  auth(UserRole.CLINIC, UserRole.ADMIN),
  adminReadAccess(AdminTier.SUPER_ADMIN, AdminTier.FINANCE, AdminTier.READ_ONLY),
  AdminController.getSettlements
);

router.post(
  "/settlements",
  auth(UserRole.CLINIC, UserRole.ADMIN),
  adminReadAccess(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  AdminController.createSettlement
);

export const ClinicRoutes = router;
