import { z } from "zod";
import { UserRole } from "@prisma/client";

const publishLegalDocumentSchema = z.object({
  body: z.object({
    role: z.nativeEnum(UserRole, {
      required_error: "Role is required (PATIENT, DOCTOR, CLINIC)",
    }),
    title: z.string({
      required_error: "Title is required",
    }).min(3, "Title must be at least 3 characters"),
    titleAr: z.string().optional(),
    content: z.string({
      required_error: "Content is required",
    }).min(10, "Content must be at least 10 characters"),
    contentAr: z.string().optional(),
    version: z.string({
      required_error: "Version is required",
    }).min(1, "Version is required"),
    effectiveDate: z.string().optional(),
    requireReacceptance: z.boolean().optional(),
  }),
});

const acceptAgreementSchema = z.object({
  body: z.object({
    documentId: z.string({
      required_error: "Document ID is required",
    }),
    documentVersion: z.string().optional(),
  }),
});

export const LegalDocumentValidation = {
  publishLegalDocumentSchema,
  acceptAgreementSchema,
};
