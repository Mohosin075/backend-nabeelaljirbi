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

const timeToMinutes = (value: string) => {
  const [hours, minutes] = value.split(":");
  return Number.parseInt(hours, 10) * 60 + Number.parseInt(minutes, 10);
};

const workingSlotSchema = z.object({
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\.\d+Z?)?$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\.\d+Z?)?$/),
  capacity: z.number().int().min(1),
  isActive: z.boolean().optional().default(true),
}).refine((slot) => {
  return timeToMinutes(slot.startTime) < timeToMinutes(slot.endTime);
}, { message: "Working period end must be after its start" });

const addWorkingHoursValidationSchema = z.object({
  body: z.object({
    clinicId: z.string().optional(),
    day: z.enum(["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]),
    slots: z.array(workingSlotSchema).max(30),
  }).superRefine(({ slots }, ctx) => {
    const sorted = slots
      .map((slot) => ({
        start: timeToMinutes(slot.startTime),
        end: timeToMinutes(slot.endTime),
      }))
      .sort((a, b) => a.start - b.start);

    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].start < sorted[index - 1].end) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["slots"],
          message: "Working periods cannot overlap",
        });
        break;
      }
    }
  }),
});

const requestJoinClinicValidationSchema = z.object({
  body: z.object({
    clinicId: z.string().min(1),
    note: z.string().max(1000).optional(),
  }),
});

export const doctorValidation = {
  updateDoctorProfileValidationSchema,
  addWorkingHoursValidationSchema,
  requestJoinClinicValidationSchema,
};
