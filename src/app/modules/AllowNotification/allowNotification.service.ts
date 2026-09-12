
import { AllowNotification } from "@prisma/client";
import prisma from "../../../shared/prisma";

const createAllowNotification = async (
  data: AllowNotification
): Promise<AllowNotification> => {
  const existingAllowNotification = await prisma.allowNotification.findFirst();

  if (existingAllowNotification) {
    const result = await prisma.allowNotification.update({
      where: {
        id: existingAllowNotification.id,
      },
      data,
    });
    return result;
  }

  const result = await prisma.allowNotification.create({
    data,
  });
  return result;
};

const getAllowNotifications = async (): Promise<AllowNotification[]> => {
  const result = await prisma.allowNotification.findMany();
  return result;
};

const getAllowNotificationById = async (
  id: string
): Promise<AllowNotification | null> => {
  const result = await prisma.allowNotification.findUnique({
    where: {
      id,
    },
  });
  return result;
};

const updateAllowNotification = async (
  id: string,
  payload: Partial<AllowNotification>
): Promise<AllowNotification> => {
  const result = await prisma.allowNotification.update({
    where: {
      id,
    },
    data: payload,
  });
  return result;
};

const deleteAllowNotification = async (
  id: string
): Promise<AllowNotification> => {
  const result = await prisma.allowNotification.delete({
    where: {
      id,
    },
  });
  return result;
};

export const AllowNotificationService = {
  createAllowNotification,
  getAllowNotifications,
  getAllowNotificationById,
  updateAllowNotification,
  deleteAllowNotification,
};
