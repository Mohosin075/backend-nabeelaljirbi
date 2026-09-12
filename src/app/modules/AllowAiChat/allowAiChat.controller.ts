
import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { AllowAiChatService } from "./allowAiChat.service";

const createAllowAiChat = catchAsync(async (req: Request, res: Response) => {
  const result = await AllowAiChatService.createAllowAiChat(req.body);
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

export const AllowAiChatController = {
  createAllowAiChat,
  getAllowAiChats,
};
