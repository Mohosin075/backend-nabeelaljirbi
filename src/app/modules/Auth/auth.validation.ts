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

const adminLoginValidationSchema = z.object({
  body: z.object({
    email: z.string({ required_error: "Email is required" }).min(1, "Email is required"),
    password: z.string({ required_error: "Password is required" }).min(1, "Password is required"),
  }),
});

const forgotPasswordValidationSchema = z.object({
  body: z.object({
    emailOrPhone: z.string().min(3, "Email or Phone is required"),
  }),
});

const resetPasswordValidationSchema = z.object({
  body: z.object({
    token: z.string().min(1, "Token is required"),
    newPassword: z.string().min(6, "Password must be at least 6 characters"),
  }),
});

export const authValidation = {
  sendOTPValidationSchema,
  verifyOTPValidationSchema,
  changePasswordValidationSchema,
  adminLoginValidationSchema,
  forgotPasswordValidationSchema,
  resetPasswordValidationSchema,
};
