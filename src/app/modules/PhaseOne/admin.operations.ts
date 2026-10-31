import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import ApiError from "../../../errors/ApiErrors";
import { requireAdmin, bookingScope } from "./phaseOne.access";
import { normalizedChange } from "./phaseOne.policy";

export function adminOperations(db: PrismaClient) {
  const controls = async (actor: any, id: string, payload: any) => {
    requireAdmin(actor, ["SUPER_ADMIN"]);
    const user = await db.user.findUnique({ where: { id } });
    if (!user) throw new ApiError(404, "Account not found");
    const data: any = {};
    if (payload.remoteConsultationsEnabled !== undefined) {
      if (
        user.role !== "DOCTOR" ||
        typeof payload.remoteConsultationsEnabled !== "boolean"
      )
        throw new ApiError(400, "Doctor eligibility must be a boolean");
      data.remoteConsultationsEnabled = payload.remoteConsultationsEnabled;
    }
    if (payload.profileApproved !== undefined) {
      if (
        user.role !== "PATIENT" ||
        typeof payload.profileApproved !== "boolean"
      )
        throw new ApiError(400, "Patient approval must be a boolean");
      data.profileApproved = payload.profileApproved;
    }
    if (!Object.keys(data).length)
      throw new ApiError(400, "No valid controls supplied");
    return db.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id },
        data,
        select: {
          id: true,
          remoteConsultationsEnabled: true,
          profileApproved: true,
        },
      });
      await tx.adminAuditLog.create({
        data: {
          adminId: actor.id,
          adminTier: actor.adminTier,
          action: "ACCOUNT_ELIGIBILITY_UPDATED",
          targetType: "USER",
          targetId: id,
          details: {
            before: {
              remoteConsultationsEnabled: user.remoteConsultationsEnabled,
              profileApproved: user.profileApproved,
            },
            after: data,
          },
        },
      });
      return result;
    });
  };
  const clinicPhone = async (actor: any, payload: any) => {
    requireAdmin(actor);
    if (typeof payload.clinicId !== "string" || !payload.clinicId.trim())
      throw new ApiError(400, "Select a clinic");
    const phoneNumber = normalizedChange("phoneNumber", payload.phoneNumber);
    if (
      !phoneNumber ||
      !["login", "contact", "manager"].includes(payload.field)
    )
      throw new ApiError(
        400,
        "Select a phone field and enter a valid phone number",
      );
    return db.$transaction(async (tx) => {
      const clinic = await tx.clinic.findFirst({
        where: { OR: [{ id: payload.clinicId }, { userId: payload.clinicId }] },
        include: { user: true },
      });
      if (!clinic) throw new ApiError(404, "Clinic not found");
      const oldPhone =
        payload.field === "login"
          ? clinic.user.phoneNumber
          : payload.field === "contact"
            ? clinic.contactPhone
            : clinic.managerPhone;
      if (payload.field === "login")
        await tx.user.update({
          where: { id: clinic.userId },
          data: { phoneNumber },
        });
      else
        await tx.clinic.update({
          where: { id: clinic.id },
          data: {
            [payload.field === "contact" ? "contactPhone" : "managerPhone"]:
              phoneNumber,
          },
        });
      await tx.adminAuditLog.create({
        data: {
          adminId: actor.id,
          adminTier: actor.adminTier,
          action: "CLINIC_PHONE_UPDATED",
          targetType: "CLINIC",
          targetId: clinic.id,
          details: {
            field: payload.field,
            before: oldPhone,
            after: phoneNumber,
          },
        },
      });
      return { clinicId: clinic.id, field: payload.field, phoneNumber };
    });
  };
  const clinicForStaff = async (actor: any, clinicId?: string) => {
    if (actor.role === "ADMIN") {
      requireAdmin(actor);
      if (!clinicId) throw new ApiError(400, "Select a clinic");
      return clinicId;
    }
    if (actor.role !== "CLINIC")
      throw new ApiError(403, "Only clinic owners manage receptionists");
    return ((await bookingScope(db, actor)) as any).clinicId;
  };
  const listStaff = async (actor: any, clinicId?: string) =>
    db.manager.findMany({
      where: { clinicId: await clinicForStaff(actor, clinicId) },
      select: {
        id: true,
        user: {
          select: {
            id: true,
            fullName: true,
            phoneNumber: true,
            email: true,
            status: true,
          },
        },
      },
    });
  const createStaff = async (actor: any, payload: any) => {
    const clinicId = await clinicForStaff(actor, payload.clinicId);
    const phoneNumber = normalizedChange("phoneNumber", payload.phoneNumber);
    if (
      !phoneNumber ||
      !String(payload.fullName || "").trim() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email || "") ||
      typeof payload.password !== "string" ||
      payload.password.length < 8
    )
      throw new ApiError(
        400,
        "Name, phone, email and an 8-character password are required",
      );
    const email = payload.email.trim().toLowerCase(),
      password = await bcrypt.hash(payload.password, 12);
    return db.$transaction(
      async (tx) => {
        if (!(await tx.clinic.findUnique({ where: { id: clinicId } })))
          throw new ApiError(404, "Clinic not found");
        if (
          await tx.user.findFirst({
            where: {
              OR: [
                { email: { equals: email, mode: "insensitive" } },
                { phoneNumber },
              ],
            },
          })
        )
          throw new ApiError(409, "Phone or email is already registered");
        const user = await tx.user.create({
          data: {
            fullName: payload.fullName.trim(),
            phoneNumber,
            email,
            password,
            role: "MANAGER",
            profileCompleted: true,
            manager: { create: { clinicId } },
          },
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
            role: true,
          },
        });
        await tx.adminAuditLog.create({
          data: {
            adminId: actor.id,
            adminTier: actor.role === "ADMIN" ? actor.adminTier : null,
            action: "RECEPTIONIST_CREATED",
            targetType: "USER",
            targetId: user.id,
            details: { clinicId },
          },
        });
        return user;
      },
      { isolationLevel: "Serializable" },
    );
  };
  const staffStatus = async (actor: any, id: string, payload: any) => {
    const clinicId = await clinicForStaff(actor, payload.clinicId);
    if (!["ACTIVE", "SUSPENDED"].includes(payload.status))
      throw new ApiError(400, "Select ACTIVE or SUSPENDED");
    return db.$transaction(async (tx) => {
      const manager = await tx.manager.findFirst({
        where: { userId: id, clinicId },
        include: { user: true },
      });
      if (!manager || manager.user.role !== "MANAGER")
        throw new ApiError(403, "Receptionist does not belong to this clinic");
      const user = await tx.user.update({
        where: { id },
        data: { status: payload.status },
        select: { id: true, status: true },
      });
      await tx.adminAuditLog.create({
        data: {
          adminId: actor.id,
          adminTier: actor.role === "ADMIN" ? actor.adminTier : null,
          action: "RECEPTIONIST_STATUS_CHANGED",
          targetType: "USER",
          targetId: id,
          details: { status: payload.status, clinicId },
        },
      });
      return user;
    });
  };
  return { controls, clinicPhone, listStaff, createStaff, staffStatus };
}
