
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import { OTPSystem } from "@prisma/client";

const createOTPSystem = async (data: OTPSystem): Promise<OTPSystem> => {

  const existingOTPSystem = await prisma.oTPSystem.findFirst();

  if (existingOTPSystem) {
    const result = await prisma.oTPSystem.update({
      where: {
        id: existingOTPSystem.id,
      },
      data,
    });
    return result;
  }

  const result = await prisma.oTPSystem.create({
    data,
  });
  return result;
};

const getOTPSystems = async (): Promise<OTPSystem[]> => {
  const result = await prisma.oTPSystem.findMany();
  return result;
};

const getOTPSystemById = async (id: string): Promise<OTPSystem | null> => {
  const result = await prisma.oTPSystem.findUnique({
    where: {
      id,
    },
  });
  return result;
};

const updateOTPSystem = async (
  id: string,
  payload: Partial<OTPSystem>
): Promise<OTPSystem> => {
  const result = await prisma.oTPSystem.update({
    where: {
      id,
    },
    data: payload,
  });
  return result;
};

const deleteOTPSystem = async (id: string): Promise<OTPSystem> => {
  const result = await prisma.oTPSystem.delete({
    where: {
      id,
    },
  });
  return result;
};

export const OTPSystemService = {
  createOTPSystem,
  getOTPSystems,
  getOTPSystemById,
  updateOTPSystem,
  deleteOTPSystem,
};
