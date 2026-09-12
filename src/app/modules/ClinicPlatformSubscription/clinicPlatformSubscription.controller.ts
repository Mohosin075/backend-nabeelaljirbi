import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { ClinicPlatformSubscriptionService } from "./clinicPlatformSubscription.service";
import { Country } from "@prisma/client";

const createOrUpdateSubscription = catchAsync(
  async (req: Request, res: Response) => {
    const { amount, country, card } = req.body;

    const result =
      await ClinicPlatformSubscriptionService.createOrUpdateSubscription({
        amount,
        country,
        card
      });

    sendResponse(res, {
      statusCode: httpStatus.CREATED,
      success: true,
      message: "Clinic platform subscription created or updated successfully",
      data: result,
    });
  },
);

const getAllSubscriptions = catchAsync(async (req: Request, res: Response) => {
  const result = await ClinicPlatformSubscriptionService.getAllSubscriptions();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic platform subscriptions retrieved successfully",
    data: result,
  });
});

const getSubscriptionByCountry = catchAsync(
  async (req: Request, res: Response) => {
    const { country } = req.params;

    const result =
      await ClinicPlatformSubscriptionService.getSubscriptionByCountry(
        country as Country,
      );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Clinic platform subscription retrieved successfully",
      data: result,
    });
  },
);

const updateSubscription = catchAsync(async (req: Request, res: Response) => {
  const { country } = req.params;
  const { amount } = req.body;

  const result = await ClinicPlatformSubscriptionService.updateSubscription(
    country as Country,
    { amount },
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic platform subscription updated successfully",
    data: result,
  });
});

const deleteSubscription = catchAsync(async (req: Request, res: Response) => {
  const { country } = req.params;

  const result = await ClinicPlatformSubscriptionService.deleteSubscription(
    country as Country,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic platform subscription deleted successfully",
    data: result,
  });
});

export const ClinicPlatformSubscriptionController = {
  createOrUpdateSubscription,
  getAllSubscriptions,
  getSubscriptionByCountry,
  updateSubscription,
  deleteSubscription,
};
