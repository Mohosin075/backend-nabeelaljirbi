import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import httpStatus from "http-status";
import { VerificationService } from "./verification.service";
import ApiError from "../../../errors/ApiErrors";
import { s3Client } from "../../../helpars/s3Bucket/fileUploadToS3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { v4 as uuidv4 } from "uuid";
import { slugify } from "../../../utils/slugify";
import path from "path";
import fs from "fs";
import config from "../../../config";

const submitVerification = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const { documents, notes } = req.body;

  let result;
  if (user.role === "DOCTOR") {
    result = await VerificationService.submitDoctorVerification(user.id, {
      documents,
      notes,
    });
  } else if (user.role === "CLINIC" || user.role === "MANAGER") {
    result = await VerificationService.submitClinicVerification(user.id, {
      documents,
      notes,
    });
  } else {
    return sendResponse(res, {
      statusCode: httpStatus.FORBIDDEN,
      success: false,
      message: "Only Doctors and Clinics can submit verification requests",
      data: null,
    });
  }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Verification documents submitted successfully and are pending admin review",
    data: result,
  });
});

const getMyStatus = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await VerificationService.getMyVerificationStatus(user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Verification status retrieved successfully",
    data: result,
  });
});

const getAdminVerifications = catchAsync(async (req: Request, res: Response) => {
  const query = req.query as any;
  const result = await VerificationService.getAdminVerifications(query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Admin verifications retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const reviewVerification = catchAsync(async (req: Request, res: Response) => {
  const { targetId, type, action, adminNote, badgeActive } = req.body;
  const result = await VerificationService.reviewVerification({
    targetId,
    type,
    action,
    adminNote,
    badgeActive,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Verification ${action.toLowerCase()} successfully`,
    data: result,
  });
});

const toggleBadgeActivation = catchAsync(async (req: Request, res: Response) => {
  const { targetId, type, badgeActive } = req.body;
  const result = await VerificationService.toggleBadgeActivation({
    targetId,
    type,
    badgeActive: Boolean(badgeActive),
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Blue badge ${badgeActive ? "activated" : "deactivated"} successfully`,
    data: result,
  });
});

const uploadDocument = catchAsync(async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) {
    throw new ApiError(httpStatus.BAD_REQUEST, "File is missing");
  }

  let fileUrl = "";

  // Try S3 / DigitalOcean Spaces first if configured
  if (config.aws.accessKeyId && config.aws.bucketName) {
    try {
      const ext = path.extname(file.originalname);
      const name = slugify(path.basename(file.originalname, ext));
      const key = `verifications/${name}-${uuidv4()}${ext}`;

      await s3Client.send(
        new PutObjectCommand({
          Bucket: config.aws.bucketName,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          ACL: "public-read",
        })
      );

      fileUrl = `https://${config.aws.bucketName}.${config.aws.region || "sfo3"}.digitaloceanspaces.com/${key}`;
    } catch (s3Err) {
      console.warn("S3 upload failed, falling back to local disk storage:", s3Err);
    }
  }

  // Fallback to local storage if S3 didn't yield a URL
  if (!fileUrl) {
    const uploadDir = path.join(process.cwd(), "uploads", "verifications");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const ext = path.extname(file.originalname);
    const name = slugify(path.basename(file.originalname, ext));
    const filename = `${name}-${uuidv4()}${ext}`;
    const filePath = path.join(uploadDir, filename);

    fs.writeFileSync(filePath, file.buffer);

    const host = req.get("host");
    const protocol = req.protocol;
    fileUrl = `${protocol}://${host}/uploads/verifications/${filename}`;
  }

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Document uploaded successfully",
    data: {
      url: fileUrl,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    },
  });
});

export const VerificationController = {
  submitVerification,
  getMyStatus,
  getAdminVerifications,
  reviewVerification,
  toggleBadgeActivation,
  uploadDocument,
};
