
import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { OTPSystemService } from "./otpSystem.service";

const createOTPSystem = catchAsync(async (req: Request, res: Response) => {
  const result = await OTPSystemService.createOTPSystem(req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "OTP System created successfully",
    data: result,
  });
});

const getOTPSystems = catchAsync(async (req: Request, res: Response) => {
  const result = await OTPSystemService.getOTPSystems();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP Systems retrieved successfully",
    data: result,
  });
});

const getOTPSystemById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await OTPSystemService.getOTPSystemById(id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP System retrieved successfully",
    data: result,
  });
});

const updateOTPSystem = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await OTPSystemService.updateOTPSystem(id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP System updated successfully",
    data: result,
  });
});

const deleteOTPSystem = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await OTPSystemService.deleteOTPSystem(id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP System deleted successfully",
    data: result,
  });
});

export const OTPSystemController = {
  createOTPSystem,
  getOTPSystems,
  getOTPSystemById,
  updateOTPSystem,
  deleteOTPSystem,
};
