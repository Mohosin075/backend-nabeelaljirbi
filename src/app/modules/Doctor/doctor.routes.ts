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
  auth(UserRole.DOCTOR),
  fileUpload,
  // validateRequest(doctorValidation.updateDoctorProfileValidationSchema),
  DoctorController.updateDoctorProfile
);

router.get(
  "/profile",
  auth(UserRole.DOCTOR),
  DoctorController.getDoctorProfile
);

router.post(
  "/working-hours",
  auth(UserRole.DOCTOR),
  validateRequest(doctorValidation.addWorkingHoursValidationSchema),
  DoctorController.addWorkingHours
);

router.get(
  "/working-hours",
  auth(UserRole.DOCTOR),
  DoctorController.getWorkingHoursByDay
);

router.get(
  "/appointments",
  auth(UserRole.DOCTOR),
  DoctorController.getAppointments
);

router.post(
  "/insurance",
  auth(UserRole.DOCTOR),
  insuranceFileUpload,
  DoctorController.createDoctorInsurance
);

router.get(
  "/insurance",
  auth(UserRole.DOCTOR),
  DoctorController.getDoctorInsurances
);

router.patch(
  "/insurance/:insuranceId",
  auth(UserRole.DOCTOR),
  insuranceFileUpload,
  DoctorController.updateDoctorInsurance
);

router.delete(
  "/insurance/:insuranceId",
  auth(UserRole.DOCTOR),
  DoctorController.deleteDoctorInsurance
);

router.post(
  "/join-request",
  auth(UserRole.DOCTOR),
  validateRequest(doctorValidation.requestJoinClinicValidationSchema),
  DoctorController.requestJoinClinic
);

router.get(
  "/join-requests",
  auth(UserRole.DOCTOR),
  DoctorController.getDoctorJoinRequests
);

router.delete(
  "/join-request/:requestId",
  auth(UserRole.DOCTOR),
  DoctorController.cancelJoinRequest
);

router.get(
  "/reconciliation-reports",
  auth(UserRole.DOCTOR),
  DoctorController.getReconciliationReports
);

export const DoctorRoutes = router;
