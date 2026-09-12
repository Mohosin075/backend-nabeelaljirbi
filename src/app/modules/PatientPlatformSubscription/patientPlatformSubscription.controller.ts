import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { PatientPlatformSubscriptionService } from "./patientPlatformSubscription.service";
import { Country } from "@prisma/client";

const createOrUpdateSubscription = catchAsync(
  async (req: Request, res: Response) => {
    const { amount, country, card } = req.body;

    const convertAmount = parseFloat(amount);

    const result =
      await PatientPlatformSubscriptionService.createOrUpdateSubscription({
        amount,
        country,
        card,
      });

    sendResponse(res, {
      statusCode: httpStatus.CREATED,
      success: true,
      message: "Patient platform subscription created or updated successfully",
      data: result,
    });
  },
);

const getAllSubscriptions = catchAsync(async (req: Request, res: Response) => {
  const result = await PatientPlatformSubscriptionService.getAllSubscriptions();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient platform subscriptions retrieved successfully",
    data: result,
  });
});

const getSubscriptionByCountry = catchAsync(
  async (req: Request, res: Response) => {
    const { country } = req.params;

    const result =
      await PatientPlatformSubscriptionService.getSubscriptionByCountry(
        country as Country,
      );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Patient platform subscription retrieved successfully",
      data: result,
    });
  },
);

const updateSubscription = catchAsync(async (req: Request, res: Response) => {
  const { country } = req.params;
  const { amount } = req.body;

  const result = await PatientPlatformSubscriptionService.updateSubscription(
    country as Country,
    { amount },
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient platform subscription updated successfully",
    data: result,
  });
});

const deleteSubscription = catchAsync(async (req: Request, res: Response) => {
  const { country } = req.params;

  const result = await PatientPlatformSubscriptionService.deleteSubscription(
    country as Country,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient platform subscription deleted successfully",
    data: result,
  });
});

export const PatientPlatformSubscriptionController = {
  createOrUpdateSubscription,
  getAllSubscriptions,
  getSubscriptionByCountry,
  updateSubscription,
  deleteSubscription,
};
