import express from "express";
import { PatientPlatformSubscriptionController } from "./patientPlatformSubscription.controller";
import auth from "../../middlewares/auth";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { AdminTier, UserRole } from "@prisma/client";

const router = express.Router();

router.post(
  "/create-or-update",
  auth(UserRole.ADMIN), adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  PatientPlatformSubscriptionController.createOrUpdateSubscription,
);

router.get("/", PatientPlatformSubscriptionController.getAllSubscriptions);


router.get(
  "/:country",
  PatientPlatformSubscriptionController.getSubscriptionByCountry,
);

router.patch(
  "/:country",
  auth(UserRole.ADMIN), adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  PatientPlatformSubscriptionController.updateSubscription,
);

router.delete(
  "/:country",
  auth(UserRole.ADMIN), adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  PatientPlatformSubscriptionController.deleteSubscription,
);

export const PatientPlatformSubscriptionRoutes = router;
