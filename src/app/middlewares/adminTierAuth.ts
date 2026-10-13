import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { AdminTier, UserRole } from "@prisma/client";
import ApiError from "../../errors/ApiErrors";

/**
 * Middleware to enforce Admin 5 Tiers and Scoped Permissions:
 * - Super Admin (wildcard full access)
 * - Operations (Patients, Doctors, Clinics, Bookings, Verifications, Banners, Complaints)
 * - Finance (Financials, Wallet, Settlements, Platform Fees, Prepaid Cards)
 * - Support (Support tickets, Complaints, Read-only on sensitive financials)
 * - Read Only (Inspection only - all mutating actions blocked)
 */
export const adminTierAuth = (...allowedTiers: (AdminTier | string)[]) => {
  return async (
    req: Request & { user?: any },
    res: Response,
    next: NextFunction
  ) => {
    try {
      const user = req.user;

      if (!user) {
        throw new ApiError(httpStatus.UNAUTHORIZED, "You are not authorized!");
      }

      if (user.role !== UserRole.ADMIN) {
        throw new ApiError(httpStatus.FORBIDDEN, "Forbidden: Admin access required!");
      }

      const effectiveTier = (user.adminTier || AdminTier.SUPER_ADMIN) as AdminTier;

      // Scoped permissions: Read Only administrators cannot execute any mutations
      const isMutation = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method.toUpperCase());
      if (effectiveTier === AdminTier.READ_ONLY && isMutation) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          "Read Only administrators are restricted from modifying data or approving actions."
        );
      }

      // If specific tiers are required, check against effective tier (SUPER_ADMIN always allowed)
      if (
        allowedTiers.length > 0 &&
        effectiveTier !== AdminTier.SUPER_ADMIN &&
        !allowedTiers.includes(effectiveTier)
      ) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          `Access restricted to ${allowedTiers.join(", ")} tier(s). Your tier: ${effectiveTier}`
        );
      }

      // Attach effective tier to request
      req.user.adminTier = effectiveTier;

      next();
    } catch (err) {
      next(err);
    }
  };
};

export default adminTierAuth;
