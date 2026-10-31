
import express from "express";
import { AllowNotificationController } from "./allowNotification.controller";
import auth from "../../middlewares/auth";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { AdminTier, UserRole } from "@prisma/client";

const router = express.Router();

router.post("/", auth(UserRole.ADMIN), adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS), AllowNotificationController.createAllowNotification);
router.get("/", AllowNotificationController.getAllowNotifications);
router.get("/:id", AllowNotificationController.getAllowNotificationById);
router.patch("/:id", auth(UserRole.ADMIN), adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS), AllowNotificationController.updateAllowNotification);
router.delete("/:id", auth(UserRole.ADMIN), adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS), AllowNotificationController.deleteAllowNotification);

export const AllowNotificationRoutes = router;
