import express from "express";
import { NotificationTemplateController } from "./notificationTemplate.controller";

const router = express.Router();

router.get("/", NotificationTemplateController.getAllTemplates);
router.post("/seed", NotificationTemplateController.seedDefaultTemplates);
router.get("/event/:eventKey", NotificationTemplateController.getTemplateByEventKey);
router.get("/:id", NotificationTemplateController.getTemplateById);
router.post("/", NotificationTemplateController.createTemplate);
router.patch("/:id", NotificationTemplateController.updateTemplate);
router.delete("/:id", NotificationTemplateController.deleteTemplate);

export const NotificationTemplateRoutes = router;
