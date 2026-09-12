import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { IPaginationOptions } from "../../../interfaces/paginations";
import prisma from "../../../shared/prisma";
import { paginationHelpers } from "../../../utils/paginationHelper";
import { generateUniqueCardNumber } from "../../../helpars/NumberGeneration/card.number";
import * as ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

export const createPrepaidCard = async (payload: {
  amount: number;
  quantity: number;
}) => {
  const cardsData = [];

  for (let i = 0; i < payload.quantity; i++) {
    const cardNumber = await generateUniqueCardNumber();

    cardsData.push({
      cardNumber,
      amount: payload.amount,
      used: false,
    });
  }

  // Bulk insert
  const result = await prisma.prepaidCard.createMany({
    data: cardsData,
    skipDuplicates: true, // safety net
  });

  return {
    totalCreated: result.count,
  };
};


const getAllPrepaidCards = async (
  filters: { searchTerm?: string; used?: boolean | string; amount?: number | string },
  options: IPaginationOptions
) => {
  const { limit, page, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);
  const { searchTerm, used, amount } = filters;

  const andConditions: Prisma.PrepaidCardWhereInput[] = [];

  // Partial search on cardNumber or topUps.user fields
  if (searchTerm) {
    andConditions.push({
      OR: [
        { cardNumber: { contains: searchTerm, mode: "insensitive" } },
        {
          topUps: {
            some: {
              user: {
                OR: [
                  { fullName: { contains: searchTerm, mode: "insensitive" } },
                  { email: { contains: searchTerm, mode: "insensitive" } },
                  { phoneNumber: { contains: searchTerm, mode: "insensitive" } },
                  { country: { contains: searchTerm, mode: "insensitive" } },
                  { city: { contains: searchTerm, mode: "insensitive" } },
                  { address: { contains: searchTerm, mode: "insensitive" } },
                ],
              },
            },
          },
        },
      ],
    });
  }

  // Filter by used (true/false)
  if (used !== undefined) {
    const isUsed = String(used) === "true";
    andConditions.push({ used: isUsed });
  }

  // Filter by amount
  if (amount !== undefined) {
    andConditions.push({ amount: Number(amount) });
  }

  const whereConditions: Prisma.PrepaidCardWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const data = await prisma.prepaidCard.findMany({
    where: whereConditions,
    skip,
    take: limit,
    // distinct: ["id"], // avoid duplicates
    select: {
      id: true,
      cardNumber: true,
      amount: true,
      createdAt: true,
      updatedAt: true,
      used: true,
      topUps: {
        select: {
          createdAt: true,
          amount: true,
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              phoneNumber: true,
              country: true,
              city: true,
              address: true,
              profileImage: true,
            },
          },
        },
      },
    },
    orderBy:
      sortBy && sortOrder
        ? { [sortBy]: sortOrder }
        : { createdAt: "desc" },
  });

    const totalCard = await prisma.prepaidCard.count();

  // Used cards
  const usedCard = await prisma.prepaidCard.count({
    where: { used: true },
  });

  // Unused cards
  const unUsedCard = totalCard - usedCard;

  // Total amount of sold/used cards
  const totalAmountOfSellAgg = await prisma.prepaidCard.aggregate({
    _sum: { amount: true },
    where: { used: true },
  });

  const totalAmountOfSell = totalAmountOfSellAgg._sum.amount || 0;

  const total = await prisma.prepaidCard.count({ where: whereConditions });

  return {
    meta: { page, limit, total },
    data: {
      totalCard,
      usedCard,
      unUsedCard,
      totalAmountOfSell,
      data,
    },
  };
};


const getPrepaidCardById = async (id: string) => {
  const result = await prisma.prepaidCard.findUnique({
    where: { id },
  });
  return result;
};

const updatePrepaidCard = async (id: string, payload: { isActive?: boolean; amount?: number }) => {
  const result = await prisma.prepaidCard.update({
    where: { id },
    data: payload,
  });
  return result;
};

const deletePrepaidCard = async (id: string) => {
  const result = await prisma.prepaidCard.delete({
    where: { id },
  });
  return result;
};

// User function to redeem/purchase
const purchasePrepaidCard = async (userId: string, payload: { cardNumber: string }) => {
  const card = await prisma.prepaidCard.findUnique({
    where: {
      cardNumber: payload.cardNumber,
    },
  });

  if (!card) {
    throw new ApiError(httpStatus.NOT_FOUND, "Invalid card number");
  }

  if (card.used) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Card is already used");
  }

  // Use a transaction to ensure atomicity
  const result = await prisma.$transaction(async (tx) => {
    // 1. Mark card as inactive (assuming single use)
    await tx.prepaidCard.update({
      where: { id: card.id },
      data: { used: true },
    });

    // 2. Create TopUpPrepaidCard record
    const topUp = await tx.topUp.create({
      data: {
        userId,
        amount: card.amount,
        cardNumber: card.cardNumber,
        type: "RECHARGE",
      },
    });

    // 3. Update User Wallet
    await tx.user.update({
      where: { id: userId },
      data: {
        wallet: { increment: card.amount },
      },
    });

    return topUp;
  });

  return result;
};

const getTopPurchaseList = async (
  filters: { searchTerm?: string },
  options: IPaginationOptions
) => {
  const { limit, page, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);
  const { searchTerm } = filters;

  const andConditions: Prisma.TopUpWhereInput[] = [{type: "RECHARGE"}];

  if (searchTerm) {
    andConditions.push({
      OR: [
        { cardNumber: { contains: searchTerm, mode: "insensitive" } },
             { user: { fullName: { contains: searchTerm, mode: "insensitive" } } },
             { user: { phoneNumber: { contains: searchTerm, mode: "insensitive" } } },
             { user: { email: { contains: searchTerm, mode: "insensitive" } } },
             { user: { country: { contains: searchTerm, mode: "insensitive" } } },
             { user: { city: { contains: searchTerm, mode: "insensitive" } } },
             { user: { address: { contains: searchTerm, mode: "insensitive" } } },
             { user: { profileImage: { contains: searchTerm, mode: "insensitive" } } },
        ],
    });
  }

  const whereConditions: Prisma.TopUpWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const result = await prisma.topUp.findMany({
    where: whereConditions,
      select: {
        id: true,
        amount: true,
        cardNumber: true,
        createdAt: true,
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phoneNumber: true,
          country: true,
          city: true,
          address: true,
          profileImage: true,
        },
      },
    },
    skip,
    take: limit,
    orderBy:
      sortBy && sortOrder
        ? { [sortBy]: sortOrder }
        : {
            createdAt: "desc",
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
    data: result,
  };
};


export const exportPrepaidCardsToExcel = async () => {
  // 1️⃣ Fetch all prepaid cards
  const cards = await prisma.prepaidCard.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      topUps: {
        select: {
          createdAt: true,
          amount: true,
        },
      },
    },
  });

  // 2️⃣ Create workbook & worksheet
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Prepaid Cards");

  // 3️⃣ Define columns
  worksheet.columns = [
    { header: "Serial", key: "serial", width: 10 },
    { header: "Card Number", key: "cardNumber", width: 30 },
    { header: "Amount", key: "amount", width: 15 },
    { header: "Used", key: "used", width: 10 },
    { header: "TopUp Amount", key: "topUpAmount", width: 15 },
    { header: "TopUp Date", key: "topUpDate", width: 20 },
  ];

  // 4️⃣ Add rows
  cards.forEach((card, index) => {
    worksheet.addRow({
      serial: index + 1,
      cardNumber: card.cardNumber,
      amount: card.amount,
      used: card.used ? "Yes" : "No",
      topUpAmount: card.topUps[0]?.amount || 0,
      topUpDate: card.topUps[0]?.createdAt
        ? card.topUps[0].createdAt.toISOString()
        : "",
    });
  });

  // 5️⃣ File path
  const filePath = path.join(__dirname, "../../../exports/prepaid_cards.xlsx");

  // Ensure folder exists
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  // 6️⃣ Write file
  await workbook.xlsx.writeFile(filePath);

  return filePath; // Return the path if needed
};



export const PrepaidCardService = {
  createPrepaidCard,
  getAllPrepaidCards,
  getPrepaidCardById,
  updatePrepaidCard,
  deletePrepaidCard,
  purchasePrepaidCard,
  getTopPurchaseList,
  exportPrepaidCardsToExcel,
};
