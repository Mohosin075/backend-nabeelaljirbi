import express from "express";
import auth from "../../middlewares/auth";
import { SpecialistController } from "./specialist.controller";
import { s3Uploader } from "../../../helpars/s3Bucket/fileUploadToS3";
import { UserRole } from "@prisma/client";

const router = express.Router();

const imageUpload = s3Uploader.single("image");

// Create specialist (admin only)
router.post(
  "/",
  auth(UserRole.ADMIN),
  imageUpload,
  SpecialistController.createSpecialist,
);

// Get all specialists
router.get("/", SpecialistController.getAllSpecialists);

// Get specialist by id
router.get("/:id", SpecialistController.getSpecialistById);

// Update specialist (admin only)
router.patch(
  "/:id",
  auth(UserRole.ADMIN),
  imageUpload,
  SpecialistController.updateSpecialist,
);

// Delete specialist (admin only)
router.delete(
  "/:id",
  auth(UserRole.ADMIN),
  SpecialistController.deleteSpecialist,
);

export const SpecialistRoutes = router;
