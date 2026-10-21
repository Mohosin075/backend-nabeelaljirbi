import express from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "@prisma/client";
import { PatientController } from "./patient.controller";
import { patientValidation } from "./patient.validation";
import { s3Uploader } from "../../../helpars/s3Bucket/fileUploadToS3";
import { bookingValidation } from "../Booking/booking.validation";

const router = express.Router();

const fileUpload = s3Uploader.single("profilePicture");
const imageUpload = s3Uploader.single("image");

router.patch(
  "/profile-update",
  fileUpload,
  auth(UserRole.PATIENT),
  // validateRequest(patientValidation.updatePatientProfileValidationSchema),
  PatientController.updatePatientProfile
);

router.get(
  "/profile",
  auth(UserRole.PATIENT),
  PatientController.getPatientProfile
);

router.get(
  "/doctors/popular",
  auth(UserRole.PATIENT),
  PatientController.getPopularDoctors
);

router.get(
  "/clinics/nearest",
  auth(UserRole.PATIENT),
  PatientController.getNearestClinics
);

router.get(
  "/clinics/:clinicUserId",
  auth(UserRole.PATIENT),
  PatientController.getClinicDetailsById
);

router.get(
  "/get-clinic-doctors/:clinicUserId",
  auth(UserRole.PATIENT),
  PatientController.getClinicDoctors
);

router.get(
  "/get-doctor/:doctorId",
  auth(UserRole.PATIENT),
  PatientController.getDoctor
);


router.post(
  "/appointment-booking",
  auth(UserRole.PATIENT),
  validateRequest(bookingValidation.createBookingValidationSchema),
  PatientController.bookingAppointment
);

router.get(
  "/booking-settings",
  auth(UserRole.PATIENT),
  PatientController.getPatientBookingSettings
);

router.post(
  "/insurance",
  auth(UserRole.PATIENT),
  imageUpload,
  PatientController.createPatientInsurance
);

router.get(
  "/insurance",
  auth(UserRole.PATIENT),
  PatientController.getPatientInsurance
);

router.patch(
  "/update-insurance/:insuranceId",
  auth(UserRole.PATIENT),
  imageUpload,
  PatientController.updatePatientInsurance
);

router.delete(
  "/delete-insurance/:insuranceId",
  auth(UserRole.PATIENT),
  PatientController.deletePatientInsurance
);


router.patch(
  "/appointment-cancel/:bookingId",
  auth(UserRole.PATIENT),
  PatientController.cancelAppointment
);

router.patch(
  "/appointment-arrived/:bookingId",
  auth(UserRole.PATIENT),
  PatientController.markAppointmentArrived
);

router.get(
  "/appointment-history",
  auth(UserRole.PATIENT),
  PatientController.getAppointmentHistory
);

export const PatientRoutes = router;
