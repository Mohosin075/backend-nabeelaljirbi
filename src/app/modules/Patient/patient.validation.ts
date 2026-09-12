import { z } from "zod";

const updatePatientProfileValidationSchema = z.object({
  fullName: z.string().optional(),
  gender: z.string().optional(),
  dateOfBirth: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  wallet: z.number().optional(),
});

const bookingAppointmentSchema = z.object({
  body: z.object({
    clinicId: z.string({ required_error: "Clinic ID is required" }),
    doctorId: z.string({ required_error: "Doctor ID is required" }),
    workingSlotId: z.string({ required_error: "Working slot ID is required" }),
    consultDate: z.string({ required_error: "Consult date is required" }),
  }),
});

export const patientValidation = {
  updatePatientProfileValidationSchema,
  bookingAppointmentSchema,
};

