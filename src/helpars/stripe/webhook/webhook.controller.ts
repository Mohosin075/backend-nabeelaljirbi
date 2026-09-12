import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import { webhookService } from "./webhook.service";

const stripeWebhookHandler = catchAsync(async (req: any, res: any) => {
  await webhookService.stripeWebhookHandler(req, res);

  // return res.status(200).json({ received: true });

  // sendResponse(res, {
  //     statusCode: httpStatus.OK,
  //     success: true,
  //     message: "Subscribed successfully",
  //     data: null,
  // });
});

export const webhookController = {
  stripeWebhookHandler,
};
