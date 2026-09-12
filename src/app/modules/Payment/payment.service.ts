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

const withdraBalance = async (userId: string, amount: number) => {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  if (!user.stripeDetailsSubmitted && !user.stripePayoutsEnabled) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Stripe account not completed");
  }

  if (user.wallet < amount) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Insufficient balance");
  }

  const transfer = await BalanceTransfer(amount, user.stripeAccountId || "");
  if (transfer.id) {
    // If Clener need to update wallet
    await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        wallet: {
          decrement: amount,
        },
      },
    });

    // top up record
    await prisma.topUp.create({
      data: {
        userId: userId,
        amount: amount,
        type: "WITHDRAW",
      },
    });

    // Create transfer record
    // await prisma.withdraw.create({
    //   data: {
    //     userId: doctorId,
    //     amount: amount,
    //   },
    // });
  }

  return transfer;
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
        lte: new Date(filterData.endDate),
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

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: topUps,
  };
};

const getWithdrawHistory = async (
  userId: string,
  filters: any,
  options: IPaginationOptions,
) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);
  const { searchTerm, ...filterData } = filters;

  const andConditions: Prisma.WithdrawWhereInput[] = [];

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
        lte: new Date(filterData.endDate),
      },
    });
  }

  const whereConditions: Prisma.WithdrawWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const withdraws = await prisma.withdraw.findMany({
    where: whereConditions,
    skip,
    take: limit,
    orderBy: {
      [sortBy]: sortOrder,
    },
  });

  const total = await prisma.withdraw.count({
    where: whereConditions,
  });

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: withdraws,
  };
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
