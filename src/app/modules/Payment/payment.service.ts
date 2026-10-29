import { settlementOperations } from "../Admin/settlement.operations";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import {
  BalanceTransfer,
  checkPaymentStatus,
  createPaymentIntent,
  createStripeAccount,
  generateAccountLink,
  updateStripeAccountStatus,
} from "../../../helpars/stripe/stripe";
import { ICardPaymentDetails } from "./payment.interface";
import prisma from "../../../shared/prisma";
import { IPaginationOptions } from "../../../interfaces/paginations";
import { paginationHelpers } from "../../../utils/paginationHelper";
import {
  ClinicPlatformSubscription,
  Country,
  PatientPlatformSubscription,
  Prisma,
  UserRole,
  TopUpType,
} from "@prisma/client";

const CreatePatientPayment = async (
  userId: string,
  payload: ICardPaymentDetails,
) => {
  const { paymentMethodId, amount } = payload;

  const patient = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });

  if (!patient) {
    throw new ApiError(httpStatus.NOT_FOUND, "Patient not found");
  }

  const paymentIntent = await createPaymentIntent(amount, paymentMethodId);
  const PaymentStatustus = await checkPaymentStatus(paymentIntent.id);

  if (PaymentStatustus.status === "succeeded") {
    const tx = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: {
          id: userId,
        },
        data: {
          wallet: {
            increment: amount,
          },
        },
      });

      // create top up
      await tx.topUp.create({
        data: {
          userId,
          amount,
          type: "RECHARGE",
        },
      });
    });
  }

  return PaymentStatustus;
};

const PatientPlatformSubscription = async (
  userId: string,
  payload: ICardPaymentDetails,
) => {
  const { paymentMethodId, amount, subscriptionId } = payload;

  const subscription = await prisma.patientPlatformSubscription.findUnique({
    where: { id: subscriptionId },
  });

  if (!subscription) {
    throw new ApiError(httpStatus.NOT_FOUND, "Subscription not found");
  }

  console.log(amount, subscription.usdAmount);

  if (amount !== subscription.usdAmount) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Amount does not match");
  }

  const patient = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!patient) {
    throw new ApiError(httpStatus.NOT_FOUND, "Patient not found");
  }

  // 🔹 Create payment intent
  const paymentIntent = await createPaymentIntent(amount, paymentMethodId);

  // 🔹 Check payment status
  const paymentStatus = await checkPaymentStatus(paymentIntent.id);

  if (paymentStatus.status !== "succeeded") {
    return paymentStatus; // payment failed or pending
  }

  // 🔹 Atomic transaction
  await prisma.$transaction(async (tx) => {
    // 1. Update Patient subscription status
    await tx.user.update({
      where: { id: userId },
      data: {
        platformSubscriptionActive: true,
      },
    });

    // 2. Create purchase record
    await tx.purchasePatientPlatformSubscription.create({
      data: {
        userId: userId,
        amount: subscription.amount,
        usdAmount: subscription.usdAmount,
        card: subscription.card,
        subscriptionId: subscriptionId,
      },
    });
  });

  return paymentStatus;
};

const ClinicPlatformSubscription = async (
  userId: string,
  payload: ICardPaymentDetails,
) => {
  const { paymentMethodId, amount, subscriptionId } = payload;

  const subscription = await prisma.clinicPlatformSubscription.findUnique({
    where: { id: subscriptionId },
  });

  if (!subscription) {
    throw new ApiError(httpStatus.NOT_FOUND, "Subscription not found");
  }

  console.log(amount, subscription.usdAmount);

  if (amount !== subscription.usdAmount) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Amount does not match");
  }

  const patient = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!patient) {
    throw new ApiError(httpStatus.NOT_FOUND, "Patient not found");
  }

  // 🔹 Create payment intent
  const paymentIntent = await createPaymentIntent(amount, paymentMethodId);

  // 🔹 Check payment status
  const paymentStatus = await checkPaymentStatus(paymentIntent.id);

  if (paymentStatus.status !== "succeeded") {
    return paymentStatus; // payment failed or pending
  }

  // 🔹 Atomic transaction
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        platformSubscriptionActive: true,
      },
    });

    // create purchase record
    await tx.purchaseClinicPlatformSubscription.create({
      data: {
        userId: userId,
        amount: subscription.amount,
        usdAmount: subscription.usdAmount,
        card: subscription.card,
        subscriptionId: subscriptionId,
      },
    });
  });

  return paymentStatus;
};

const StripeGenerateOnboardingLink = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      stripeAccountId: true,
      stripeDetailsSubmitted: true,
      stripePayoutsEnabled: true,
      email: true,
    },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "Cleaner not found");
  }

  if (!user.email) {
    return "Please update your profile set up email";
  }

  let stripeAccountId = user.stripeAccountId;

  if (!stripeAccountId) {
    stripeAccountId = await createStripeAccount(user.email || "");

    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        stripeAccountId,
      },
    });
  }

  if (stripeAccountId) {
    const account = await updateStripeAccountStatus(stripeAccountId);
    if (account.charges_enabled && account.details_submitted) {
      await prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          stripeDetailsSubmitted: true,
          stripePayoutsEnabled: true,
        },
      });
      return "Profile already completed";
    }
  }

  const generateAccount = await generateAccountLink(stripeAccountId || "");
  return generateAccount;
};

// Preserve the old URL for installed clients, but route it through admin approval.
const withdraBalance = async (userId: string, amount: number) => {
  const actor = await prisma.user.findUnique({ where: { id: userId } });
  return settlementOperations(prisma).create({ amount }, actor);
};
const getTopUpHistory = async (
  userId: string,
  filters: any,
  options: IPaginationOptions,
) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);
  const { searchTerm, ...filterData } = filters;

  const andConditions: Prisma.TopUpWhereInput[] = [];
  if (filterData.type) {
    if (!Object.values(TopUpType).includes(filterData.type)) throw new ApiError(400, "Invalid transaction type");
    andConditions.push({ type: filterData.type });
  }

  andConditions.push({ userId });

  if (searchTerm) {
    andConditions.push({
      OR: [{ id: { contains: searchTerm, mode: "insensitive" } }],
    });
  }

  if (filterData.startDate) {
    andConditions.push({
      createdAt: {
        gte: new Date(filterData.startDate),
      },
    });
  }

  if (filterData.endDate) {
    andConditions.push({
      createdAt: {
        lte: (() => {
          const end = new Date(filterData.endDate);
          if (isNaN(end.getTime())) throw new ApiError(400, "Invalid end date");
          if (!String(filterData.endDate).includes("T")) end.setUTCHours(23, 59, 59, 999);
          return end;
        })(),
      },
    });
  }

  const whereConditions: Prisma.TopUpWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const topUps = await prisma.topUp.findMany({
    where: whereConditions,
    skip,
    take: limit,
    orderBy: {
      [sortBy]: sortOrder,
    },
    select: {
      id: true,
      amount: true,
      type: true,
      createdAt: true,
      appointment: {
        select: {
          doctor: {
            select: {
              speciality: true,
              user: {
                select: {
                  fullName: true,
                },
              },
            },
          },
        },
      },
      prepaidCard: {
        select: {
          cardNumber: true,
        },
      },
    },
  });

  const total = await prisma.topUp.count({
    where: whereConditions,
  });

  const settlementIds = topUps.filter(row => row.id.startsWith("settlement:")).map(row => row.id.slice(11, -6));
  const receipts = settlementIds.length ? await prisma.settlement.findMany({ where: { id: { in: settlementIds } }, select: { id: true, receiptUrl: true, reference: true } }) : [];
  const receiptMap = new Map(receipts.map(row => [row.id, row]));
  return {
    meta: {
      page,
      limit,
      total,
    },
    data: topUps.map(row => {
      const settlementId = row.id.startsWith("settlement:") ? row.id.slice(11, -6) : null;
      const receipt = settlementId ? receiptMap.get(settlementId) : undefined;
      return { ...row, amount: Math.abs(row.amount), direction: row.id.endsWith(":credit") ? "CREDIT" : row.id.endsWith(":debit") || row.type === "WITHDRAW" || row.type === "PENALTY" || row.amount < 0 ? "DEBIT" : undefined,
        settlementId, receiptUrl: receipt?.receiptUrl || null, reference: receipt?.reference || null };
    }),
  };
};

const getWithdrawHistory = async (userId: string, filters: any, options: IPaginationOptions) => {
  const { page, limit, skip, sortOrder } = paginationHelpers.calculatePagination(options);
  const createdAt: any = {};
  for (const [key, operator] of [["startDate", "gte"], ["endDate", "lte"]]) {
    if (filters[key]) {
      const date = new Date(filters[key]);
      if (isNaN(date.getTime())) throw new ApiError(400, "Invalid history date");
      if (key === "endDate" && !String(filters[key]).includes("T")) date.setUTCHours(23, 59, 59, 999);
      createdAt[operator] = date;
    }
  }
  const where = { userId, ...(Object.keys(createdAt).length ? { createdAt } : {}),
    ...(filters.searchTerm ? { id: { contains: String(filters.searchTerm) } } : {}) };
  // Keep legacy rows visible; never rewrite historical payouts or wallet balances.
  const [journal, legacy] = await Promise.all([
    prisma.topUp.findMany({ where: { ...where, type: "WITHDRAW" } }),
    prisma.withdraw.findMany({ where }),
  ]);
  const rows = [
    ...journal.map(row => ({ ...row, source: "WALLET", direction: "DEBIT" })),
    ...legacy.map(row => ({ ...row, source: "LEGACY_WITHDRAW", direction: "DEBIT" })),
  ].sort((a, b) => (sortOrder === "asc" ? 1 : -1) * (a.createdAt.getTime() - b.createdAt.getTime()));
  return { meta: { page, limit, total: rows.length }, data: rows.slice(skip, skip + limit) };
};
const getPatientPlatformSubscription = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, country: true },
  });

  // const subscriptions = await prisma.patientPlatformSubscription.findMany({});

  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");

  let subscription: PatientPlatformSubscription | null = null;

  if (user.country) {
    const countryEnumValues: Country[] = [
      "LIBYA",
      "TUNISIA",
      "EGYPT",
      "ALGERIA",
    ];
    const countryEnum = user.country.toUpperCase() as Country;

    // ✅ Only query if country is in enum
    subscription = await prisma.patientPlatformSubscription.findUnique({
      where: { country: countryEnum },
    });
  }

  return subscription;
};

const getClinicPlatformSubscription = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, country: true },
  });

  // const subscriptions = await prisma.patientPlatformSubscription.findMany({});
  const subscriptions = await prisma.clinicPlatformSubscription.findMany({});

  console.log(subscriptions);

  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");

  let subscription: ClinicPlatformSubscription | null = null;

  if (user.country) {
    const countryEnumValues: Country[] = [
      "LIBYA",
      "TUNISIA",
      "EGYPT",
      "ALGERIA",
    ];
    const countryEnum = user.country.toUpperCase() as Country;

    // ✅ Only query if country is in enum
    subscription = await prisma.clinicPlatformSubscription.findUnique({
      where: { country: countryEnum },
    });
  }

  return subscription;
};
export const PaymentServices = {
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
