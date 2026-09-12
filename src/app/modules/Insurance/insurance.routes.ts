import express from "express";
import auth from "../../middlewares/auth";
import { InsuranceController } from "./insurance.controller";
import { s3Uploader } from "../../../helpars/s3Bucket/fileUploadToS3";
import { UserRole } from "@prisma/client";

const router = express.Router();

const imageUpload = s3Uploader.single("image");

// Create insurance (admin only)
router.post(
  "/",
  auth(UserRole.ADMIN),
  imageUpload,
  InsuranceController.createInsurance,
);

// Get all insurances
router.get("/", InsuranceController.getAllInsurances);

// Get insurance by id
router.get("/:id", InsuranceController.getInsuranceById);

// Update insurance (admin only)
router.patch(
  "/:id",
  auth(UserRole.ADMIN),
  imageUpload,
  InsuranceController.updateInsurance,
);

// Delete insurance (admin only)
router.delete(
  "/:id",
  auth(UserRole.ADMIN),
  InsuranceController.deleteInsurance,
);

export const InsuranceRoutes = router;
