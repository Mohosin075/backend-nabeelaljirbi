import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { IPaginationOptions } from "../../../interfaces/paginations";

const createSpecialist = async (data: { name: string; image: string }) => {
  const result = await prisma.specialists.create({
    data: {
      name: data.name,
      image: data.image,
    },
  });

  return result;
};

const getAllSpecialists = async (
  filters: { searchTerm?: string },
  options: IPaginationOptions,
) => {
  const { searchTerm } = filters;
  const { limit, page, skip } = paginationHelpers.calculatePagination(options);

  const andConditions: Prisma.SpecialistsWhereInput[] = [];

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

  const whereConditions: Prisma.SpecialistsWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const result = await prisma.specialists.findMany({
    where: whereConditions,
    skip,
    take: limit,
    orderBy: {
      createdAt: "desc",
    },
  });

  const total = await prisma.specialists.count({
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

const getSpecialistById = async (id: string) => {
  const specialist = await prisma.specialists.findUnique({
    where: { id },
  });

  if (!specialist) {
    throw new ApiError(httpStatus.NOT_FOUND, "Specialist not found");
  }

  return specialist;
};

const updateSpecialist = async (
  id: string,
  data: { name?: string; image?: string },
) => {
  const specialist = await prisma.specialists.findUnique({
    where: { id },
  });

  if (!specialist) {
    throw new ApiError(httpStatus.NOT_FOUND, "Specialist not found");
  }

  const result = await prisma.specialists.update({
    where: { id },
    data,
  });

  return result;
};

const deleteSpecialist = async (id: string) => {
  const specialist = await prisma.specialists.findUnique({
    where: { id },
  });

  if (!specialist) {
    throw new ApiError(httpStatus.NOT_FOUND, "Specialist not found");
  }

  await prisma.specialists.delete({
    where: { id },
  });

  return null;
};

export const SpecialistService = {
  createSpecialist,
  getAllSpecialists,
  getSpecialistById,
  updateSpecialist,
  deleteSpecialist,
};
