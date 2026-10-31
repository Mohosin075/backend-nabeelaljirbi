import { NextFunction, Request, Response } from "express";

import httpStatus from "http-status";
import { UserStatus } from "@prisma/client";
import { Secret } from "jsonwebtoken";
import config from "../../config";
import ApiError from "../../errors/ApiErrors";
import prisma from "../../shared/prisma";
import { jwtHelpers } from "../../utils/jwtHelpers";

//  auth(UserRole.SUPER_ADMIN, UserRole.ADMIN)

const auth = (...roles: string[]) => {
  return async (
    req: Request & { user?: any },
    res: Response,
    next: NextFunction
  ) => {
    try {
      let token = req.headers.authorization;

      if (!token) {
        throw new ApiError(httpStatus.UNAUTHORIZED, "You are not authorized!");
      }

      if (token.startsWith("Bearer ") || token.startsWith("bearer ")) {
        token = token.slice(7).trim();
      }

      const verifiedUser = jwtHelpers.verifyToken(
        token,
        config.jwt.jwt_secret as Secret
      );

      if (!verifiedUser.id && !verifiedUser.phoneNumber)
        throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid account identity");
      const user = await prisma.user.findFirst({
        // A phone correction/reassignment must never change a token's account.
        where: verifiedUser.id ? { id: verifiedUser.id } : { phoneNumber: verifiedUser.phoneNumber },
        include: {
          clinic: true,
          manager: true,
        },
      });

      if (!user) {
        throw new ApiError(httpStatus.NOT_FOUND, "This user is not found !");
      }

      if (user.banned || user.status !== UserStatus.ACTIVE) {
        throw new ApiError(httpStatus.FORBIDDEN, "This account is not active");
      }

      let effectiveRole = user.role;

      if (!effectiveRole) {
        if (user.clinic) effectiveRole = "CLINIC";
        else if (user.manager && user.manager.length > 0) effectiveRole = "MANAGER";
      }

      if (
        roles.length &&
        !(effectiveRole === "ADMIN" && (user.adminTier || "SUPER_ADMIN") === "SUPER_ADMIN") &&
        (!effectiveRole || !roles.includes(effectiveRole))
      ) {
        throw new ApiError(httpStatus.FORBIDDEN, "Forbidden!");
      }

      if (effectiveRole === "ADMIN" && user.adminTier === "READ_ONLY" &&
          ["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase()))
        throw new ApiError(httpStatus.FORBIDDEN, "Read Only administrators cannot modify data");

      req.user = {
        ...verifiedUser,
        ...user,
        role: effectiveRole,
        adminTier: effectiveRole === "ADMIN" ? user.adminTier || "SUPER_ADMIN" : null,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
};

export default auth;
