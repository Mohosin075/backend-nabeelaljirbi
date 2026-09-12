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
  bookingId: z.string(),
  status: z.enum(["PENDING", "INPROGRESS", "COMPLETE"]),
});

export const clinicValidation = {
  updateClinicProfileValidationSchema,
  createClinicSpecialistValidationSchema,
  createClinicInsuranceValidationSchema,
  createPhotoGalleryValidationSchema,
  updateBookingStatusValidationSchema,
};
