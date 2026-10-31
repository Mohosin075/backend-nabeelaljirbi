import { AdminTier, UserRole } from "@prisma/client";
import adminTierAuth from "../../middlewares/adminTierAuth";
import express from "express";
import auth from "../../middlewares/auth";
import { PaymentController } from "./payment.controller";

const router = express.Router();
router.use(auth(UserRole.PATIENT, UserRole.DOCTOR, UserRole.CLINIC, UserRole.ADMIN), (req, res, next) => {
  if (req.user.role !== UserRole.ADMIN) return next();
  return adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE, AdminTier.READ_ONLY)(req, res, next);
});

router.get(
  "/generate-onboarding-link",
  PaymentController.StripeGenerateOnboardingLink,
);

router.post("/patient-top-up", PaymentController.CreatePatientPayment);

router.post("/withdraw-payment", PaymentController.withdraBalance);

router.post(
  "/patient-platform-subscription",
  PaymentController.PatientPlatformSubscription,
);

router.post(
  "/clinic-platform-subscription",
  PaymentController.ClinicPlatformSubscription,
);

router.get("/top-up-history", PaymentController.getTopUpHistory);

router.get("/withdraw-history", PaymentController.getWithdrawHistory);

router.get(
  "/patient-platform-subscription",
  PaymentController.getPatientPlatformSubscription,
);

router.get(
  "/clinic-platform-subscription",
  PaymentController.getClinicPlatformSubscription,
);

router.post(
  "/doctor-platform-subscription",
  PaymentController.ClinicPlatformSubscription,
);

router.get(
  "/doctor-platform-subscription",
  PaymentController.getClinicPlatformSubscription,
);

export const PaymentRoutes = router;
