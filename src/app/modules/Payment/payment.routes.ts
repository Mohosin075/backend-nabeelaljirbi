import { UserRole } from "@prisma/client";
import express from "express";
import auth from "../../middlewares/auth";
import { PaymentController } from "./payment.controller";

const router = express.Router();

router.get(
  "/generate-onboarding-link",
  auth(),
  PaymentController.StripeGenerateOnboardingLink,
);

router.post("/patient-top-up", auth(), PaymentController.CreatePatientPayment);

router.post("/withdraw-payment", auth(), PaymentController.withdraBalance);

router.post(
  "/patient-platform-subscription",
  auth(),
  PaymentController.PatientPlatformSubscription,
);

router.post(
  "/clinic-platform-subscription",
  auth(),
  PaymentController.ClinicPlatformSubscription,
);

router.get("/top-up-history", auth(), PaymentController.getTopUpHistory);

router.get("/withdraw-history", auth(), PaymentController.getWithdrawHistory);

router.get(
  "/patient-platform-subscription",
  auth(),
  PaymentController.getPatientPlatformSubscription,
);

router.get(
  "/clinic-platform-subscription",
  auth(),
  PaymentController.getClinicPlatformSubscription,
);

export const PaymentRoutes = router;
