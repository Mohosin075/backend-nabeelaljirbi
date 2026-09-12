import { Request, Response } from "express";
import httpStatus from "http-status";
import { paginationFields } from "../../../constants/pagination";
import catchAsync from "../../../shared/catchAsync";
import pick from "../../../shared/pick";
import sendResponse from "../../../shared/sendResponse";
import { TestService } from "./test.service";

const getAllTests = catchAsync(async (req: Request, res: Response) => {
  const options = pick(req.query, paginationFields);
  const result = await TestService.getAllTests(options);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Tests retrieved successfully",
    data: result,
  });
});

const createTest = catchAsync(async (req: Request, res: Response) => {
  const result = await TestService.createTest(req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Test created successfully",
    data: result,
  });
});

const getSingleTest = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await TestService.getSingleTest(id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Test retrieved successfully",
    data: result,
  });
});

const updateTest = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await TestService.updateTest(id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Test updated successfully",
    data: result,
  });
});

const deleteTest = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await TestService.deleteTest(id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Test deleted successfully",
    data: result,
  });
});

export const TestController = {
  getAllTests,
  createTest,
  getSingleTest,
  updateTest,
  deleteTest,
};
