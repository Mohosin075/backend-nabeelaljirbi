import ApiError from "../../../errors/ApiErrors";
import { bookingCurrencyCode, money } from "../../../utils/money";

// No exchange rate is inferred. LYD/TND require a separately supported funding method.
export function walletTopupOperations(db: any, charge: Function) {
  return async (userId: string, payload: any) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new ApiError(400, "Payment details are required");
    const user = await db.user.findUnique({ where: { id: userId } });
    if (
      !user ||
      user.role !== "PATIENT" ||
      user.status !== "ACTIVE" ||
      user.banned
    )
      throw new ApiError(403, "An active patient account is required");
    const currency = bookingCurrencyCode(user.country);
    if (!payload.currency || payload.currency !== currency)
      throw new ApiError(
        409,
        "Confirm the wallet currency before paying. No payment was attempted.",
      );
    if (!["EGP", "DZD"].includes(currency))
      throw new ApiError(
        409,
        "Direct card top-up is unavailable for this wallet currency. Use prepaid cards or another supported funding method.",
      );
    const amount = money(payload.amount, false);
    if (Number(payload.amount) !== amount || amount > 999999.99)
      throw new ApiError(
        400,
        "Use an amount with at most two decimal places, up to 999999.99",
      );
    if (
      !/^\d{13}-[a-f0-9]{16,64}$/.test(payload.requestId || "") ||
      !/^pm_[A-Za-z0-9]+$/.test(payload.paymentMethodId || "")
    )
      throw new ApiError(
        400,
        "A unique request ID and valid payment method are required",
      );
    const prefix = `stripe-topup:${userId}:${payload.requestId}:`;
    const ledgerId = `${prefix}${currency}:credit`;
    const existing = await db.topUp.findFirst({
      where: { id: { startsWith: prefix } },
    });
    if (existing) {
      if (existing.id !== ledgerId || existing.amount !== amount)
        throw new ApiError(
          409,
          "This payment request was already used for another amount or currency",
        );
      return { success: true, status: "succeeded", amount, currency, ledgerId };
    }
    // Stripe may prune idempotency keys after 24 hours. Never create again for
    // an uncredited old request; a captured-but-uncredited payment needs reconciliation.
    const age = Date.now() - Number(payload.requestId.split("-")[0]);
    if (age < -300000 || age > 23 * 3600000)
      throw new ApiError(
        409,
        "Payment request expired. Contact support before retrying a previously submitted payment.",
      );
    const intent = await charge({
      amount,
      currency: currency.toLowerCase(),
      paymentMethodId: payload.paymentMethodId,
      idempotencyKey: `wallet:${userId}:${payload.requestId}`,
      ledgerId,
      userId,
    });
    if (intent.status !== "succeeded")
      return { success: false, status: intent.status, amount, currency };
    if (
      intent.currency !== currency.toLowerCase() ||
      intent.amount_received !== Math.round(amount * 100) ||
      intent.metadata?.walletLedgerId !== ledgerId
    )
      throw new ApiError(
        409,
        "Payment verification failed; wallet was not credited. Contact support with your request ID.",
      );
    try {
      await db.$transaction(async (tx: any) => {
        await tx.topUp.create({
          data: { id: ledgerId, userId, amount, type: "RECHARGE" },
        });
        const credited = await tx.user.updateMany({
          where: {
            id: userId,
            country: user.country,
            status: "ACTIVE",
            banned: false,
          },
          data: { wallet: { increment: amount } },
        });
        if (credited.count !== 1)
          throw new ApiError(
            409,
            "Account changed during payment. Contact support with your request ID.",
          );
      });
    } catch (error: any) {
      if (error.code !== "P2002") throw error;
      const credited = await db.topUp.findUnique({ where: { id: ledgerId } });
      if (!credited || credited.userId !== userId || credited.amount !== amount)
        throw error;
    }
    return { success: true, status: "succeeded", amount, currency, ledgerId };
  };
}
