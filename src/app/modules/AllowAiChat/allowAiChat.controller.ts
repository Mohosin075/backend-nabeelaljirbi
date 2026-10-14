
import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { AllowAiChatService } from "./allowAiChat.service";

const createAllowAiChat = catchAsync(async (req: Request, res: Response) => {
  const currentAdmin = (req as any).user;
  const result = await AllowAiChatService.createAllowAiChat(req.body, currentAdmin);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Allow Ai Chat created successfully",
    data: result,
  });
});

const getAllowAiChats = catchAsync(async (req: Request, res: Response) => {
  const result = await AllowAiChatService.getAllowAiChats();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Allow Ai Chats retrieved successfully",
    data: result,
  });
});

const getMyAiStatus = catchAsync(async (req: Request, res: Response) => {
  const userId = (req as any).user?.id;
  const result = await AllowAiChatService.getMyAiStatus(userId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User AI usage status retrieved successfully",
    data: result,
  });
});

const getAdminAiStats = catchAsync(async (req: Request, res: Response) => {
  const result = await AllowAiChatService.getAdminAiStats();
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Admin AI usage statistics retrieved successfully",
    data: result,
  });
});

export const AllowAiChatController = {
  createAllowAiChat,
  getAllowAiChats,
  getMyAiStatus,
  getAdminAiStats,
};
