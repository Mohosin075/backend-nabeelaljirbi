import express from "express";
import { UserRole } from "@prisma/client";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { LegalDocumentController } from "./legalDocument.controller";
import { LegalDocumentValidation } from "./legalDocument.validation";

const router = express.Router();

// Public / Mobile App routes
router.get("/active", LegalDocumentController.getActiveDocument);

// Authenticated user routes (Mobile App / Web)
router.post(
  "/accept",
  auth(),
  validateRequest(LegalDocumentValidation.acceptAgreementSchema),
  LegalDocumentController.acceptAgreement
);
router.get(
  "/check-status",
  auth(),
  LegalDocumentController.checkUserAcceptanceStatus
);

// Admin-only management routes
router.get(
  "/admin/all",
  auth(UserRole.ADMIN),
  LegalDocumentController.getAllDocuments
);
router.post(
  "/admin/publish",
  auth(UserRole.ADMIN),
  validateRequest(LegalDocumentValidation.publishLegalDocumentSchema),
  LegalDocumentController.publishNewVersion
);
router.get(
  "/admin/:documentId/acceptances",
  auth(UserRole.ADMIN),
  LegalDocumentController.getDocumentAcceptances
);

export const LegalDocumentRoutes = router;
