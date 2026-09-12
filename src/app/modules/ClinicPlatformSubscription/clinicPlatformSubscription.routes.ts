import express from "express";
import { ClinicPlatformSubscriptionController } from "./clinicPlatformSubscription.controller";

const router = express.Router();

router.post(
  "/create-or-update",
  ClinicPlatformSubscriptionController.createOrUpdateSubscription,
);

router.get("/", ClinicPlatformSubscriptionController.getAllSubscriptions);

router.get(
  "/:country",
  ClinicPlatformSubscriptionController.getSubscriptionByCountry,
);

router.patch(
  "/:country",
  ClinicPlatformSubscriptionController.updateSubscription,
);

router.delete(
  "/:country",
  ClinicPlatformSubscriptionController.deleteSubscription,
);

export const ClinicPlatformSubscriptionRoutes = router;
