import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { ReferralService } from "./referral.service";
import pick from "../../../shared/pick";

const ReferralBonus = catchAsync(async (req: Request, res: Response) => {

  const userId = req.user.id;

  const { referralCode } = req.body;

  const result = await ReferralService.ReferralBonus(referralCode, userId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral bonus successfully",
    data: result,
  });
});

const claimRefelarsBunus = catchAsync(async (req: Request, res: Response) => {

  const userId = req.user.id;

  const { amount } = req.body;

  const result = await ReferralService.claimRefelarsBunus(userId, amount);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Referral bonus claimed successfully",
    data: result,
  });
});

export const ReferralController = {
  ReferralBonus,
  claimRefelarsBunus
};
