import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import prisma from "../../shared/prisma";

export const initiateSuperAdmin = async () => {
  const payload = {
    fullName: "Super Admin",
    phoneNumber: "+218922363022",
    role: UserRole.ADMIN,
  };

  const existingSuperAdmin = await prisma.user.findUnique({
    where: { phoneNumber: payload.phoneNumber },
  });

  if (existingSuperAdmin) {
    return;
  }

  await prisma.$transaction(async (TransactionClient) => {
    await TransactionClient.user.create({
      data: {
        phoneNumber: payload.phoneNumber,
        role: payload.role,
        fullName: payload.fullName,
      },
    });
  });
};
