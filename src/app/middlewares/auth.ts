import { NextFunction, Request, Response } from "express";

import httpStatus from "http-status";
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
      const token = req.headers.authorization;

      if (!token) {
        throw new ApiError(httpStatus.UNAUTHORIZED, "You are not authorized!");
      }

      const verifiedUser = jwtHelpers.verifyToken(
        token,
        config.jwt.jwt_secret as Secret
      );

      const user = await prisma.user.findFirst({
        where: {
          OR: [
            ...(verifiedUser.id ? [{ id: verifiedUser.id }] : []),
            ...(verifiedUser.phoneNumber ? [{ phoneNumber: verifiedUser.phoneNumber }] : []),
          ],
        },
        include: {
          clinic: true,
          manager: true,
        },
      });

      if (!user) {
        throw new ApiError(httpStatus.NOT_FOUND, "This user is not found !");
      }

      let effectiveRole = user.role || verifiedUser.role;

      if (!effectiveRole) {
        if (user.clinic) effectiveRole = "CLINIC";
        else if (user.manager && user.manager.length > 0) effectiveRole = "MANAGER";
      }

      if (
        roles.length &&
        effectiveRole !== "ADMIN" &&
        (!effectiveRole || !roles.includes(effectiveRole))
      ) {
        throw new ApiError(httpStatus.FORBIDDEN, "Forbidden!");
      }

      req.user = {
        ...verifiedUser,
        ...user,
        role: effectiveRole,
        adminTier: user.adminTier || (verifiedUser as any).adminTier || "SUPER_ADMIN",
      };

      next();
    } catch (err) {
      next(err);
    }
  };
};

export default auth;
