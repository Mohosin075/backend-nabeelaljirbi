import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import ApiError from "../../../errors/ApiErrors";
import { money } from "../../../utils/money";
import { bankDetails } from "../PhaseOne/phaseOne.policy";

const openStatuses = ["PENDING", "UNDER_REVIEW", "APPROVED"];
const allowedTransitions: Record<string, string[]> = {
  PENDING: ["UNDER_REVIEW", "APPROVED", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["COMPLETED", "REJECTED"],
  COMPLETED: [],
  REJECTED: [],
};

/** No schema changes: existing settlement/TopUp IDs provide an idempotent journal link. */
export function settlementOperations(db: PrismaClient) {
  const transaction = async <T>(operation: (tx: any) => Promise<T>): Promise<T> => {
    try {
      return await db.$transaction(operation, { isolationLevel: "Serializable" });
    } catch (error: any) {
      if (error?.code === "P2034" || error?.code === "P2002") {
        throw new ApiError(409, "Settlement changed concurrently. Refresh before retrying.");
      }
      throw error;
    }
  };

  const create = async (payload: any, actor: any) => {
    // Client requirement reaffirmed by the user: doctors may REQUEST withdrawal
    // only when remote consultations are enabled. The DB flag defaults false;
    // this does not enable any doctor or perform an outgoing payment.
    if (!actor || !["ADMIN", "CLINIC", "DOCTOR"].includes(actor.role)) {
      throw new ApiError(403, "Settlement requests are available to clinics; doctor payouts require remote consultations");
    }
    const amount = money(payload.amount, false);
    if (actor.role === "ADMIN" && !["SUPER_ADMIN", "FINANCE"].includes(actor.adminTier)) throw new ApiError(403, "Finance authorization required");
    return transaction(async tx => {
      let clinicId = payload.clinicId || null;
      let doctorId = payload.doctorId || null;
      if (actor.role !== "ADMIN") {
        if (actor.role === "DOCTOR") {
          const doctor = await tx.doctor.findUnique({ where: { userId: actor.id }, include: { user: true } });
          if (!doctor?.adminVerified || !doctor.user.remoteConsultationsEnabled) throw new ApiError(403, "Doctor withdrawal requests require approval and enabled remote consultations");
          doctorId = doctor.id; clinicId = null;
        } else {
          const clinic = await tx.clinic.findUnique({ where: { userId: actor.id } });
          if (!clinic) throw new ApiError(404, "Clinic profile not found");
          clinicId = clinic.id; doctorId = null;
        }
      }
      if (Boolean(clinicId) === Boolean(doctorId)) throw new ApiError(400, "Select exactly one clinic or doctor");
      const party = clinicId
        ? await tx.clinic.findUnique({ where: { id: clinicId }, include: { user: true } })
        : await tx.doctor.findUnique({ where: { id: doctorId }, include: { user: true } });
      if (!party?.user || party.user.banned || party.user.status !== "ACTIVE") throw new ApiError(400, "Settlement recipient is not active");
      const pending = await tx.settlement.aggregate({
        where: { ...(clinicId ? { clinicId } : { doctorId }), status: { in: openStatuses } },
        _sum: { amount: true },
      });
      const available = money(Math.max(0, party.user.wallet - party.user.frozenWallet - (pending._sum.amount || 0)));
      if (amount > available) throw new ApiError(400, `Requested amount exceeds available balance (${available.toFixed(2)})`);
      const payoutMethod = payload.payoutMethod || "BANK";
      if (!["BANK", "CASH"].includes(payoutMethod)) throw new ApiError(400, "Choose BANK or CASH payout");
      // Tested bank validation; immutable copy ensures a later profile edit does
      // not change an already submitted request's destination.
      const snapshot = payoutMethod === "BANK" ? bankDetails(party.user.bankDetails) : null;
      const result = await tx.settlement.create({
        data: {
          settlementNumber: `SET-${randomUUID()}`,
          partyType: clinicId ? "CLINIC" : "DOCTOR",
          clinicId, doctorId, amount, status: "PENDING", notes: payload.notes || null,
          payoutMethod, ...(snapshot ? { bankDetails: snapshot } : {}),
          payoutCountry: party.user.country?.trim().toUpperCase() || null,
        },
        include: { clinic: true, doctor: true },
      });
      if (actor.role === "ADMIN") await tx.adminAuditLog.create({ data: {
        adminId: actor.id, adminTier: actor.adminTier || "SUPER_ADMIN", action: "DIRECT_SETTLEMENT_CREATED",
        targetType: "SETTLEMENT", targetId: result.id, details: { clinicId, doctorId, amount },
      } });
      return result;
    });
  };

  const update = async (id: string, payload: any, actor: any) => {
    if (actor?.role !== "ADMIN" || !["SUPER_ADMIN", "FINANCE"].includes(actor.adminTier)) throw new ApiError(403, "Only Main Admin finance can process settlements");
    const status = payload.status === "PAID" ? "COMPLETED" : payload.status;
    if (typeof status !== "string" || !Object.prototype.hasOwnProperty.call(allowedTransitions, status)) throw new ApiError(400, "Invalid settlement status");
    return transaction(async tx => {
      const settlement = await tx.settlement.findUnique({ where: { id }, include: { clinic: true, doctor: true } });
      if (!settlement) throw new ApiError(404, "Settlement not found");
      if (status !== settlement.status && !allowedTransitions[settlement.status]?.includes(status)) {
        throw new ApiError(400, `Cannot change settlement from ${settlement.status} to ${status}`);
      }
      const receiptUrl = payload.receiptUrl !== undefined ? payload.receiptUrl : settlement.receiptUrl;
      const reference = payload.reference !== undefined ? payload.reference : settlement.reference;
      if ((receiptUrl != null && typeof receiptUrl !== "string") || (reference != null && typeof reference !== "string")) {
        throw new ApiError(400, "Receipt and reference must be text");
      }
      if (status === "COMPLETED" && (!receiptUrl?.trim() || !reference?.trim())) {
        throw new ApiError(400, "Payment reference and receipt are required before marking a settlement paid");
      }
      if (receiptUrl) {
        try {
          const url = new URL(receiptUrl);
          if (!["http:", "https:"].includes(url.protocol)) throw new Error();
        } catch { throw new ApiError(400, "Receipt must be an HTTP(S) URL"); }
      }
      const firstPayment = status === "COMPLETED" && settlement.status !== "COMPLETED";
      const targetUserId = settlement.clinic?.userId || settlement.doctor?.userId;
      if (!targetUserId) throw new ApiError(400, "Settlement recipient no longer exists");
      const claimed = await tx.settlement.updateMany({
        where: { id, status: settlement.status },
        data: {
          status, receiptUrl, reference,
          notes: payload.notes !== undefined ? payload.notes : settlement.notes,
          processedByAdminId: actor.id,
          ...(status === "APPROVED" && !settlement.processedAt ? { processedAt: new Date() } : {}),
          ...(firstPayment ? { completedAt: new Date(), processedAt: settlement.processedAt || new Date() } : {}),
        },
      });
      if (claimed.count !== 1) throw new ApiError(409, "Settlement has already been processed");
      if (firstPayment) {
        const owner = await tx.user.findUnique({ where: { id: targetUserId } });
        const amount = money(settlement.amount, false);
        if (Math.abs(settlement.amount - amount) > 1e-8) {
          throw new ApiError(400, "Historical settlement has more than two decimal places. Reject and recreate the request with a reviewed amount; its recorded amount must not be silently changed.");
        }
        const reserved = await tx.settlement.aggregate({
          where: { id: { not: id }, ...(settlement.clinicId ? { clinicId: settlement.clinicId } : { doctorId: settlement.doctorId }), status: { in: openStatuses } },
          _sum: { amount: true },
        });
        const required = money(amount + money(owner?.frozenWallet || 0) + money(reserved._sum.amount || 0));
        const deducted = await tx.user.updateMany({
          where: { id: targetUserId, wallet: { gte: required }, status: "ACTIVE", banned: false },
          data: { wallet: { decrement: amount } },
        });
        if (deducted.count !== 1) throw new ApiError(400, "Insufficient available balance for settlement");
        await tx.topUp.create({ data: { id: `settlement:${id}:debit`, userId: targetUserId, amount, type: "WITHDRAW" } });
      }
      await tx.adminAuditLog.create({ data: {
        adminId: actor.id, adminName: actor.fullName || actor.phoneNumber || "Admin", adminTier: actor.adminTier || "SUPER_ADMIN",
        action: `SETTLEMENT_${status}`, targetType: "SETTLEMENT", targetId: id,
        details: { oldStatus: settlement.status, newStatus: status, amount: settlement.amount, receiptUrl, reference },
      } });
      return tx.settlement.findUniqueOrThrow({ where: { id }, include: { clinic: true, doctor: true, processedBy: { select: { id: true, fullName: true } } } });
    });
  };
  return { create, update };
}
