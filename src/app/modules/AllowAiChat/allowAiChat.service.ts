
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

export const AllowAiChatService = {
  createAllowAiChat,
  getAllowAiChats,
};
