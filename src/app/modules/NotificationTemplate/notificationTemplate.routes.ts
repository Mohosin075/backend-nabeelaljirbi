import express from "express";
import { AdminTier, UserRole } from "@prisma/client";
import auth from "../../middlewares/auth";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { NotificationTemplateController } from "./notificationTemplate.controller";

const router = express.Router();

router.get("/", auth(), NotificationTemplateController.getAllTemplates);
router.post(
  "/seed",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  NotificationTemplateController.seedDefaultTemplates
);
router.get("/event/:eventKey", auth(), NotificationTemplateController.getTemplateByEventKey);
router.get("/:id", auth(), NotificationTemplateController.getTemplateById);
router.post(
  "/",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  NotificationTemplateController.createTemplate
);
router.patch(
  "/:id",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  NotificationTemplateController.updateTemplate
);
router.delete(
  "/:id",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  NotificationTemplateController.deleteTemplate
);

export const NotificationTemplateRoutes = router;
