import { Country, ClinicPlatformSubscription } from "@prisma/client";
import prisma from "../../../shared/prisma";
import getRateToUSD from "../../../helpars/USDExchange";

const createOrUpdateSubscription =async (payload: {
  amount: number;
  country: Country;
  card: string;
}) => {
  const existingSubscription =
    await prisma.clinicPlatformSubscription.findUnique({
      where: {
        country: payload.country,
      },
    });
  
  const countryCurrencyMap = {
  LIBYA: "LYD",
  TUNISIA: "TND",
  ALGERIA: "DZD",
  EGYPT: "EGP",
  } as const;

  // const cardSerial = await prisma.patientPlatformSubscription.findFirst({
  //   where: {
  //     card: payload.card,
  //   },
  // });

  
  const currency = countryCurrencyMap[payload.country];
  const rate = await getRateToUSD(currency);

  const usdAmount = Number((payload.amount * rate).toFixed(2));


  if (existingSubscription) {
    // If country already exists, just update the amount
    const result = await prisma.clinicPlatformSubscription.update({
      where: {
        country: payload.country,
      },
      data: {
        amount: payload.amount,
        usdAmount: usdAmount,
        card: payload.card,
      },
    });
    return result;
  } else {
    // If country doesn't exist, create a new subscription
    const result = await prisma.clinicPlatformSubscription.create({
      data: {
        amount: payload.amount,
        usdAmount: usdAmount,
        card: payload.card,
        country: payload.country,
      },
    });
    return result;
  }
};
const getAllSubscriptions = async () => {
  const result = await prisma.clinicPlatformSubscription.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });
  return result;
};

const getSubscriptionByCountry = async (country: Country) => {
  const result = await prisma.clinicPlatformSubscription.findUnique({
    where: {
      country,
    },
  });
  return result;
};

const updateSubscription = async (
  country: Country,
  payload: Partial<ClinicPlatformSubscription>,
) => {
  const result = await prisma.clinicPlatformSubscription.update({
    where: {
      country,
    },
    data: payload,
  });
  return result;
};

const deleteSubscription = async (country: Country) => {
  const result = await prisma.clinicPlatformSubscription.delete({
    where: {
      country,
    },
  });
  return result;
};

export const ClinicPlatformSubscriptionService = {
  createOrUpdateSubscription,
  getAllSubscriptions,
  getSubscriptionByCountry,
  updateSubscription,
  deleteSubscription,
};
