import { Request, Response } from "express";
import pick from "../../../shared/pick";
import { paginationFields } from "../../../constants/pagination";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import httpStatus from "http-status";
import { PaymentServices } from "./payment.service";

const CreatePatientPayment = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await PaymentServices.CreatePatientPayment(userId, req.body);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payment created successfully",
    data: result,
  });
});

const PatientPlatformSubscription = catchAsync(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const result = await PaymentServices.PatientPlatformSubscription(
      userId,
      req.body,
    );
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Payment created successfully",
      data: result,
    });
  },
);

const ClinicPlatformSubscription = catchAsync(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const result = await PaymentServices.ClinicPlatformSubscription(
      userId,
      req.body,
    );
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Payment created successfully",
      data: result,
    });
  },
);

const StripeGenerateOnboardingLink = catchAsync(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const result = await PaymentServices.StripeGenerateOnboardingLink(userId);
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Stripe onboarding link generated successfully",
      data: result,
    });
  },
);

const withdraBalance = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { amount } = req.body;

  const result = await PaymentServices.withdraBalance(userId, amount);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Balance transfer successfully",
    data: result,
  });
});

const getTopUpHistory = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["searchTerm", "startDate", "endDate"]);

  const result = await PaymentServices.getTopUpHistory(
    userId,
    filters,
    options,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Top up history retrieved successfully",
    data: result,
  });
});

const getWithdrawHistory = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["searchTerm", "startDate", "endDate"]);

  const result = await PaymentServices.getWithdrawHistory(
    userId,
    filters,
    options,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Withdraw history retrieved successfully",
    data: result,
  });
});

const getPatientPlatformSubscription = catchAsync(
  async (req: Request, res: Response) => {
    const userId = req.user.id;

    const result = await PaymentServices.getPatientPlatformSubscription(userId);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Patient platform subscription retrieved successfully",
      data: result,
    });
  },
);

const getClinicPlatformSubscription = catchAsync(
  async (req: Request, res: Response) => {
    const userId = req.user.id;

    const result = await PaymentServices.getClinicPlatformSubscription(userId);
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Clinic platform subscription retrieved successfully",
      data: result,
    });
  },
);

export const PaymentController = {
  CreatePatientPayment,
  StripeGenerateOnboardingLink,
  withdraBalance,
  getTopUpHistory,
  getWithdrawHistory,
  PatientPlatformSubscription,
  ClinicPlatformSubscription,
  getPatientPlatformSubscription,
  getClinicPlatformSubscription,
};
