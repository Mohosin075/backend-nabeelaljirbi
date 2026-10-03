import { Request, Response } from "express";
import httpStatus from "http-status";
import { UserRole } from "@prisma/client";
import catchAsync from "../../../shared/catchAsync";
import pick from "../../../shared/pick";
import sendResponse from "../../../shared/sendResponse";
import { LegalDocumentService } from "./legalDocument.service";
import { paginationFields } from "../../../constants/pagination";
import ApiError from "../../../errors/ApiErrors";

// 1. Get active legal document for a role (Public / App)
const getActiveDocument = catchAsync(async (req: Request, res: Response) => {
  const roleParam = (req.query.role as string)?.toUpperCase();

  if (!roleParam || !(roleParam in UserRole)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Valid role query parameter is required (PATIENT, DOCTOR, or CLINIC)"
    );
  }

  const role = roleParam as UserRole;
  const result = await LegalDocumentService.getActiveDocument(role);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Active legal document retrieved successfully",
    data: result,
  });
});

// 2. Publish new version (Admin)
const publishNewVersion = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;

  if (!payload.role || !payload.title || !payload.content || !payload.version) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Role, title, content, and version are required"
    );
  }

  const result = await LegalDocumentService.publishNewVersion(payload);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "New legal document version published successfully",
    data: result,
  });
});

// 3. Get all documents (Admin)
const getAllDocuments = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ["role", "searchTerm", "isActive"]);
  const options = pick(req.query, paginationFields);

  const result = await LegalDocumentService.getAllDocuments(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Legal documents retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

// 4. Accept agreement (Authenticated User)
const acceptAgreement = catchAsync(async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user || !user.id) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Unauthorized");
  }

  const payload = req.body;
  const forwardedFor = req.headers["x-forwarded-for"];
  const ipAddress =
    (typeof forwardedFor === "string" ? forwardedFor.split(",")[0]?.trim() : undefined) ||
    req.ip ||
    req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"];

  const result = await LegalDocumentService.acceptAgreement(
    user.id,
    payload,
    ipAddress,
    userAgent
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Legal agreement accepted successfully",
    data: result,
  });
});

// 5. Check user acceptance status (Authenticated User)
const checkUserAcceptanceStatus = catchAsync(
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (!user || !user.id) {
      throw new ApiError(httpStatus.UNAUTHORIZED, "Unauthorized");
    }

    const result = await LegalDocumentService.checkUserAcceptanceStatus(user.id);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Acceptance status checked successfully",
      data: result,
    });
  }
);

// 6. Get document acceptances (Admin Audit)
const getDocumentAcceptances = catchAsync(
  async (req: Request, res: Response) => {
    const { documentId } = req.params;
    const options = pick(req.query, paginationFields);

    const result = await LegalDocumentService.getDocumentAcceptances(
      documentId,
      options
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Document acceptance records retrieved successfully",
      meta: result.meta,
      data: result.data,
    });
  }
);

export const LegalDocumentController = {
  getActiveDocument,
  publishNewVersion,
  getAllDocuments,
  acceptAgreement,
  checkUserAcceptanceStatus,
  getDocumentAcceptances,
};
