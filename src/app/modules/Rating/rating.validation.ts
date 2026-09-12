import { z } from "zod";

const createRatingValidationSchema = z.object({
  appointmentId: z.string(),
  rating: z.number().min(1).max(5),
});

export const ratingValidation = {
  createRatingValidationSchema,
};
