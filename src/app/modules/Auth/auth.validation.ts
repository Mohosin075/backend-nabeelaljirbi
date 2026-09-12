import { z } from "zod";

const sendOTPValidationSchema = z.object({
  phoneNumber: z.string().min(10).max(15),
  referralCode: z.string().optional(),
});

const verifyOTPValidationSchema = z.object({
  phoneNumber: z.string().min(10).max(15),
  otp: z.string().length(6),
});

const changePasswordValidationSchema = z.object({
  oldPassword: z.string().min(8),
  newPassword: z.string().min(8),
});

export const authValidation = {
  sendOTPValidationSchema,
  verifyOTPValidationSchema,
  changePasswordValidationSchema,
};
