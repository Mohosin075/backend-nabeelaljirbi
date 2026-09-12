import express from "express";
import { PatientPlatformSubscriptionController } from "./patientPlatformSubscription.controller";
import auth from "../../middlewares/auth";

const router = express.Router();

router.post(
  "/create-or-update",
  PatientPlatformSubscriptionController.createOrUpdateSubscription,
);

router.get("/", PatientPlatformSubscriptionController.getAllSubscriptions);


router.get(
  "/:country",
  PatientPlatformSubscriptionController.getSubscriptionByCountry,
);

router.patch(
  "/:country",
  PatientPlatformSubscriptionController.updateSubscription,
);

router.delete(
  "/:country",
  PatientPlatformSubscriptionController.deleteSubscription,
);

export const PatientPlatformSubscriptionRoutes = router;
