
import { AllowAiChat } from "@prisma/client";
import prisma from "../../../shared/prisma";

const createAllowAiChat = async (data: AllowAiChat): Promise<AllowAiChat> => {
  const existingAllowAiChat = await prisma.allowAiChat.findFirst();

  if (existingAllowAiChat) {
    const result = await prisma.allowAiChat.update({
      where: {
        id: existingAllowAiChat.id,
      },
      data,
    });
    return result;
  }

  const result = await prisma.allowAiChat.create({
    data,
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
