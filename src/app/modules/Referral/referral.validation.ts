import { z } from "zod";

const createReferralValidationSchema = z.object({
  body: z.object({
    referredPhone: z.string({
      required_error: "Referred phone number is required",
    }),
  }),
});

export const referralValidation = {
  createReferralValidationSchema,
};
