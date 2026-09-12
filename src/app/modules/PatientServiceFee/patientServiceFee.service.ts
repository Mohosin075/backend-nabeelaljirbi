
import { Country, PatientServiceFee } from "@prisma/client";
import prisma from "../../../shared/prisma";

const createPatientServiceFee = async (
  payload: Record<string, string | number>
): Promise<PatientServiceFee[]> => {
  const entries = Object.entries(payload);

  const results = await Promise.all(
    entries.map(([country, amount]) => {
      // Normalize country name to match enum (e.g., "Libya" -> "LIBYA")
      const countryEnum = country.toUpperCase() as Country;

      return prisma.patientServiceFee.upsert({
        where: {
          country: countryEnum,
        },
        update: {
          amount: Number(amount),
        },
        create: {
          country: countryEnum,
          amount: Number(amount),
        },
      });
    })
  );
  return results;
};

const getPatientServiceFees = async (): Promise<PatientServiceFee[]> => {
  const result = await prisma.patientServiceFee.findMany();
  return result;
};

export const PatientServiceFeeService = {
  createPatientServiceFee,
  getPatientServiceFees,
};
