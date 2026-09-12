import { Request, Response } from "express";
import httpStatus from "http-status";
import { paginationFields } from "../../../constants/pagination";
import catchAsync from "../../../shared/catchAsync";
import pick from "../../../shared/pick";
import sendResponse from "../../../shared/sendResponse";
import { InsuranceService } from "./insurance.service";
import { fileUploadToS3 } from "../../../helpars/s3Bucket/fileUploadToS3";
import ApiError from "../../../errors/ApiErrors";

const createInsurance = catchAsync(async (req: Request, res: Response) => {
  let imageUrl = "";

  if (req.file) {
    imageUrl = await fileUploadToS3(
      "insurance",
      "insurance",
      req.file.originalname,
      req.file.mimetype,
      req.file.path,
    );
  }

  const bodyData = req.body.data ? JSON.parse(req.body.data) : req.body;

  const payload = {
    name: bodyData.name,
    image: imageUrl,
  };

  const result = await InsuranceService.createInsurance(payload);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Insurance created successfully",
    data: result,
  });
});

const getAllInsurances = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ["searchTerm"]);
  const options = pick(req.query, paginationFields);

  const result = await InsuranceService.getAllInsurances(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Insurances retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getInsuranceById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await InsuranceService.getInsuranceById(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Insurance retrieved successfully",
    data: result,
  });
});

const updateInsurance = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  let imageUrl = "";

  if (req.file) {
    imageUrl = await fileUploadToS3(
      "insurance",
      "insurance",
      req.file.originalname,
      req.file.mimetype,
      req.file.path,
    );
  }

  const bodyData = req.body.data ? JSON.parse(req.body.data) : req.body;

  const payload = {
    name: bodyData.name,
    ...(imageUrl && { image: imageUrl }),
  };

  const result = await InsuranceService.updateInsurance(id, payload);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Insurance updated successfully",
    data: result,
  });
});

const deleteInsurance = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  // Get insurance to delete image
  const insurance = await InsuranceService.getInsuranceById(id);

  await InsuranceService.deleteInsurance(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Insurance deleted successfully",
    data: null,
  });
});

export const InsuranceController = {
  createInsurance,
  getAllInsurances,
  getInsuranceById,
  updateInsurance,
  deleteInsurance,
};
