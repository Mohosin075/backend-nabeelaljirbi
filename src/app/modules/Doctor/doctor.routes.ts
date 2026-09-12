import express from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "@prisma/client";
import { DoctorController } from "./doctor.controller";
import { doctorValidation } from "./doctor.validation";

const router = express.Router();

import { s3Uploader } from "../../../helpars/s3Bucket/fileUploadToS3";

const fileUpload = s3Uploader.fields([{ name: "profilePicture", maxCount: 1 }, { name: "biography", maxCount: 1 }]);
const insuranceFileUpload = s3Uploader.single("image");

router.patch(
  "/profile-update",
  auth(),
  fileUpload,
  // validateRequest(doctorValidation.updateDoctorProfileValidationSchema),
  DoctorController.updateDoctorProfile
);

router.get(
  "/profile",
  auth(),
  DoctorController.getDoctorProfile
);

router.post(
  "/working-hours",
  auth(),
  DoctorController.addWorkingHours
);

router.get(
  "/working-hours",
  auth(),
  DoctorController.getWorkingHoursByDay
);

router.get(
  "/appointments",
  auth(),
  DoctorController.getAppointments
);

router.post(
  "/insurance",
  auth(),
  insuranceFileUpload,
  DoctorController.createDoctorInsurance
);

router.get(
  "/insurance",
  auth(),
  DoctorController.getDoctorInsurances
);

router.patch(
  "/insurance/:insuranceId",
  auth(),
  insuranceFileUpload,
  DoctorController.updateDoctorInsurance
);

router.delete(
  "/insurance/:insuranceId",
  auth(),
  DoctorController.deleteDoctorInsurance
);

export const DoctorRoutes = router;
