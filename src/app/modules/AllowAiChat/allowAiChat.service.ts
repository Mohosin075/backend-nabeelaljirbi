
import { AllowAiChat } from "@prisma/client";
import prisma from "../../../shared/prisma";
import { createAuditLog } from "../../utils/auditLogger";

const createAllowAiChat = async (data: AllowAiChat, currentAdmin?: any): Promise<AllowAiChat> => {
  const existingAllowAiChat = await prisma.allowAiChat.findFirst();

  let result: AllowAiChat;
  if (existingAllowAiChat) {
    result = await prisma.allowAiChat.update({
      where: {
        id: existingAllowAiChat.id,
      },
      data,
    });
  } else {
    result = await prisma.allowAiChat.create({
      data,
    });
  }

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "AI_CHAT_SETTINGS_UPDATED",
    targetType: "AI_SETTINGS",
    targetId: result.id,
    details: data,
  });

  return result;
};

const getAllowAiChats = async (): Promise<AllowAiChat[]> => {
  const result = await prisma.allowAiChat.findMany();
  return result;
};

const getMyAiStatus = async (userId: string) => {
  const rolling24hAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [usedCount, config, oldestInWindow] = await Promise.all([
    prisma.chat.count({
      where: { userId, createdAt: { gte: rolling24hAgo } },
    }),
    prisma.allowAiChat.findFirst(),
    prisma.chat.findFirst({
      where: { userId, createdAt: { gte: rolling24hAgo } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const limit = config?.limit ?? 5;
  const isEnable = config?.isEnable ?? true;
  const remainingCount = Math.max(0, limit - usedCount);
  const nextResetTime = oldestInWindow
    ? new Date(oldestInWindow.createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString()
    : null;

  return {
    isEnable,
    limit,
    usedCount,
    remainingCount,
    nextResetTime,
    windowHours: 24,
  };
};

const getAdminAiStats = async () => {
  const rolling24hAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [
    totalQueriesAllTime,
    totalQueries24h,
    activeUsersGroup,
    doctorRecommendations24h,
    totalRecommendations,
    config,
  ] = await Promise.all([
    prisma.chat.count(),
    prisma.chat.count({ where: { createdAt: { gte: rolling24hAgo } } }),
    prisma.chat.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: rolling24hAgo } },
    }),
    prisma.chat.count({
      where: { doctorId: { not: null }, createdAt: { gte: rolling24hAgo } },
    }),
    prisma.chat.count({ where: { doctorId: { not: null } } }),
    prisma.allowAiChat.findFirst(),
  ]);

  return {
    provider: "OpenAI (gpt-4o-mini)",
    providerStatus: "Operational",
    rollingWindowHours: 24,
    totalQueriesAllTime,
    totalQueries24h,
    activeUsers24h: activeUsersGroup.length,
    activeAiUsers24h: activeUsersGroup.length,
    doctorRecommendations24h,
    totalRecommendations,
    configuredLimit: config?.limit ?? 5,
    limit: config?.limit ?? 5,
    isEnable: config?.isEnable ?? true,
    engine: {
      provider: "OpenAI",
      model: "gpt-4o-mini",
      status: "Operational",
      rollingWindowHours: 24,
      credentialsManagedServerSide: true,
    },
  };
};

export const AllowAiChatService = {
  createAllowAiChat,
  getAllowAiChats,
  getMyAiStatus,
  getAdminAiStats,
};
