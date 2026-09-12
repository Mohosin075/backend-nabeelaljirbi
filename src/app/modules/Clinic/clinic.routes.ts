import express from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "@prisma/client";
import { ClinicController } from "./clinic.controller";
import { clinicValidation } from "./clinic.validation";
import { s3Uploader } from "../../../helpars/s3Bucket/fileUploadToS3";

const router = express.Router();

router.get("/", ClinicController.getClinics);

const fileUpload = s3Uploader.single("companyLogo");
const imageUpload = s3Uploader.single("image");
const galleryUpload = s3Uploader.fields([
  { name: "images", maxCount: 20 },
]);

router.patch(
  "/update-info",
  auth(),
  fileUpload,
  ClinicController.updateClinicProfile
);

router.get(
  "/info",
  auth(),
  ClinicController.getClinicProfile
);

router.post(
  "/specialists",
  auth(),
  imageUpload,
  ClinicController.createClinicSpecialist
);

router.get(
  "/specialists",
  auth(),
  ClinicController.getClinicSpecialists
);

router.delete(
  "/specialists/:id",
  auth(),
  ClinicController.deleteClinicSpecialist
);

router.post(
  "/insurances",
  auth(),
  imageUpload,
  ClinicController.createClinicInsurance
);

router.get(
  "/insurances",
  auth(),
  ClinicController.getClinicInsurances
);

router.delete(
  "/insurances/:id",
  auth(),
  ClinicController.deleteClinicInsurance
);
router.post(
  "/galleries",
  auth(),
  galleryUpload,
  ClinicController.createPhotoGallery
);

router.get(
  "/galleries",
  auth(),
  ClinicController.getPhotoGalleries
);

router.delete(
  "/clear-galleries",
  auth(),
  ClinicController.clearPhotoGalleries
);

router.delete(
  "/galleries/:id",
  auth(),
  ClinicController.deletePhotoGallery
);

router.patch(
  "/bookings/status",
  auth(),
  ClinicController.updateBookingStatus
);

router.get(
  "/manager-stats",
  auth(),
  ClinicController.getClinicManagerStats
);

router.get(
  "/stats",
  auth(),
  ClinicController.getClinicStats
);

router.patch(
  "/update/appointment-status",
  auth(),
  ClinicController.updateAppointmentStatus
);

router.patch(
  "/manager-update/appointment-status",
  auth(),
  ClinicController.managerUpdateAppointmentStatus
);

router.patch(
  "/remove-clinic-doctor/:doctorId",
  auth(),
  ClinicController.removeDoctorFromClinic
);

router.get(
  "/booking-history",
  auth(),
  ClinicController.getBookingHistory
);

router.get(
  "/manager/booking-history",
  auth(),
  ClinicController.getManagerBookingHistory
);

router.get(
  "/doctors",
  auth(),
  ClinicController.getClinicDoctor
);

router.get(
  "/manager/doctors",
  auth(),
  ClinicController.getClinicManagerDoctor
);

router.get(
  "/doctor-appointments",
  auth(),
  ClinicController.getDoctorAppointments
);

router.get(
  "/doctor-appointments/:doctorId",
  auth(),
  ClinicController.getDoctorAppointments
);

export const ClinicRoutes = router;
