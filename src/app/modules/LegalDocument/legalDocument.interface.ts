import { UserRole } from "@prisma/client";

export interface ICreateLegalDocumentPayload {
  role: UserRole;
  title: string;
  titleAr?: string;
  content: string;
  contentAr?: string;
  version: string;
  effectiveDate?: Date | string;
  requireReacceptance?: boolean;
}

export interface IAcceptAgreementPayload {
  documentId: string;
  documentVersion?: string;
}

export interface ILegalDocumentFilters {
  role?: UserRole;
  searchTerm?: string;
  isActive?: boolean | string;
}
