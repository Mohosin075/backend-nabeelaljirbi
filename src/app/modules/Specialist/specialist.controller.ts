import { Request, Response } from "express";
import httpStatus from "http-status";
import { paginationFields } from "../../../constants/pagination";
import catchAsync from "../../../shared/catchAsync";
import pick from "../../../shared/pick";
import sendResponse from "../../../shared/sendResponse";
import { SpecialistService } from "./specialist.service";
import { fileUploadToS3 } from "../../../helpars/s3Bucket/fileUploadToS3";
import ApiError from "../../../errors/ApiErrors";

const createSpecialist = catchAsync(async (req: Request, res: Response) => {
  let imageUrl = "";

  if (req.file) {
    imageUrl = await fileUploadToS3(
      "specialist",
      "specialist",
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

  const result = await SpecialistService.createSpecialist(payload);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Specialist created successfully",
    data: result,
  });
});

const getAllSpecialists = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ["searchTerm"]);
  const options = pick(req.query, paginationFields);

  const result = await SpecialistService.getAllSpecialists(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Specialists retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getSpecialistById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await SpecialistService.getSpecialistById(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Specialist retrieved successfully",
    data: result,
  });
});

const updateSpecialist = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  let imageUrl = "";

  if (req.file) {
    imageUrl = await fileUploadToS3(
      "specialist",
      "specialist",
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

  const result = await SpecialistService.updateSpecialist(id, payload);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Specialist updated successfully",
    data: result,
  });
});

const deleteSpecialist = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;

  // Get specialist to delete image
  const specialist = await SpecialistService.getSpecialistById(id);

  await SpecialistService.deleteSpecialist(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Specialist deleted successfully",
    data: null,
  });
});

export const SpecialistController = {
  createSpecialist,
  getAllSpecialists,
  getSpecialistById,
  updateSpecialist,
  deleteSpecialist,
};
