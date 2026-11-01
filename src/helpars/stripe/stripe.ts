import Stripe from "stripe";
import config from "../../config";

const stripe = new Stripe(config.stripe.stripe_secret_key as string, {
  apiVersion: "2024-12-18.acacia" as any,
});

export const createPaymentIntent = async (
  amount: number,
  paymentMethodId: string,
) => {
  try {
    if (amount <= 0) throw new Error("Invalid amount");

    // Convert to cents
    const amountInCents = Math.round(amount * 100);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "usd",
      payment_method: paymentMethodId,
      confirm: true,
      return_url: "http://localhost:3000/payment/success",
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
    });

    return paymentIntent;
  } catch (error: any) {
    console.error("Error creating payment intent:", error);
    throw new Error(error.message || "Payment failed");
  }
};

export const checkPaymentStatus = async (paymentIntentId: string) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    return {
      success: paymentIntent.status === "succeeded",
      status: paymentIntent.status,
    };
  } catch (error: any) {
    console.error("Error retrieving payment intent:", error);
    return { success: false, error: error.message };
  }
};

// Wallet top-ups are same-currency payments, separate from USD-priced subscriptions.
export const createWalletPaymentIntent = async (input: {
  amount: number;
  currency: string;
  paymentMethodId: string;
  idempotencyKey: string;
  ledgerId: string;
  userId: string;
}) =>
  stripe.paymentIntents.create(
    {
      amount: Math.round(input.amount * 100),
      currency: input.currency,
      payment_method: input.paymentMethodId,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: { walletLedgerId: input.ledgerId, userId: input.userId },
    },
    { idempotencyKey: input.idempotencyKey },
  );

export default stripe;
