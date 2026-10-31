import express from "express";
import prisma from "../../../shared/prisma";
import auth from "../../middlewares/auth";
import catchAsync from "../../../shared/catchAsync";
import { bookingOperations } from "./booking.operations";
import { bookingScope } from "./phaseOne.access";
import { BookingService } from "../Booking/booking.service";
import { ClinicService } from "../Clinic/clinic.service";

// Real lifecycle/refund/scope tests: phase-one-booking.integration.cjs.
const router = express.Router();
const operations = bookingOperations(prisma, {
  transition: ClinicService.updateAppointmentStatus,
  cancel: BookingService.cancelBooking,
});
router.use(auth());
router.get(
  "/bookings",
  catchAsync(async (req: any, res) => {
    res.json({
      success: true,
      data: await operations.list(req.user, req.query),
    });
  }),
);
router.post(
  "/bookings/bulk",
  catchAsync(async (req: any, res) => {
    res.json({
      success: true,
      data: await operations.bulk(req.user, req.body),
    });
  }),
);
router.get(
  "/booking-options",
  catchAsync(async (req: any, res) => {
    const scope: any = await bookingScope(prisma, req.user);
    // Only return directory records visible through this account's appointments,
    // plus its own clinic; patients cannot browse other patients' identities.
    const [clinics, doctors, patients] = await Promise.all([
      prisma.clinic.findMany({
        where:
          req.user.role === "ADMIN"
            ? {}
            : {
                OR: [
                  ...(scope.clinicId ? [{ id: scope.clinicId }] : []),
                  { bookingsAsClinic: { some: scope } },
                ],
              },
        select: { id: true, clinicName: true },
        orderBy: { clinicName: "asc" },
      }),
      prisma.doctor.findMany({
        where: {
          ...(req.user.role === "ADMIN"
            ? {}
            : { bookingsAsDoctor: { some: scope } }),
          ...(req.query.clinicId
            ? {
                doctorClinics: {
                  some: {
                    clinicId: String(req.query.clinicId),
                    isActive: true,
                  },
                },
              }
            : {}),
        },
        select: {
          id: true,
          user: { select: { fullName: true, phoneNumber: true } },
        },
        orderBy: { id: "asc" },
      }),
      prisma.patient.findMany({
        where: {
          bookingsAsPatient: {
            some: {
              AND: [
                scope,
                {
                  ...(req.query.clinicId
                    ? { clinicId: String(req.query.clinicId) }
                    : {}),
                  ...(req.query.doctorId
                    ? { doctorId: String(req.query.doctorId) }
                    : {}),
                },
              ],
            },
          },
          ...(req.query.patientSearch
            ? {
                user: {
                  OR: [
                    {
                      fullName: {
                        contains: String(req.query.patientSearch),
                        mode: "insensitive",
                      },
                    },
                    {
                      phoneNumber: {
                        contains: String(req.query.patientSearch),
                      },
                    },
                  ],
                },
              }
            : {}),
        },
        take: 100,
        select: {
          id: true,
          user: { select: { fullName: true, phoneNumber: true } },
        },
        orderBy: [{ user: { fullName: "asc" } }, { id: "asc" }],
      }),
    ]);
    res.json({ success: true, data: { clinics, doctors, patients } });
  }),
);
export const ManagedBookingRoutes = router;
