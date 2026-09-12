import { z } from "zod";

const updateDoctorProfileValidationSchema = z.object({
  fullName: z.string().optional(),
  gender: z.string().optional(),
  dateOfBirth: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  speciality: z.string().optional(),
  experience: z.string().optional(),
  licenseNumber: z.string().optional(),
  consultFee: z.number().optional(),
  clinicId: z.string().optional(),
  wallet: z.number().optional(),
});

const addWorkingHoursValidationSchema = z.object({
  day: z.string(),
  slots: z.array(z.string()),
  capacity: z.number(),
});

export const doctorValidation = {
  updateDoctorProfileValidationSchema,
  addWorkingHoursValidationSchema,
};
