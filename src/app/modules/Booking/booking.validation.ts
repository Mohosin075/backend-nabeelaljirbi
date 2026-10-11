import { z } from "zod";

const createBookingValidationSchema = z.object({
  body: z
    .object({
      clinicId: z.string({ required_error: "clinicId is required" }),
      doctorId: z.string({ required_error: "doctorId is required" }),
      workingSlotId: z.string({ required_error: "workingSlotId is required" }),
      consultDate: z.string().optional(),
      date: z.string().optional(),
      bookedFor: z.enum(["SELF", "FAMILY"]).optional().default("SELF"),
      familyMemberName: z.string().optional(),
      familyMemberRelation: z.string().optional(),
    })
    .refine((data) => !!(data.consultDate || data.date), {
      message: "consultDate is required",
      path: ["consultDate"],
    }),
});

const approveBookingValidationSchema = z.object({
  body: z
    .object({
      note: z.string().optional(),
    })
    .optional(),
});

const rejectBookingValidationSchema = z.object({
  body: z
    .object({
      reason: z.string().optional(),
    })
    .optional(),
});

export const bookingValidation = {
  createBookingValidationSchema,
  approveBookingValidationSchema,
  rejectBookingValidationSchema,
};
