import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { IPaginationOptions } from "../../../interfaces/paginations";

const createInsurance = async (data: { name: string; image: string }) => {
  const result = await prisma.insurances.create({
    data: {
      name: data.name,
      image: data.image,
    },
  });

  return result;
};

const getAllInsurances = async (
  filters: { searchTerm?: string },
  options: IPaginationOptions,
) => {
  const { searchTerm } = filters;
  const { limit, page, skip } = paginationHelpers.calculatePagination(options);

  const andConditions: Prisma.InsurancesWhereInput[] = [];

  if (searchTerm) {
    andConditions.push({
      OR: [
        {
          name: {
            contains: searchTerm,
            mode: "insensitive",
          },
        },
      ],
    });
  }

  const whereConditions: Prisma.InsurancesWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const result = await prisma.insurances.findMany({
    where: whereConditions,
    skip,
    take: limit,
    orderBy: {
      createdAt: "desc",
    },
  });

  const total = await prisma.insurances.count({
    where: whereConditions,
  });

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: result,
  };
};

const getInsuranceById = async (id: string) => {
  const insurance = await prisma.insurances.findUnique({
    where: { id },
  });

  if (!insurance) {
    throw new ApiError(httpStatus.NOT_FOUND, "Insurance not found");
  }

  return insurance;
};

const updateInsurance = async (
  id: string,
  data: { name?: string; image?: string },
) => {
  const insurance = await prisma.insurances.findUnique({
    where: { id },
  });

  if (!insurance) {
    throw new ApiError(httpStatus.NOT_FOUND, "Insurance not found");
  }

  const result = await prisma.insurances.update({
    where: { id },
    data,
  });

  return result;
};

const deleteInsurance = async (id: string) => {
  const insurance = await prisma.insurances.findUnique({
    where: { id },
  });

  if (!insurance) {
    throw new ApiError(httpStatus.NOT_FOUND, "Insurance not found");
  }

  await prisma.insurances.delete({
    where: { id },
  });

  return null;
};

export const InsuranceService = {
  createInsurance,
  getAllInsurances,
  getInsuranceById,
  updateInsurance,
  deleteInsurance,
};
