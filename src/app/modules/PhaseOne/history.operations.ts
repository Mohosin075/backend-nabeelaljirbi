import { Prisma, type PrismaClient } from "@prisma/client";
import ApiError from "../../../errors/ApiErrors";
import { bookingFilters, pageOptions } from "./phaseOne.policy";
import { requireAdmin } from "./phaseOne.access";
import { bookingScope } from "./phaseOne.access";

export function historyOperations(db: PrismaClient) {
  const complaints = async (actor: any, query: any) => {
    const { page, limit, skip } = pageOptions(query);
    const where = {
      complainantId: actor.id,
      ...(query.status && query.status !== "ALL"
        ? { status: String(query.status) }
        : {}),
    };
    const [data, total] = await Promise.all([
      db.complaint.findMany({
        where,
        take: limit,
        skip,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          complaintNumber: true,
          subject: true,
          description: true,
          bookingId: true,
          status: true,
          resolution: true,
          resolvedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db.complaint.count({ where }),
    ]);
    return { data, meta: { page, limit, total } };
  };
  const wallet = async (actor: any, query: any) => {
    if (actor.role === "MANAGER")
      throw new ApiError(
        403,
        "Receptionists cannot access financial histories",
      );
    const { page, limit, skip } = pageOptions(query);
    const date = bookingFilters({
      startDate: query.startDate,
      endDate: query.endDate,
    }).consultDate;
    const where: any = {
      userId: actor.id,
      ...(date ? { createdAt: date } : {}),
    };
    if (query.type && query.type !== "ALL") {
      if (
        ![
          "RECHARGE",
          "WITHDRAW",
          "REFUND",
          "BOOKING",
          "REFERALL",
          "CANCEL",
          "PENALTY",
        ].includes(query.type)
      )
        throw new ApiError(400, "Invalid wallet history type");
      where.type = query.type;
    }
    const [rows, total] = await Promise.all([
      db.topUp.findMany({
        where,
        take: limit,
        skip,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      db.topUp.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        ...row,
        direction:
          row.id.endsWith(":debit") ||
          row.type === "WITHDRAW" ||
          row.type === "PENALTY"
            ? "DEBIT"
            : row.id.endsWith(":credit") ||
                row.type === "RECHARGE" ||
                row.type === "REFERALL"
              ? "CREDIT"
              : "HISTORICAL_UNSPECIFIED",
      })),
      meta: { page, limit, total },
    };
  };
  const monitoring = async (actor: any, query: any) => {
    requireAdmin(actor, ["SUPER_ADMIN", "FINANCE", "READ_ONLY"]);
    const where = bookingFilters({
      startDate: query.startDate,
      endDate: query.endDate,
    });
    const from = where.consultDate?.gte || null,
      to = where.consultDate?.lte || null;
    const [groups, wallets, withdrawals, walletCountries, capturedFees] =
      await Promise.all([
        db.bookingAppointment.groupBy({
          by: ["feeCountry", "collectionMode", "status"],
          where,
          _count: { id: true },
          _sum: {
            consultFee: true,
            serviceFeeAmount: true,
            clinicServiceFee: true,
          },
        }),
        db.user.aggregate({ _sum: { wallet: true, frozenWallet: true } }),
        db.settlement.groupBy({
          by: ["status", "payoutCountry"],
          _sum: { amount: true },
          _count: { id: true },
        }),
        db.user.groupBy({
          by: ["country"],
          _sum: { wallet: true, frozenWallet: true },
        }),
        db.$queryRaw<
          Array<{
            country: string;
            model: string;
            patientFee: number;
            clinicFee: number;
            total: number;
          }>
        >(Prisma.sql`
        SELECT COALESCE(b."feeCountry", 'HISTORICAL_UNSPECIFIED') AS country,
               b."collectionMode" AS model,
               SUM(t."patientServiceFee")::double precision AS "patientFee",
               SUM(t."clinicServiceFee")::double precision AS "clinicFee",
               SUM(t."totalAmount")::double precision AS total
        FROM admin_transactions t JOIN booking_appointments b ON b.id = t."appointmentId"
        WHERE (${from}::timestamp IS NULL OR b."consultDate" >= ${from}::timestamp)
          AND (${to}::timestamp IS NULL OR b."consultDate" <= ${to}::timestamp)
        GROUP BY b."feeCountry", b."collectionMode"
        ORDER BY country, model
      `),
      ]);
    return {
      capturedFeesByCountry: capturedFees,
      completedSalesByCountry: groups
        .filter((row) => row.status === "COMPLETE")
        .map((row) => ({
          country: row.feeCountry || "HISTORICAL_UNSPECIFIED",
          model: row.collectionMode,
          count: row._count.id,
          gross: row._sum.consultFee || 0,
        })),
      walletsByCountry: walletCountries.map((g) => ({
        country: g.country,
        wallet: g._sum.wallet || 0,
        frozenWallet: g._sum.frozenWallet || 0,
      })),
      bookingGroups: groups.map((row) => ({
        country: row.feeCountry || "HISTORICAL_UNSPECIFIED",
        model: row.collectionMode,
        status: row.status,
        count: row._count.id,
        consultationFaceValue: row._sum.consultFee || 0,
        patientFeeSnapshot: row._sum.serviceFeeAmount || 0,
        clinicFeeSnapshot: row._sum.clinicServiceFee || 0,
      })),
      totalWalletBalance: wallets._sum.wallet || 0,
      totalFrozenBalance: wallets._sum.frozenWallet || 0,
      withdrawals: withdrawals.map((row) => ({
        country: row.payoutCountry || "HISTORICAL_UNSPECIFIED",
        status: row.status,
        amount: row._sum.amount || 0,
        count: row._count.id,
      })),
      notes:
        "Booking groups are fee snapshots by current status, not a second ledger. Wallet and withdrawal totals are all-time. Historical country is unspecified rather than inferred. Cash consultation face value is not platform revenue.",
    };
  };
  const overview = async (actor: any) => {
    if (!["DOCTOR", "CLINIC", "MANAGER"].includes(actor.role))
      throw new ApiError(403, "Role dashboard access denied");
    const scope = await bookingScope(db, actor);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const [counts, todayCount, upcoming, user] = await Promise.all([
      db.bookingAppointment.groupBy({
        by: ["status"],
        where: scope,
        _count: { id: true },
      }),
      db.bookingAppointment.count({
        where: { ...scope, consultDate: { gte: today, lt: tomorrow } },
      }),
      db.bookingAppointment.findMany({
        where: {
          ...scope,
          consultDate: { gte: today },
          status: { in: ["PENDING", "CONFIRMED", "ARRIVED", "INPROGRESS"] },
        },
        take: 10,
        orderBy: [{ consultDate: "asc" }, { serialNumber: "asc" }],
        select: {
          id: true,
          consultDate: true,
          startTime: true,
          serialNumber: true,
          status: true,
          clinic: { select: { clinicName: true } },
          patient: { select: { user: { select: { fullName: true } } } },
        },
      }),
      actor.role === "MANAGER"
        ? null
        : db.user.findUnique({
            where: { id: actor.id },
            select: { wallet: true, frozenWallet: true },
          }),
    ]);
    return {
      statusCounts: Object.fromEntries(
        counts.map((c) => [c.status, c._count.id]),
      ),
      todayCount,
      upcoming,
      ...(user ? { wallet: user.wallet, frozenWallet: user.frozenWallet } : {}),
    };
  };
  return { complaints, wallet, monitoring, overview };
}
