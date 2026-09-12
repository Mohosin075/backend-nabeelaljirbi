import { UserRole, UserStatus } from "@prisma/client";
import httpStatus from "http-status";
import { Secret } from "jsonwebtoken";
import config from "../../../config";
import { otpEmail } from "../../../emails/otpEmail";
import ApiError from "../../../errors/ApiErrors";
import emailSender from "../../../helpars/emailSender/emailSender";
import stripe from "../../../helpars/stripe/stripe";
import { IPaginationOptions } from "../../../interfaces/paginations";
import prisma from "../../../shared/prisma";
import { jwtHelpers } from "../../../utils/jwtHelpers";
import { paginationHelpers } from "../../../utils/paginationHelper";
import { TSocialUser, TUser } from "./user.interface";

const createUser = async (payload: TUser) => {
  const isUser = await prisma.user.findUnique({
    where: {
      phoneNumber: payload.phoneNumber,
    },
  });

  if (isUser) {
    throw new ApiError(httpStatus.BAD_REQUEST, "User already exists");
  }

  const customer = await stripe.customers.create({
    metadata: { phoneNumber: payload.phoneNumber },
  });

  if (!customer.id) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Failed to create customer"
    );
  }

  const user = await prisma.user.create({
    data: {
      phoneNumber: payload.phoneNumber,
      fullName: payload.fullName,
      role: UserRole.PATIENT,
    },
  });

  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    role: user.role,
  };
};

const createSocialUser = async (payload: TSocialUser) => {
  const isUser = await prisma.user.findUnique({
    where: { phoneNumber: payload.phoneNumber },
  });

  if (isUser) {
    if (isUser.status === UserStatus.DELETED) {
      throw new ApiError(403, "Your account is deleted");
    }

    const accessToken = jwtHelpers.generateToken(
      {
        id: isUser.id,
        phoneNumber: isUser.phoneNumber,
        role: isUser.role,
      },
      config.jwt.jwt_secret as string,
      config.jwt.expires_in as string
    );

    const refreshToken = jwtHelpers.generateToken(
      {
        id: isUser.id,
        phoneNumber: isUser.phoneNumber,
        role: isUser.role,
      },
      config.jwt.refresh_token_secret as string,
      config.jwt.refresh_token_expires_in as string
    );

    await prisma.user.update({
      where: { id: isUser.id },
      data: {
        accessToken: accessToken,
        refreshToken: refreshToken,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: isUser.id,
        fullName: isUser.fullName,
        role: isUser.role,
        phoneNumber: isUser.phoneNumber,
        dateOfBirth: isUser.dateOfBirth,
        address: isUser.address,
      },
    };
  }

  const customer = await stripe.customers.create({
    metadata: { phoneNumber: payload.phoneNumber },
  });

  if (!customer.id) {
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Failed to create customer"
    );
  }

  const user = await prisma.user.create({
    data: {
      phoneNumber: payload.phoneNumber,
      fullName: payload.name,
      role: UserRole.PATIENT,
    },
  });

  const accessToken = jwtHelpers.generateToken(
    {
      id: user.id,
      phoneNumber: user.phoneNumber,
      role: user.role,
    },
    config.jwt.jwt_secret as string,
    config.jwt.expires_in as string
  );

  const refreshToken = jwtHelpers.generateToken(
    {
      id: user.id,
      phoneNumber: user.phoneNumber,
      role: user.role,
    },
    config.jwt.refresh_token_secret as string,
    config.jwt.refresh_token_expires_in as string
  );

  await prisma.user.update({
    where: { id: user.id },
    data: {
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      fullName: user.fullName,
      role: user.role,
      phoneNumber: user.phoneNumber,
      dateOfBirth: user.dateOfBirth,
      address: user.address,
    },
  };
};

const updateUser = async (payload: Partial<TUser>, userId: string) => {
  if (!userId) {
    throw new ApiError(httpStatus.BAD_REQUEST, "User ID is required");
  }

  const updateUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ...payload,
    },
  });

  if (!updateUser) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  return {
    id: updateUser.id,
    fullName: updateUser.fullName,
    role: updateUser.role,
    phoneNumber: updateUser.phoneNumber,
    dateOfBirth: updateUser.dateOfBirth,
    address: updateUser.address,
  };
};

const allUsers = async (
  filters: {
    searchTerm?: string;
  },
  options: IPaginationOptions
) => {
  const { limit, page, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);
  const { searchTerm } = filters;

  const andConditions: any[] = [];

  if (searchTerm) {
    andConditions.push({
      OR: [
        { fullName: { contains: searchTerm, mode: "insensitive" } },
        { phoneNumber: { contains: searchTerm, mode: "insensitive" } },
      ],
    });
  }

  const whereConditions =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const users = await prisma.user.findMany({
    where: {
      ...whereConditions,
      role: UserRole.PATIENT, // assuming admin views patients
      status: { not: UserStatus.DELETED },
    },
    select: {
      id: true,
      fullName: true,
      role: true,
      phoneNumber: true,
      dateOfBirth: true,
      address: true,
      createdAt: true,
      updatedAt: true,
      status: true,
    },
    skip,
    take: limit,
    orderBy:
      sortBy && sortOrder
        ? { [sortBy]: sortOrder }
        : {
            createdAt: "desc",
          },
  });

  const total = await prisma.user.count({
    where: {
      ...whereConditions,
      role: UserRole.PATIENT,
    },
  });

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: users,
  };
};

const updateStatus = async (userId: string, status: UserStatus) => {
  if (!userId) {
    throw new ApiError(httpStatus.BAD_REQUEST, "User ID is required");
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { status },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  return {
    id: user.id,
    fullName: user.fullName,
    phoneNumber: user.phoneNumber,
    role: user.role,
    status: user.status,
  };
};

export const UserService = {
  createUser,
  createSocialUser,
  updateUser,
  allUsers,
  updateStatus,
};
