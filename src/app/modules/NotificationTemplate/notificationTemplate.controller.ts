import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { NotificationTemplateService } from "./notificationTemplate.service";

const getAllTemplates = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationTemplateService.getAllTemplates();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification templates retrieved successfully",
    data: result,
  });
});

const getTemplateById = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await NotificationTemplateService.getTemplateById(id);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification template retrieved successfully",
    data: result,
  });
});

const getTemplateByEventKey = catchAsync(async (req: Request, res: Response) => {
  const { eventKey } = req.params;
  const result = await NotificationTemplateService.getTemplateByEventKey(eventKey);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification template retrieved successfully",
    data: result,
  });
});

const createTemplate = catchAsync(async (req: Request, res: Response) => {
  const result = await NotificationTemplateService.createTemplate(req.body, (req as any).user);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Notification template created successfully",
    data: result,
  });
});

const updateTemplate = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await NotificationTemplateService.updateTemplate(id, req.body, (req as any).user);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification template updated successfully",
    data: result,
  });
});

const deleteTemplate = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await NotificationTemplateService.deleteTemplate(id, (req as any).user);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification template deleted successfully",
    data: result,
  });
});

const seedDefaultTemplates = catchAsync(async (req: Request, res: Response) => {
  await NotificationTemplateService.seedDefaultTemplates();
  const result = await NotificationTemplateService.getAllTemplates();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Default notification templates seeded successfully",
    data: result,
  });
});

export const NotificationTemplateController = {
  getAllTemplates,
  getTemplateById,
  getTemplateByEventKey,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  seedDefaultTemplates,
};
