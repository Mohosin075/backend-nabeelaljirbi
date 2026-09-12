import { Request, Response } from "express";
import httpStatus from "http-status";
import config from "../../../config";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { AuthServices } from "./auth.service";

const sendOTP = catchAsync(async (req: Request, res: Response) => {
  const { phoneNumber, otpSender } = req.body;

  const result = await AuthServices.sendOTP(phoneNumber, otpSender);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP sent successfully",
    data: result,
  });
});

const verifyUserByOTP = catchAsync(async (req: Request, res: Response) => {
  const { phoneNumber, otp, fcmToken } = req.body;

  const result = await AuthServices.verifyUserByOTP(phoneNumber, otp, fcmToken);

  res.cookie("token", result.accessToken, {
    secure: config.env === "production",
    httpOnly: true,
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User verified successfully",
    data: result,
  });
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const refreshToken = req.headers.authorization;

  const result = await AuthServices.refreshToken(refreshToken as string);

  res.cookie("token", result.accessToken, {
    secure: config.env === "production",
    httpOnly: true,
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24 * 365,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Token refreshed successfully",
    data: result,
  });
});


const deleteUserAccount = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;

  console.log("user ID: ", userId)

  const result = await AuthServices.deleteAccout(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Account deleted successfully",
    data: result,
  })
})

export const AuthController = {
  sendOTP,
  verifyUserByOTP,
  refreshToken,
  deleteUserAccount
};
