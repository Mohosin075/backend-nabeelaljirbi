import ApiError from "../errors/ApiErrors";
import { Prisma } from "@prisma/client";

export function bookingCurrencyCode(country?: string | null): string {
  return ({ LIBYA: "LYD", TUNISIA: "TND", EGYPT: "EGP", ALGERIA: "DZD" } as Record<string, string>)[country?.trim().toUpperCase() || ""] || "";
}

/** Validate at the boundary; never silently turn invalid input into a zero payout. */
export function money(value: unknown, allowZero = true): number {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) {
    throw new ApiError(400, "A valid monetary amount is required");
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0) || amount > Number.MAX_SAFE_INTEGER / 100) {
    throw new ApiError(400, "Invalid monetary amount");
  }
  const rounded = new Prisma.Decimal(amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  if (!allowZero && rounded === 0) throw new ApiError(400, "Amount must be at least 0.01");
  return rounded;
}

export function percentageAmount(amount: number, percentage: number): number {
  return new Prisma.Decimal(money(amount)).mul(money(percentage)).div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}

export function calculateBookingFees(input: {
  consultFee: number;
  collectionMode: string;
  fixedPatientFee?: number;
  patientPercentage: number;
  clinicPercentage: number;
}) {
  const consultFee = money(input.consultFee);
  if (!["MODE_A", "MODE_B"].includes(input.collectionMode)) throw new ApiError(400, "Invalid collection mode");
  const patientPercentage = money(input.patientPercentage);
  const clinicPercentage = money(input.clinicPercentage);
  if (patientPercentage > 100 || clinicPercentage > 100) throw new ApiError(400, "Fee percentages must be between 0 and 100");
  if (input.collectionMode === "MODE_A" && input.fixedPatientFee === undefined) {
    throw new ApiError(400, "Main Admin must configure the fixed patient fee for this clinic's country before booking");
  }
  const serviceFeeAmount = input.collectionMode === "MODE_A"
    ? money(input.fixedPatientFee)
    : percentageAmount(consultFee, patientPercentage);
  return {
    consultFee,
    collectionMode: input.collectionMode,
    serviceFeePercentage: input.collectionMode === "MODE_B" ? patientPercentage : 0,
    serviceFeeAmount,
    clinicServiceFee: percentageAmount(consultFee, clinicPercentage),
    holdAmount: money(serviceFeeAmount + (input.collectionMode === "MODE_B" ? consultFee : 0)),
  };
}
