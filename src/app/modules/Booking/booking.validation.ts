import { z } from "zod";

const createBookingValidationSchema = z.object({
  clinicId: z.string(),
  doctorId: z.string(),
  date: z.string(),
  time: z.string(),
});

export const bookingValidation = {
  createBookingValidationSchema,
};
