import { Request } from "express";
import prisma from "../../shared/prisma";
import { AdminTier } from "@prisma/client";

export interface CreateAuditLogParams {
  req?: Request & { user?: any };
  adminId?: string;
  adminName?: string;
  adminTier?: AdminTier | string;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: Record<string, any> | null;
}

export const createAuditLog = async (params: CreateAuditLogParams) => {
  try {
    const { req, action, targetType, targetId, details } = params;

    const user = req?.user;
    const adminId = params.adminId || user?.id;
    const adminName = params.adminName || user?.fullName || user?.phoneNumber || "Admin";
    const adminTier = (params.adminTier || user?.adminTier || "SUPER_ADMIN") as AdminTier;

    if (!adminId) {
      console.warn("Audit log skipped: missing adminId for action", action);
      return;
    }

    const ipAddress =
      (req?.headers?.["x-forwarded-for"] as string) ||
      req?.socket?.remoteAddress ||
      req?.ip ||
      "127.0.0.1";

    await prisma.adminAuditLog.create({
      data: {
        adminId,
        adminName,
        adminTier,
        action,
        targetType,
        targetId: targetId ? String(targetId) : null,
        details: details || {},
        ipAddress: String(ipAddress),
      },
    });
  } catch (error) {
    // Non-blocking: audit log failure should not block primary operations, but log for monitoring
    console.error("Failed to create admin audit log:", error);
  }
};
