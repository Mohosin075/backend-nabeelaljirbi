
import { Country, PatientServiceFee } from "@prisma/client";
import prisma from "../../../shared/prisma";
import { createAuditLog } from "../../utils/auditLogger";

const createPatientServiceFee = async (
  payload: Record<string, string | number>,
  currentAdmin?: any
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

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "PATIENT_SERVICE_FEE_UPDATED",
    targetType: "PATIENT_SERVICE_FEE",
    details: payload,
  });

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
