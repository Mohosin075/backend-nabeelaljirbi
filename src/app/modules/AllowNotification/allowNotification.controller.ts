
import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { AllowNotificationService } from "./allowNotification.service";

const createAllowNotification = catchAsync(async (req: Request, res: Response) => {
  const result = await AllowNotificationService.createAllowNotification(req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Allow Notification created successfully",
    data: result,
  });
});

const getAllowNotifications = catchAsync(async (req: Request, res: Response) => {
  const result = await AllowNotificationService.getAllowNotifications();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Allow Notifications retrieved successfully",
    data: result,
  });
});

const getAllowNotificationById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await AllowNotificationService.getAllowNotificationById(id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Allow Notification retrieved successfully",
    data: result,
  });
});

const updateAllowNotification = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await AllowNotificationService.updateAllowNotification(id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Allow Notification updated successfully",
    data: result,
  });
});

const deleteAllowNotification = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await AllowNotificationService.deleteAllowNotification(id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Allow Notification deleted successfully",
    data: result,
  });
});

export const AllowNotificationController = {
  createAllowNotification,
  getAllowNotifications,
  getAllowNotificationById,
  updateAllowNotification,
  deleteAllowNotification,
};
