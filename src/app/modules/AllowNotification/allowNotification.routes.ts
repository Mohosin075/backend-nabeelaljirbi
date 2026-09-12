
import express from "express";
import { AllowNotificationController } from "./allowNotification.controller";

const router = express.Router();

router.post("/", AllowNotificationController.createAllowNotification);
router.get("/", AllowNotificationController.getAllowNotifications);
router.get("/:id", AllowNotificationController.getAllowNotificationById);
router.patch("/:id", AllowNotificationController.updateAllowNotification);
router.delete("/:id", AllowNotificationController.deleteAllowNotification);

export const AllowNotificationRoutes = router;
