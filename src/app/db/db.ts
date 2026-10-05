import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import prisma from "../../shared/prisma";

export const initiateSuperAdmin = async () => {
  const hashedPassword = await bcrypt.hash("admin123456", 10);
  const payload = {
    fullName: "Super Admin",
    phoneNumber: "+218922363022",
    email: "web.mohosin@gmail.com",
    role: UserRole.ADMIN,
  };

  const existingSuperAdmin = await prisma.user.findFirst({
    where: {
      OR: [
        { phoneNumber: payload.phoneNumber },
        { email: payload.email },
        { role: UserRole.ADMIN },
      ],
    },
  });

  if (existingSuperAdmin) {
    if (!existingSuperAdmin.password || !existingSuperAdmin.email) {
      await prisma.user.update({
        where: { id: existingSuperAdmin.id },
        data: {
          email: existingSuperAdmin.email || payload.email,
          password: existingSuperAdmin.password || hashedPassword,
        },
      });
    }
    return;
  }

  await prisma.user.create({
    data: {
      phoneNumber: payload.phoneNumber,
      email: payload.email,
      password: hashedPassword,
      role: payload.role,
      fullName: payload.fullName,
    },
  });
};
