import express from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "@prisma/client";
import { BookingController } from "./booking.controller";
import { bookingValidation } from "./booking.validation";

const router = express.Router();

router.post(
  "/",
  auth(UserRole.PATIENT),
  validateRequest(bookingValidation.createBookingValidationSchema),
  BookingController.createBooking
);

router.get(
  "/",
  auth(UserRole.PATIENT, UserRole.DOCTOR, UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  BookingController.getBookings
);

router.patch(
  "/:appointmentId/confirm",
  auth(UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(bookingValidation.approveBookingValidationSchema),
  BookingController.confirmBooking
);

router.patch(
  "/:appointmentId/reject",
  auth(UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  validateRequest(bookingValidation.rejectBookingValidationSchema),
  BookingController.rejectBooking
);

router.patch(
  "/:appointmentId/cancel",
  auth(UserRole.PATIENT, UserRole.DOCTOR, UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  BookingController.cancelBooking
);

router.patch(
  "/:appointmentId/complete",
  auth(UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  BookingController.completeBooking
);

export const BookingRoutes = router;
