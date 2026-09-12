import express from "express";
import auth from "../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { AdminController } from "./admin.controller";

const router = express.Router();

router.get(
  "/stats",
  // auth(UserRole.ADMIN),
  AdminController.AdminStats
);

router.get(
  "/get-doctor",
  // auth(UserRole.ADMIN),
  AdminController.getDoctors
);

router.get(
  "/get-patient",
  // auth(UserRole.ADMIN),
  AdminController.getPatients
);

router.get(
  "/get-clinic",
  // auth(UserRole.ADMIN),
  AdminController.getClinics
);

router.patch(
  "/clinic-verified/:clinicId",
  // auth(UserRole.ADMIN),
  AdminController.AdminClinicVerified
);

router.patch(
  "/set-service-free/:userId",
  // auth(UserRole.ADMIN),
  AdminController.SetServiceFree
);

router.patch(
  "/banned-user/:userId",
  // auth(UserRole.ADMIN),
  AdminController.bannedUser
);

router.patch(
  "/update-wallet",
  // auth(UserRole.ADMIN),
  AdminController.updateWallet
);

router.get(
  "/patient-platform-subscription",
  // auth(UserRole.ADMIN),
  AdminController.getPatientPlatformSubscription
);

router.get(
  "/clinic-platform-subscription",
  // auth(UserRole.ADMIN),
  AdminController.getClinicPlatformSubscription
);

router.post(
  "/patient-notification",
  // auth(UserRole.ADMIN),
  AdminController.patientNotification
);

router.post(
  "/clinic-notification",
  // auth(UserRole.ADMIN),
  AdminController.clinicNotification
);


export const AdminRoutes = router;
