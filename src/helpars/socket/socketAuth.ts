// src/helpars/socket/socketAuth.ts
import { Secret } from "jsonwebtoken";
import prisma from "../../shared/prisma";
import config from "../../config";
import { jwtHelpers } from "../../utils/jwtHelpers";

export const socketAuth = async (token: string) => {
  if (!token) {
    throw new Error("Unauthorized: Token required");
  }

  // verify token
  const verifiedUser = jwtHelpers.verifyToken(
    token,
    config.jwt.jwt_secret as Secret
  );

  // check user exists
  const user = await prisma.user.findUnique({
    where: { phoneNumber: verifiedUser.phoneNumber },
  });

  if (!user) {
    throw new Error("Unauthorized: User not found");
  }

  return {
    id: user.id, // ✅ userId from DB
    phoneNumber: user.phoneNumber,
    role: user.role,
  };
};
