import Stripe from "stripe";
import { Request, Response } from "express";
import config from "../../../config";
import stripe from "../stripe";
import { updateStripeAccount } from "./databaseUpdate";

const stripeWebhookHandler = async (req: Request, res: Response) => {
  // @ts-ignore
  const sig = req.headers["stripe-signature"] as string;
  let event: any;

  try {
    event = stripe.webhooks.constructEvent(
      req.body as any,
      sig as string,
      config.stripe.stripe_webhook_secret as string,
    );
  } catch (error: any) {
    console.error("Error processing webhook:", error);
    return res.status(400).json({ error: `Webhook Error: ${error.message}` });
  }

  console.log("✅ event type: " + event.type);

  // Respond immediately to Stripe (must be within 2 seconds)
  res.status(200).json({ received: true });

  // Process webhook asynchronously to avoid timeouts
  try {
    switch (event.type) {
      case "account.updated":
        // Use setImmediate to process after responding
        setImmediate(async () => {
          try {
            await updateStripeAccount(event.data.object.id);
            console.log("✅ Stripe account updated successfully");
          } catch (error) {
            console.error("Error updating Stripe account in webhook:", error);
          }
        });
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }
  } catch (error) {
    console.error("Error scheduling webhook processing:", error);
  }
};

export const webhookService = {
  stripeWebhookHandler,
};
