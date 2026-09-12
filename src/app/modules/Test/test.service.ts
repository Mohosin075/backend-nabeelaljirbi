import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { IPaginationOptions } from "../../../interfaces/paginations";

const getAllTests = async (options: IPaginationOptions) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);

  const tests = await prisma.test.findMany({
    skip,
    take: limit,
    orderBy: {
      [sortBy]: sortOrder,
    },
  });

  const total = await prisma.test.count();

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: tests,
  };
};

const createTest = async (payload: any) => {
  // Create a new test record
  return await prisma.test.create({ data: payload });
};

const getSingleTest = async (id: string) => {
  // Get a single test record by id
  const test = await prisma.test.findUnique({ where: { id } });
  if (!test) {
    throw new ApiError(httpStatus.NOT_FOUND, "Test not found");
  }
  return test;
};

const updateTest = async (id: string, payload: any) => {
  // Update a test record by id
  const test = await prisma.test.findUnique({ where: { id } });
  if (!test) {
    throw new ApiError(httpStatus.NOT_FOUND, "Test not found");
  }
  return await prisma.test.update({ where: { id }, data: payload });
};

const deleteTest = async (id: string) => {
  // Delete a test record by id
  const test = await prisma.test.findUnique({ where: { id } });
  if (!test) {
    throw new ApiError(httpStatus.NOT_FOUND, "Test not found");
  }
  return await prisma.test.delete({ where: { id } });
};

export const TestService = {
  getAllTests,
  createTest,
  getSingleTest,
  updateTest,
  deleteTest,
};
