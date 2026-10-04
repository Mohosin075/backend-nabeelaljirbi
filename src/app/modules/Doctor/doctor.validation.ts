import { z } from "zod";

const optionalText = (max: number, label: string) =>
  z
    .string({ invalid_type_error: `${label} must be text` })
    .max(max, `${label} must be at most ${max} characters`)
    .nullable()
    .optional();

// NOTE: kept intentionally lenient for backward compatibility with app builds
// already live in production (they send nulls, numeric strings, extra keys).
// It only rejects input that is genuinely invalid.
const updateDoctorProfileValidationSchema = z
  .object({
    fullName: z
      .string({ invalid_type_error: "Full name must be text" })
      .trim()
      .min(1, "Full name cannot be empty")
      .max(100, "Full name must be at most 100 characters")
      .nullable()
      .optional(),
    gender: optionalText(20, "Gender"),
    dateOfBirth: optionalText(40, "Date of birth"),
    country: optionalText(100, "Country"),
    city: optionalText(100, "City"),
    address: optionalText(300, "Address"),
    speciality: optionalText(100, "Specialty"),
    qualifications: optionalText(10000, "Qualifications"),
    biography: optionalText(10000, "Biography"),
    experience: z
      .union([z.string().max(50, "Experience is too long"), z.number()])
      .nullable()
      .optional(),
    licenseNumber: optionalText(100, "License number"),
    consultFee: z
      .union([z.number(), z.string()])
      .nullable()
      .optional()
      .refine(
        (v) =>
          v === undefined ||
          v === null ||
          v === "" ||
          (!isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 100000),
        { message: "Consultation fee must be a number between 0 and 100000" }
      ),
    clinicId: z.string().nullable().optional(),
    profileCompleted: z.boolean().optional(),
  })
  .passthrough();

const addWorkingHoursValidationSchema = z.object({
  day: z.string(),
  slots: z.array(z.string()),
  capacity: z.number(),
});

export const doctorValidation = {
  updateDoctorProfileValidationSchema,
  addWorkingHoursValidationSchema,
};
