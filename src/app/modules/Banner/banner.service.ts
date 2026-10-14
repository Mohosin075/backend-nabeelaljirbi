import { Banner, Prisma } from "@prisma/client";
import prisma from "../../../shared/prisma";
import { createAuditLog } from "../../utils/auditLogger";

const createBanner = async (payload: { image: string }[], currentAdmin?: any) => {
  if (payload.length === 0) return { count: 0 };
  const result = await prisma.banner.createMany({
    data: payload,
  });

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "BANNER_CREATED",
    targetType: "BANNER",
    details: { count: payload.length, images: payload.map((p) => p.image) },
  });

  return result;
};

const getAllBanners = async () => {
  const result = await prisma.banner.findMany({
    orderBy: {
      createdAt: 'desc',
    },
  });
  return result;
};

const updateBanner = async (id: string, payload: Partial<Banner>, currentAdmin?: any) => {
  const result = await prisma.banner.update({
    where: {
      id,
    },
    data: payload,
  });

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "BANNER_UPDATED",
    targetType: "BANNER",
    targetId: id,
    details: payload,
  });

  return result;
};

const deleteBanner = async (id: string, currentAdmin?: any) => {
  const result = await prisma.banner.delete({
    where: {
      id,
    },
  });

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "BANNER_DELETED",
    targetType: "BANNER",
    targetId: id,
  });

  return result;
};

export const BannerService = {
  createBanner,
  getAllBanners,
  updateBanner,
  deleteBanner,
};
