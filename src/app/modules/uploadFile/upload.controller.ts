import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import ApiError from "../../../errors/ApiErrors";
import sendResponse from "../../../shared/sendResponse";
import { s3, uploadToS3 } from "./file.upload";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const uploadFiles = catchAsync(async (req: Request, res: Response) => {
  const file = req.file;

  if (!file) {
    throw new ApiError(httpStatus.BAD_REQUEST, "File is missing");
  }

  // Upload file to S3 using the memory buffer
  const uploadedKey = await uploadToS3("profile/clinic", file);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "File uploaded successfully",
    data: uploadedKey,
  });
});

const getPrivateFileUrl = catchAsync(async (req: Request, res: Response) => {
  const { key } = req.body;

  const command = new GetObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME!,
    Key: key,
  });

  const signedUrl = await getSignedUrl(s3, command, {
    expiresIn: 60 * 5, // 5 minutes
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Signed URL generated",
    data: signedUrl,
  });
});




export const UploadController = {
  uploadFiles,
  getPrivateFileUrl
};



