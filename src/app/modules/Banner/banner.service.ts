import { Banner, Prisma } from "@prisma/client";
import prisma from "../../../shared/prisma";

const createBanner = async (payload: { image: string }[]) => {
  if (payload.length === 0) return { count: 0 };
  const result = await prisma.banner.createMany({
    data: payload,
  });
  return result;
};

const getAllBanners = async () => {
    const result = await prisma.banner.findMany({
        orderBy: {
            createdAt: 'desc'
        }
    });
    return result;
};


const updateBanner = async (id: string, payload: Partial<Banner>) => {
    const result = await prisma.banner.update({
        where: {
            id
        },
        data: payload
    });
    return result;
};

const deleteBanner = async (id: string) => {
    const result = await prisma.banner.delete({
        where: {
            id
        }
    });
    return result;
};

export const BannerService = {
    createBanner,
    getAllBanners,
    updateBanner,
    deleteBanner
};
