import express from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "@prisma/client";
import { PatientController } from "./patient.controller";
import { patientValidation } from "./patient.validation";
import { s3Uploader } from "../../../helpars/s3Bucket/fileUploadToS3";

const router = express.Router();

const fileUpload = s3Uploader.single("profilePicture");
const imageUpload = s3Uploader.single("image");

router.patch(
  "/profile-update",
  fileUpload,
  auth(),
  // validateRequest(patientValidation.updatePatientProfileValidationSchema),
  PatientController.updatePatientProfile
);

router.get(
  "/profile",
  auth(),
  PatientController.getPatientProfile
);

router.get(
  "/doctors/popular",
  auth(),
  PatientController.getPopularDoctors
);

router.get(
  "/clinics/nearest",
  auth(),
  PatientController.getNearestClinics
);

router.get(
  "/clinics/:clinicUserId",
  auth(),
  PatientController.getClinicDetailsById
);

router.get(
  "/get-clinic-doctors/:clinicUserId",
  auth(),
  PatientController.getClinicDoctors
);

router.get(
  "/get-doctor/:doctorId",
  auth(),
  PatientController.getDoctor
);


router.post(
  "/appointment-booking",
  auth(),
  PatientController.bookingAppointment
);

router.post(
  "/insurance",
  auth(),
  imageUpload,
  PatientController.createPatientInsurance
);

router.get(
  "/insurance",
  auth(),
  PatientController.getPatientInsurance
);

router.patch(
  "/update-insurance/:insuranceId",
  auth(),
  imageUpload,
  PatientController.updatePatientInsurance
);

router.delete(
  "/delete-insurance/:insuranceId",
  auth(),
  PatientController.deletePatientInsurance
);


router.patch(
  "/appointment-cancel/:bookingId",
  auth(),
  PatientController.cancelAppointment
);

router.patch(
  "/appointment-accept/:bookingId",
  auth(),
  PatientController.acceptAppointment
);


router.get(
  "/appointment-history",
  auth(),
  PatientController.getAppointmentHistory
);

export const PatientRoutes = router;
