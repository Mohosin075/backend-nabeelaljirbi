import ApiError from "../../../errors/ApiErrors";
import { bookingFilters } from "./phaseOne.policy";

export function historyDateRange(query: any) {
  return bookingFilters({ startDate: query.startDate, endDate: query.endDate })
    .consultDate;
}
export function payoutFilters(query: any): any {
  const where: any = {},
    dates = historyDateRange(query);
  if (dates) where.createdAt = dates;
  const status = String(query.status || "ALL").toUpperCase();
  if (status !== "ALL") {
    const normalized = status === "PAID" ? "COMPLETED" : status;
    if (
      ![
        "PENDING",
        "UNDER_REVIEW",
        "APPROVED",
        "REJECTED",
        "COMPLETED",
      ].includes(normalized)
    )
      throw new ApiError(400, "Invalid payout status");
    where.status = normalized;
  }
  for (const [key, allowed] of [
    ["partyType", ["CLINIC", "DOCTOR"]],
    ["payoutMethod", ["BANK", "CASH"]],
  ] as const) {
    if (query[key] && query[key] !== "ALL") {
      if (!(allowed as readonly string[]).includes(query[key]))
        throw new ApiError(400, `Invalid ${key}`);
      where[key] = query[key];
    }
  }
  for (const key of ["clinicId", "doctorId"])
    if (query[key] && query[key] !== "ALL") where[key] = String(query[key]);
  const search = String(query.searchTerm || "").trim();
  if (search)
    where.OR = [
      { settlementNumber: { contains: search, mode: "insensitive" } },
      { reference: { contains: search, mode: "insensitive" } },
      { clinic: { clinicName: { contains: search, mode: "insensitive" } } },
      { clinic: { contactPhone: { contains: search } } },
      { clinic: { user: { phoneNumber: { contains: search } } } },
      {
        clinic: {
          user: { fullName: { contains: search, mode: "insensitive" } },
        },
      },
      { doctor: { user: { phoneNumber: { contains: search } } } },
      {
        doctor: {
          user: { fullName: { contains: search, mode: "insensitive" } },
        },
      },
    ];
  return where;
}
