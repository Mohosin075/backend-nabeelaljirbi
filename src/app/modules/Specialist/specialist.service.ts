import { Prisma } from "@prisma/client";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { IPaginationOptions } from "../../../interfaces/paginations";
import { createAuditLog } from "../../utils/auditLogger";

const createSpecialist = async (
  data: { name: string; image: string },
  currentAdmin?: any
) => {
  const result = await prisma.specialists.create({
    data: {
      name: data.name,
      image: data.image,
    },
  });

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "SPECIALIST_CREATED",
    targetType: "SPECIALIST",
    targetId: result.id,
    details: { name: data.name, image: data.image },
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
  currentAdmin?: any
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

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "SPECIALIST_UPDATED",
    targetType: "SPECIALIST",
    targetId: id,
    details: data,
  });

  return result;
};

const deleteSpecialist = async (id: string, currentAdmin?: any) => {
  const specialist = await prisma.specialists.findUnique({
    where: { id },
  });

  if (!specialist) {
    throw new ApiError(httpStatus.NOT_FOUND, "Specialist not found");
  }

  await prisma.specialists.delete({
    where: { id },
  });

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "SPECIALIST_DELETED",
    targetType: "SPECIALIST",
    targetId: id,
    details: { name: specialist.name },
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
