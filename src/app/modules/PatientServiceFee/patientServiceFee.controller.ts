
import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { PatientServiceFeeService } from "./patientServiceFee.service";

const createPatientServiceFee = catchAsync(async (req: Request, res: Response) => {
  const result = await PatientServiceFeeService.createPatientServiceFee(req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient Service Fees updated successfully",
    data: result,
  });
});

const getPatientServiceFees = catchAsync(async (req: Request, res: Response) => {
  const result = await PatientServiceFeeService.getPatientServiceFees();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient Service Fees retrieved successfully",
    data: result,
  });
});

export const PatientServiceFeeController = {
  createPatientServiceFee,
  getPatientServiceFees,
};
