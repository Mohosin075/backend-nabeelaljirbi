import type { PrismaClient } from "@prisma/client";
import ApiError from "../../../errors/ApiErrors";
import {
  commonFields,
  roleFields,
  profileAccess,
  normalizedChange,
  storedChange,
  bankDetails,
  pageOptions,
} from "./phaseOne.policy";
import { money } from "../../../utils/money";

export function phaseOneOperations(db: PrismaClient) {
  const account = async (tx: any, id: string) => {
    const user = await tx.user.findUnique({
      where: { id },
      include: { doctor: true, clinic: true },
    });
    if (!user) throw new ApiError(404, "Account not found");
    return user;
  };
  const access = async (id: string) => profileAccess(await account(db, id));
  const requestChange = async (id: string, payload: any) =>
    db.$transaction(
      async (tx) => {
        const user = await account(tx, id);
        if (!roleFields[user.role])
          throw new ApiError(
            403,
            "Only patient, doctor and clinic owners may request profile changes",
          );
        const { fields, values } = profileAccess(user);
        if (
          !payload.changes ||
          typeof payload.changes !== "object" ||
          Array.isArray(payload.changes)
        )
          throw new ApiError(400, "Changes are required");
        const changes: any = {},
          before: any = {};
        for (const [field, value] of Object.entries(payload.changes)) {
          if (!fields.includes(field))
            throw new ApiError(400, `Unsupported profile field: ${field}`);
          const normalized = normalizedChange(field, value);
          if (field === "phoneNumber" && !normalized)
            throw new ApiError(400, "Phone number cannot be empty");
          if (
            JSON.stringify(normalized) !==
            JSON.stringify(storedChange(field, values[field]))
          ) {
            changes[field] = normalized;
            before[field] = storedChange(field, values[field]);
          }
        }
        if (!Object.keys(changes).length)
          throw new ApiError(400, "There are no profile changes to review");
        if (
          await tx.profileChangeRequest.findFirst({
            where: { userId: id, status: "PENDING" },
          })
        )
          throw new ApiError(
            409,
            "A request is already pending. Wait for review before submitting another",
          );
        return tx.profileChangeRequest.create({
          data: {
            userId: id,
            changes: { values: changes, before },
            reason: String(payload.reason || "").slice(0, 2000),
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
  const reviewChange = async (id: string, payload: any, admin: any) =>
    db.$transaction(
      async (tx) => {
        if (
          admin.role !== "ADMIN" ||
          !["SUPER_ADMIN", "OPERATIONS"].includes(admin.adminTier)
        )
          throw new ApiError(403, "Main Admin authorization is required");
        if (!["APPROVED", "REJECTED"].includes(payload.status))
          throw new ApiError(400, "Choose APPROVED or REJECTED");
        const request = await tx.profileChangeRequest.findUnique({
          where: { id },
        });
        if (!request || request.status !== "PENDING")
          throw new ApiError(409, "Request is missing or already reviewed");
        const user = await account(tx, request.userId);
        const stored = request.changes as any;
        if (payload.status === "APPROVED") {
          const access = profileAccess(user),
            userData: any = {},
            entityData: any = {};
          for (const [field, value] of Object.entries(stored.values)) {
            if (!access.fields.includes(field))
              throw new ApiError(
                400,
                "Requested fields no longer match this account's role",
              );
            if (
              JSON.stringify(storedChange(field, access.values[field])) !==
              JSON.stringify(stored.before[field])
            )
              throw new ApiError(
                409,
                `Profile changed since submission (${field}); reject this request and resubmit`,
              );
            (commonFields.includes(field) ? userData : entityData)[field] =
              field === "dateOfBirth" && value
                ? new Date(value as string)
                : value;
          }
          if (Object.keys(userData).length)
            await tx.user.update({ where: { id: user.id }, data: userData });
          if (Object.keys(entityData).length) {
            if (user.role === "DOCTOR")
              await tx.doctor.update({
                where: { userId: user.id },
                data: entityData,
              });
            else if (user.role === "CLINIC")
              await tx.clinic.update({
                where: { userId: user.id },
                data: entityData,
              });
          }
        }
        const result = await tx.profileChangeRequest.update({
          where: { id },
          data: {
            status: payload.status,
            reviewedAt: new Date(),
            reviewedBy: admin.id,
            adminResponse: String(payload.response || "").slice(0, 2000),
          },
        });
        await tx.adminAuditLog.create({
          data: {
            adminId: admin.id,
            adminTier: admin.adminTier,
            action: `PROFILE_CHANGE_${payload.status}`,
            targetType: "USER",
            targetId: user.id,
            details: { requestId: id, changes: stored.values },
          },
        });
        return result;
      },
      { isolationLevel: "Serializable" },
    );
  const listRequests = async (actor: any, query: any) => {
    const { page, limit, skip } = pageOptions(query);
    const isAdmin = actor.role === "ADMIN";
    if (
      isAdmin &&
      !["SUPER_ADMIN", "OPERATIONS", "READ_ONLY"].includes(actor.adminTier)
    )
      throw new ApiError(403, "Profile review access denied");
    const where = {
      ...(isAdmin ? {} : { userId: actor.id }),
      ...(query.status ? { status: String(query.status) } : {}),
    };
    const [data, total] = await Promise.all([
      db.profileChangeRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        include: {
          user: { select: { fullName: true, phoneNumber: true, role: true } },
        },
      }),
      db.profileChangeRequest.count({ where }),
    ]);
    return { data, meta: { page, limit, total } };
  };
  const saveBank = async (id: string, payload: any) => {
    const user = await account(db, id);
    if (!["CLINIC", "DOCTOR"].includes(user.role))
      throw new ApiError(
        403,
        "Payout profiles are for clinic owners and doctors",
      );
    const details = bankDetails(payload);
    await db.user.update({ where: { id }, data: { bankDetails: details } });
    return details;
  };
  const readBank = async (id: string) => {
    const user = await account(db, id);
    if (!["CLINIC", "DOCTOR"].includes(user.role))
      throw new ApiError(403, "Payout profile access denied");
    return {
      bankDetails: user.bankDetails,
      remoteConsultationsEnabled: user.remoteConsultationsEnabled,
    };
  };
  const countryFees = async (records: any, admin: any) =>
    db.$transaction(async (tx) => {
      if (
        admin.role !== "ADMIN" ||
        !["SUPER_ADMIN", "FINANCE"].includes(admin.adminTier)
      )
        throw new ApiError(403, "Finance authorization required");
      if (!Array.isArray(records) || records.length > 4)
        throw new ApiError(400, "Supply country fee records");
      const results = [];
      for (const item of records) {
        if (!["LIBYA", "TUNISIA", "EGYPT", "ALGERIA"].includes(item.country))
          throw new ApiError(400, "Unsupported country");
        const amount = money(item.amount),
          modelBPercentage = money(item.modelBPercentage),
          clinicFeePercentage = money(item.clinicFeePercentage);
        if (modelBPercentage > 100 || clinicFeePercentage > 100)
          throw new ApiError(400, "Percentages must be 0–100");
        results.push(
          await tx.patientServiceFee.upsert({
            where: { country: item.country },
            update: { amount, modelBPercentage, clinicFeePercentage },
            create: {
              country: item.country,
              amount,
              modelBPercentage,
              clinicFeePercentage,
            },
          }),
        );
      }
      await tx.adminAuditLog.create({
        data: {
          adminId: admin.id,
          adminTier: admin.adminTier,
          action: "COUNTRY_FEE_RULES_UPDATED",
          targetType: "SETTINGS",
          details: { records },
        },
      });
      return results;
    });
  return {
    access,
    requestChange,
    reviewChange,
    listRequests,
    saveBank,
    readBank,
    countryFees,
  };
}
