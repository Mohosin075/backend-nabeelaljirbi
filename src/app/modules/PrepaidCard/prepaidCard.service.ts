import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { IPaginationOptions } from "../../../interfaces/paginations";
import prisma from "../../../shared/prisma";
import { paginationHelpers } from "../../../utils/paginationHelper";
import {
  generateUniqueCardNumber,
  generateUniqueCardNumbersBatch,
} from "../../../helpars/NumberGeneration/card.number";
import { createAuditLog } from "../../utils/auditLogger";
import * as ExcelJS from "exceljs";

/**
 * High-performance prepaid card creation at scale
 */
export const createPrepaidCard = async (
  payload: {
    amount: number;
    quantity: number;
  },
  currentAdmin?: any
) => {
  const quantity = Number(payload.quantity);
  const amount = Number(payload.amount);

  if (!quantity || quantity <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Quantity must be greater than 0");
  }
  if (!amount || amount <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Amount must be greater than 0");
  }

  // Generate unique card numbers in memory with collision resolution in 1-2 batch checks
  const cardNumbers = await generateUniqueCardNumbersBatch(quantity);

  const cardsData = cardNumbers.map((cardNumber) => ({
    cardNumber,
    amount,
    used: false,
  }));

  // Bulk insert in chunks of 1000 for high efficiency & reliability
  let totalCreated = 0;
  const chunkSize = 1000;
  for (let i = 0; i < cardsData.length; i += chunkSize) {
    const chunk = cardsData.slice(i, i + chunkSize);
    const result = await prisma.prepaidCard.createMany({
      data: chunk,
      skipDuplicates: true,
    });
    totalCreated += result.count;
  }

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "PREPAID_CARDS_CREATED",
    targetType: "PREPAID_CARD",
    details: {
      amount,
      quantity,
      totalCreated,
    },
  });

  return {
    totalCreated,
  };
};

/**
 * Get all prepaid cards with filtering by denomination, used/unused status, and search
 */
const getAllPrepaidCards = async (
  filters: { searchTerm?: string; used?: boolean | string; amount?: number | string },
  options: IPaginationOptions
) => {
  const { limit, page, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);
  const { searchTerm, used, amount } = filters;

  const andConditions: Prisma.PrepaidCardWhereInput[] = [];

  // Partial search on cardNumber or topUps.user fields
  if (searchTerm && searchTerm.trim() !== "") {
    const term = searchTerm.trim();
    andConditions.push({
      OR: [
        { cardNumber: { contains: term, mode: "insensitive" } },
        {
          topUps: {
            some: {
              user: {
                OR: [
                  { fullName: { contains: term, mode: "insensitive" } },
                  { email: { contains: term, mode: "insensitive" } },
                  { phoneNumber: { contains: term, mode: "insensitive" } },
                  { country: { contains: term, mode: "insensitive" } },
                  { city: { contains: term, mode: "insensitive" } },
                  { address: { contains: term, mode: "insensitive" } },
                ],
              },
            },
          },
        },
      ],
    });
  }

  // Filter by used (true/false) - explicitly handle 'all'
  if (used !== undefined && used !== "" && used !== "all") {
    const isUsed = String(used) === "true";
    andConditions.push({ used: isUsed });
  }

  // Filter by amount (denomination) - explicitly handle 'all'
  if (
    amount !== undefined &&
    amount !== "" &&
    amount !== "all" &&
    !isNaN(Number(amount))
  ) {
    andConditions.push({ amount: Number(amount) });
  }

  const whereConditions: Prisma.PrepaidCardWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const [data, total, totalCard, usedCard, totalAmountOfSellAgg] = await Promise.all([
    prisma.prepaidCard.findMany({
      where: whereConditions,
      skip,
      take: limit,
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
    }),
    prisma.prepaidCard.count({ where: whereConditions }),
    prisma.prepaidCard.count(),
    prisma.prepaidCard.count({ where: { used: true } }),
    prisma.prepaidCard.aggregate({
      _sum: { amount: true },
      where: { used: true },
    }),
  ]);

  const unUsedCard = totalCard - usedCard;
  const totalAmountOfSell = totalAmountOfSellAgg._sum.amount || 0;

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

/**
 * Get distinct available denominations in system
 */
const getDistinctDenominations = async () => {
  const denominations = await prisma.prepaidCard.findMany({
    distinct: ["amount"],
    select: { amount: true },
    orderBy: { amount: "asc" },
  });
  return denominations.map((d) => d.amount);
};

const getPrepaidCardById = async (id: string) => {
  const result = await prisma.prepaidCard.findUnique({
    where: { id },
  });
  return result;
};

const updatePrepaidCard = async (
  id: string,
  payload: { isActive?: boolean; amount?: number }
) => {
  const result = await prisma.prepaidCard.update({
    where: { id },
    data: payload,
  });
  return result;
};

/**
 * Safely delete a single prepaid card.
 * Protects against deleting cards that have already been used/redeemed.
 */
const deletePrepaidCard = async (id: string, currentAdmin?: any) => {
  const card = await prisma.prepaidCard.findUnique({
    where: { id },
  });

  if (!card) {
    throw new ApiError(httpStatus.NOT_FOUND, "Prepaid card not found");
  }

  if (card.used) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Cannot delete a used card. Used cards are tied to user balances and financial ledger history."
    );
  }

  const result = await prisma.prepaidCard.delete({
    where: { id },
  });

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "PREPAID_CARD_DELETED",
    targetType: "PREPAID_CARD",
    targetId: id,
    details: {
      cardNumber: result.cardNumber,
      amount: result.amount,
    },
  });

  return result;
};

/**
 * Bulk delete prepaid cards.
 * Efficiently deletes multiple cards in a single query while strictly protecting
 * any cards that have already been redeemed/used.
 */
const bulkDeletePrepaidCards = async (ids: string[], currentAdmin?: any) => {
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Please provide card IDs to delete");
  }

  // Find cards to check status
  const cards = await prisma.prepaidCard.findMany({
    where: { id: { in: ids } },
    select: { id: true, cardNumber: true, amount: true, used: true },
  });

  if (cards.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "No matching cards found to delete");
  }

  const unusedCards = cards.filter((c) => !c.used);
  const usedCards = cards.filter((c) => c.used);

  if (unusedCards.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Selected card(s) have already been redeemed and cannot be deleted to preserve financial audit history."
    );
  }

  const deleteResult = await prisma.prepaidCard.deleteMany({
    where: {
      id: { in: unusedCards.map((c) => c.id) },
      used: false,
    },
  });

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "PREPAID_CARDS_BULK_DELETED",
    targetType: "PREPAID_CARD",
    details: {
      requestedCount: ids.length,
      deletedCount: deleteResult.count,
      skippedUsedCount: usedCards.length,
    },
  });

  return {
    deletedCount: deleteResult.count,
    skippedCount: usedCards.length,
    message:
      usedCards.length > 0
        ? `Successfully deleted ${deleteResult.count} unused card(s). ${usedCards.length} used card(s) were protected from deletion.`
        : `Successfully deleted ${deleteResult.count} card(s).`,
  };
};

// User function to redeem/purchase
const purchasePrepaidCard = async (userId: string, payload: { cardNumber: string }) => {
  const sanitizedCardNumber = (payload.cardNumber || "").trim().replace(/\s+/g, "");
  const card = await prisma.prepaidCard.findUnique({
    where: {
      cardNumber: sanitizedCardNumber,
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
    // 1. Mark card as used
    await tx.prepaidCard.update({
      where: { id: card.id },
      data: { used: true },
    });

    // 2. Create TopUp record
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

  const andConditions: Prisma.TopUpWhereInput[] = [{ type: "RECHARGE" }];

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

/**
 * Export prepaid cards to Excel buffer directly, supporting bulk selection and active filters
 */
export const exportPrepaidCardsToExcel = async (filters: {
  searchTerm?: string;
  used?: boolean | string;
  amount?: number | string;
  ids?: string[];
}) => {
  const andConditions: Prisma.PrepaidCardWhereInput[] = [];

  if (filters.ids && filters.ids.length > 0) {
    andConditions.push({ id: { in: filters.ids } });
  } else {
    if (filters.searchTerm && filters.searchTerm.trim() !== "") {
      const term = filters.searchTerm.trim();
      andConditions.push({
        OR: [
          { cardNumber: { contains: term, mode: "insensitive" } },
          {
            topUps: {
              some: {
                user: {
                  OR: [
                    { fullName: { contains: term, mode: "insensitive" } },
                    { phoneNumber: { contains: term, mode: "insensitive" } },
                  ],
                },
              },
            },
          },
        ],
      });
    }

    if (
      filters.used !== undefined &&
      filters.used !== "" &&
      filters.used !== "all"
    ) {
      andConditions.push({ used: String(filters.used) === "true" });
    }

    if (
      filters.amount !== undefined &&
      filters.amount !== "" &&
      filters.amount !== "all" &&
      !isNaN(Number(filters.amount))
    ) {
      andConditions.push({ amount: Number(filters.amount) });
    }
  }

  const whereConditions: Prisma.PrepaidCardWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  // Fetch cards (streamable/batch safe)
  const cards = await prisma.prepaidCard.findMany({
    where: whereConditions,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      cardNumber: true,
      amount: true,
      used: true,
      createdAt: true,
      topUps: {
        take: 1,
        orderBy: { createdAt: "desc" },
        select: {
          createdAt: true,
          amount: true,
          user: {
            select: {
              fullName: true,
              phoneNumber: true,
            },
          },
        },
      },
    },
  });

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Prepaid Cards");

  worksheet.columns = [
    { header: "Serial", key: "serial", width: 10 },
    { header: "Card Number", key: "cardNumber", width: 28 },
    { header: "Amount (LYD)", key: "amount", width: 16 },
    { header: "Status", key: "status", width: 14 },
    { header: "Created Date", key: "createdAt", width: 22 },
    { header: "Used By", key: "usedBy", width: 24 },
    { header: "User Phone", key: "userPhone", width: 20 },
    { header: "Redeemed Date", key: "topUpDate", width: 22 },
  ];

  // Header styling
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0F2FE" },
  };

  cards.forEach((card, index) => {
    worksheet.addRow({
      serial: index + 1,
      cardNumber: card.cardNumber,
      amount: card.amount,
      status: card.used ? "Used" : "Unused",
      createdAt: card.createdAt
        ? new Date(card.createdAt).toISOString().replace("T", " ").substring(0, 19)
        : "",
      usedBy: card.topUps[0]?.user?.fullName || "—",
      userPhone: card.topUps[0]?.user?.phoneNumber || "—",
      topUpDate: card.topUps[0]?.createdAt
        ? new Date(card.topUps[0].createdAt)
            .toISOString()
            .replace("T", " ")
            .substring(0, 19)
        : "—",
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

export const PrepaidCardService = {
  createPrepaidCard,
  getAllPrepaidCards,
  getDistinctDenominations,
  getPrepaidCardById,
  updatePrepaidCard,
  deletePrepaidCard,
  bulkDeletePrepaidCards,
  purchasePrepaidCard,
  getTopPurchaseList,
  exportPrepaidCardsToExcel,
};
