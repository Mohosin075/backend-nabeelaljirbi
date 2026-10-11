import express from "express";
import auth from "../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { VerificationController } from "./verification.controller";
import multer from "multer";
import { fileFilter } from "../../../helpars/file/fileFilter";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
});

// User verification document upload, submission and status
router.post(
  "/upload",
  auth(UserRole.DOCTOR, UserRole.CLINIC, UserRole.MANAGER),
  upload.single("file"),
  VerificationController.uploadDocument
);

router.post(
  "/submit",
  auth(UserRole.DOCTOR, UserRole.CLINIC, UserRole.MANAGER),
  VerificationController.submitVerification
);

router.get(
  "/my-status",
  auth(UserRole.DOCTOR, UserRole.CLINIC, UserRole.MANAGER),
  VerificationController.getMyStatus
);

// Admin controls
router.get(
  "/admin/list",
  auth(UserRole.ADMIN),
  VerificationController.getAdminVerifications
);

router.patch(
  "/admin/review",
  auth(UserRole.ADMIN),
  VerificationController.reviewVerification
);

router.patch(
  "/admin/toggle-badge",
  auth(UserRole.ADMIN),
  VerificationController.toggleBadgeActivation
);

export const VerificationRoutes = router;
