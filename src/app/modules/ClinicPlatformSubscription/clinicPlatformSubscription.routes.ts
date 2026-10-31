import express from "express";
import auth from "../../middlewares/auth";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { AdminTier, UserRole } from "@prisma/client";
import { ClinicPlatformSubscriptionController } from "./clinicPlatformSubscription.controller";

const router = express.Router();

router.post(
  "/create-or-update",
  auth(UserRole.ADMIN), adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  ClinicPlatformSubscriptionController.createOrUpdateSubscription,
);

router.get("/", ClinicPlatformSubscriptionController.getAllSubscriptions);

router.get(
  "/:country",
  ClinicPlatformSubscriptionController.getSubscriptionByCountry,
);

router.patch(
  "/:country",
  auth(UserRole.ADMIN), adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  ClinicPlatformSubscriptionController.updateSubscription,
);

router.delete(
  "/:country",
  auth(UserRole.ADMIN), adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  ClinicPlatformSubscriptionController.deleteSubscription,
);

export const ClinicPlatformSubscriptionRoutes = router;
