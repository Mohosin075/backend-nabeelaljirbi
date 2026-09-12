import Stripe from "stripe";
import prisma from "../../../shared/prisma";
import stripe from "../stripe";
import emailSender from "../../emailSender/emailSender";
import ApiError from "../../../errors/ApiErrors";
import httpStatus from "http-status";

export const updateStripeAccount = async (stripeAccountId: string) => {
  try {
    // Fetch Stripe account details
    console.log("Stripe Account ID: ", stripeAccountId);
    const account = await stripe.accounts.retrieve(stripeAccountId);

    if (account.charges_enabled) {
      // Find cleaner with this stripeAccountId
      const cleaner = await prisma.user.findFirst({
        where: {
          stripeAccountId: stripeAccountId,
        },
      });

      if (cleaner) {
        await prisma.user.update({
          where: {
            id: cleaner.id,
          },
          data: {
            stripePayoutsEnabled: true,
            stripeDetailsSubmitted: true,
          },
        });
      }
    }

    return account;
  } catch (error) {
    console.error("Error updating Stripe account status:", error);
    throw new Error("Failed to update Stripe account status");
  }
};
