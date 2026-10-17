import { z } from "zod";

const updateClinicProfileValidationSchema = z.object({
  managerName: z.string().optional(),
  managerPhone: z.string().optional(),
  logo: z.string().optional(),
  clinicName: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  about: z.string().optional(),
  contactPhone: z.string().optional(),
  location: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  timezone: z.string().optional(),
});

const createClinicSpecialistValidationSchema = z.object({
  image: z.string(),
  specialistDetails: z.string(),
});

const createClinicInsuranceValidationSchema = z.object({
  image: z.string(),
  insuranceDetails: z.string(),
});

const createPhotoGalleryValidationSchema = z.object({
  image: z.array(z.string()),
});

const updateBookingStatusValidationSchema = z.object({
  body: z.object({
    bookingId: z.string({ required_error: "Booking ID is required" }),
    status: z.enum([
      "CONFIRMED",
      "ARRIVED",
      "INPROGRESS",
      "COMPLETE",
      "NOT_SHOW",
      "CANCELLED",
      "REJECTED",
    ]),
    reason: z.string().optional(),
  }),
});

const executeDoctorAbsenceValidationSchema = z.object({
  body: z.object({
    doctorId: z.string({ required_error: "Doctor ID is required" }),
    date: z.string({ required_error: "Date is required (YYYY-MM-DD)" }),
    reason: z.string().optional(),
  }),
});

export const clinicValidation = {
  updateClinicProfileValidationSchema,
  createClinicSpecialistValidationSchema,
  createClinicInsuranceValidationSchema,
  createPhotoGalleryValidationSchema,
  updateBookingStatusValidationSchema,
  executeDoctorAbsenceValidationSchema,
};
