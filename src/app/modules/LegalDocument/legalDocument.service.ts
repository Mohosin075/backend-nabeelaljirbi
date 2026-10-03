import { Prisma, UserRole } from "@prisma/client";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { IPaginationOptions } from "../../../interfaces/paginations";
import {
  ICreateLegalDocumentPayload,
  ILegalDocumentFilters,
  IAcceptAgreementPayload,
} from "./legalDocument.interface";

// 1. Get current active legal document for a specific role (Database is Source of Truth)
const getActiveDocument = async (role: UserRole) => {
  const document = await (prisma as any).legalDocument.findFirst({
    where: {
      role,
      isActive: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!document) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      `No active legal document found for role: ${role}. Please publish a version in Admin Dashboard.`
    );
  }

  return document;
};

// 2. Publish new version of legal document (Admin only)
const publishNewVersion = async (payload: ICreateLegalDocumentPayload) => {
  const {
    role,
    title,
    titleAr,
    content,
    contentAr,
    version,
    effectiveDate,
    requireReacceptance,
  } = payload;

  const trimmedVersion = version.trim();

  // Prevent duplicate version publishing for the same role
  const existingVersion = await (prisma as any).legalDocument.findFirst({
    where: {
      role,
      version: trimmedVersion,
    },
  });

  if (existingVersion) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Version "${trimmedVersion}" already exists for ${role}. Please specify a new version number (e.g. 1.1, 2.0).`
    );
  }

  // Use transaction to deactivate previous documents and create new active one
  const result = await (prisma as any).$transaction(async (tx: any) => {
    // Deactivate previous active documents for this role
    await tx.legalDocument.updateMany({
      where: {
        role,
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    // Create new active document
    const newDoc = await tx.legalDocument.create({
      data: {
        role,
        title,
        titleAr,
        content,
        contentAr,
        version,
        effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
        requireReacceptance: requireReacceptance ?? false,
        isActive: true,
      },
    });

    return newDoc;
  });

  return result;
};

// 3. Get all versions of legal documents with pagination & filter (Admin)
const getAllDocuments = async (
  filters: ILegalDocumentFilters,
  options: IPaginationOptions
) => {
  const { role, searchTerm, isActive } = filters;
  const { limit, page, skip } = paginationHelpers.calculatePagination(options);

  const andConditions: any[] = [];

  if (role) {
    andConditions.push({ role });
  }

  if (isActive !== undefined) {
    andConditions.push({ isActive: isActive === true || isActive === "true" });
  }

  if (searchTerm) {
    andConditions.push({
      OR: [
        { title: { contains: searchTerm, mode: "insensitive" } },
        { titleAr: { contains: searchTerm, mode: "insensitive" } },
        { version: { contains: searchTerm, mode: "insensitive" } },
      ],
    });
  }

  const whereConditions = andConditions.length > 0 ? { AND: andConditions } : {};

  const result = await (prisma as any).legalDocument.findMany({
    where: whereConditions,
    skip,
    take: limit,
    orderBy: {
      createdAt: "desc",
    },
    include: {
      _count: {
        select: { acceptances: true },
      },
    },
  });

  const total = await (prisma as any).legalDocument.count({
    where: whereConditions,
  });

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data: result,
  };
};

// 4. Accept a legal agreement (User)
const acceptAgreement = async (
  userId: string,
  payload: IAcceptAgreementPayload,
  ipAddress?: string,
  userAgent?: string
) => {
  // Selective projection: only fetch needed fields (avoids loading passwords/blobs into heap)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  const document = await (prisma as any).legalDocument.findUnique({
    where: { id: payload.documentId },
    select: { id: true, version: true, role: true },
  });

  if (!document) {
    throw new ApiError(httpStatus.NOT_FOUND, "Legal document not found");
  }

  const version = payload.documentVersion || document.version;

  // Idempotent: If user already accepted this version, return existing record
  const existingAcceptance = await (prisma as any).userAgreementAcceptance.findFirst({
    where: {
      userId,
      documentId: document.id,
      documentVersion: version,
    },
  });

  if (existingAcceptance) {
    return existingAcceptance;
  }

  try {
    const acceptance = await (prisma as any).userAgreementAcceptance.create({
      data: {
        userId,
        documentId: document.id,
        documentVersion: version,
        role: document.role,
        acceptedAt: new Date(),
        ipAddress,
        userAgent,
      },
    });

    return acceptance;
  } catch (err: any) {
    // Graceful recovery for concurrent duplicate insertions
    if (err?.code === "P2002") {
      const duplicateRecord = await (prisma as any).userAgreementAcceptance.findFirst({
        where: {
          userId,
          documentId: document.id,
          documentVersion: version,
        },
      });
      if (duplicateRecord) return duplicateRecord;
    }
    throw err;
  }
};

// 5. Check if user needs to re-accept legal agreement
const checkUserAcceptanceStatus = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user || !user.role) {
    return { needsAcceptance: false };
  }

  // Get active document for this role
  let activeDoc = null;
  try {
    activeDoc = await getActiveDocument(user.role);
  } catch (err: any) {
    if (err?.statusCode === httpStatus.NOT_FOUND) {
      return { needsAcceptance: false };
    }
    throw err;
  }

  if (!activeDoc) {
    return { needsAcceptance: false };
  }

  // Find user's latest acceptance for this role
  const latestAcceptance = await (prisma as any).userAgreementAcceptance.findFirst({
    where: {
      userId,
      role: user.role,
    },
    orderBy: {
      acceptedAt: "desc",
    },
  });

  // If user never accepted any agreement
  if (!latestAcceptance) {
    return {
      needsAcceptance: true,
      reason: "FIRST_TIME_ACCEPTANCE_REQUIRED",
      document: activeDoc,
    };
  }

  // If user accepted an older version and the new version requires re-acceptance
  if (
    activeDoc.requireReacceptance &&
    latestAcceptance.documentVersion !== activeDoc.version
  ) {
    return {
      needsAcceptance: true,
      reason: "REACCEPTANCE_REQUIRED",
      lastAcceptedVersion: latestAcceptance.documentVersion,
      document: activeDoc,
    };
  }

  return {
    needsAcceptance: false,
    acceptedVersion: latestAcceptance.documentVersion,
    acceptedAt: latestAcceptance.acceptedAt,
  };
};

// 6. Get acceptance history for a document (Admin Audit)
const getDocumentAcceptances = async (
  documentId: string,
  options: IPaginationOptions
) => {
  const { limit, page, skip } = paginationHelpers.calculatePagination(options);

  const result = await (prisma as any).userAgreementAcceptance.findMany({
    where: { documentId },
    skip,
    take: limit,
    orderBy: {
      acceptedAt: "desc",
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          phoneNumber: true,
          role: true,
          email: true,
        },
      },
    },
  });

  const total = await (prisma as any).userAgreementAcceptance.count({
    where: { documentId },
  });

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data: result,
  };
};

export const LegalDocumentService = {
  getActiveDocument,
  publishNewVersion,
  getAllDocuments,
  acceptAgreement,
  checkUserAcceptanceStatus,
  getDocumentAcceptances,
};
