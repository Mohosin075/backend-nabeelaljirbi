import express from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { AdminTier, UserRole } from "@prisma/client";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { BookingController } from "./booking.controller";
import { bookingValidation } from "./booking.validation";

const router = express.Router();

const adminTierGuardForMixedRoles = (...tiers: AdminTier[]) =>
  (req: any, res: any, next: any) => {
    if (req.user?.role !== UserRole.ADMIN) return next();
    return adminTierAuth(...tiers)(req, res, next);
  };

router.post(
  "/",
  auth(UserRole.PATIENT),
  validateRequest(bookingValidation.createBookingValidationSchema),
  BookingController.createBooking
);

router.get(
  "/",
  auth(UserRole.PATIENT, UserRole.DOCTOR, UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  adminTierGuardForMixedRoles(
    AdminTier.SUPER_ADMIN,
    AdminTier.OPERATIONS,
    AdminTier.SUPPORT,
    AdminTier.READ_ONLY,
  ),
  BookingController.getBookings
);

router.patch(
  "/:appointmentId/confirm",
  auth(UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  adminTierGuardForMixedRoles(AdminTier.SUPER_ADMIN),
  validateRequest(bookingValidation.approveBookingValidationSchema),
  BookingController.confirmBooking
);

router.patch(
  "/:appointmentId/reject",
  auth(UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  adminTierGuardForMixedRoles(AdminTier.SUPER_ADMIN),
  validateRequest(bookingValidation.rejectBookingValidationSchema),
  BookingController.rejectBooking
);

router.patch(
  "/:appointmentId/cancel",
  auth(UserRole.PATIENT, UserRole.DOCTOR, UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  adminTierGuardForMixedRoles(AdminTier.SUPER_ADMIN),
  BookingController.cancelBooking
);

router.patch(
  "/:appointmentId/complete",
  auth(UserRole.CLINIC, UserRole.MANAGER, UserRole.ADMIN),
  adminTierGuardForMixedRoles(AdminTier.SUPER_ADMIN),
  BookingController.completeBooking
);

router.patch(
  "/:appointmentId/no-show",
  auth(UserRole.CLINIC, UserRole.MANAGER, UserRole.DOCTOR, UserRole.ADMIN),
  adminTierGuardForMixedRoles(AdminTier.SUPER_ADMIN),
  BookingController.markAsNoShow
);

export const BookingRoutes = router;
