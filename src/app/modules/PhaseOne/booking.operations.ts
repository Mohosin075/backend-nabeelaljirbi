import type { PrismaClient } from "@prisma/client";
import ApiError from "../../../errors/ApiErrors";
import { bookingFilters, pageOptions } from "./phaseOne.policy";
import { bookingScope, requireAdmin } from "./phaseOne.access";

export function bookingOperations(
  db: PrismaClient,
  lifecycle: { transition: Function; cancel: Function },
) {
  const list = async (actor: any, query: any) => {
    const { page, limit, skip } = pageOptions(query);
    const sort =
      (
        {
          requests: "createdAt",
          date: "consultDate",
          newest: "createdAt",
          serial: "serialNumber",
        } as any
      )[query.sort] || "createdAt";
    const direction =
      query.sort === "serial" || query.sort === "date" ? "asc" : "desc";
    const where = {
      AND: [await bookingScope(db, actor), bookingFilters(query)],
    };
    const [rows, total] = await Promise.all([
      db.bookingAppointment.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ [sort]: direction }, { id: "asc" }],
        include: {
          patient: {
            select: { user: { select: { fullName: true, phoneNumber: true } } },
          },
          doctor: { select: { user: { select: { fullName: true } } } },
          clinic: { select: { clinicName: true, timezone: true } },
        },
      }),
      db.bookingAppointment.count({ where }),
    ]);
    return {
      data: rows.map((row) => ({
        ...row,
        displayStatus:
          row.absenceType === "DOCTOR_ABSENT"
            ? "DOCTOR_ABSENT"
            : row.status === "NOT_SHOW"
              ? "PATIENT_NO_SHOW"
              : row.status,
      })),
      meta: { page, limit, total },
    };
  };
  const bulk = async (actor: any, payload: any) => {
    if (!["ADMIN", "CLINIC", "MANAGER"].includes(actor.role))
      throw new ApiError(
        403,
        "Only authorized clinic booking staff can run bulk actions",
      );
    if (actor.role === "ADMIN") requireAdmin(actor);
    if (!Array.isArray(payload.ids))
      throw new ApiError(400, "Manually select bookings");
    const ids: string[] = [...new Set<string>(payload.ids)];
    if (
      !ids.length ||
      ids.length > 100 ||
      ids.some((id) => typeof id !== "string" || !id)
    )
      throw new ApiError(400, "Select 1–100 bookings per action");
    const action = payload.action;
    if (
      ![
        "CONFIRMED",
        "ARRIVED",
        "COMPLETE",
        "CANCELLED",
        "DOCTOR_ABSENT",
        "PATIENT_NO_SHOW",
      ].includes(action)
    )
      throw new ApiError(400, "Invalid bulk action");
    if (
      ["DOCTOR_ABSENT", "PATIENT_NO_SHOW", "CANCELLED"].includes(action) &&
      !String(payload.reason || "").trim()
    )
      throw new ApiError(400, "Enter a reason for this action");
    const count = await db.bookingAppointment.count({
      where: { AND: [await bookingScope(db, actor), { id: { in: ids } }] },
    });
    if (count !== ids.length)
      throw new ApiError(
        403,
        "Selection contains a booking outside your scope; no action was applied",
      );
    const results: Array<{
      id: string;
      success: boolean;
      skipped?: boolean;
      message?: string;
    }> = [];
    for (const id of ids) {
      const target =
        action === "PATIENT_NO_SHOW"
          ? "NOT_SHOW"
          : action === "DOCTOR_ABSENT"
            ? "CANCELLED"
            : action;
      try {
        const before = await db.bookingAppointment.findUniqueOrThrow({
          where: { id },
        });
        if (
          before.status === target &&
          (action !== "DOCTOR_ABSENT" || before.absenceType === "DOCTOR_ABSENT")
        ) {
          results.push({ id, success: true, skipped: true });
          continue;
        }
        if (action === "DOCTOR_ABSENT")
          await lifecycle.cancel(
            id,
            actor.id,
            actor.role,
            payload.reason,
            "DOCTOR_ABSENT",
          );
        else
          await lifecycle.transition(
            actor.id,
            id,
            target,
            payload.reason,
            actor.role,
          );
        results.push({ id, success: true });
      } catch (error: any) {
        // Delivery failures after a committed lifecycle transaction must not be
        // reported as a financial rollback or invite the caller to repeat it.
        const saved = await db.bookingAppointment.findUnique({ where: { id } });
        const committed =
          !!saved &&
          saved.status === target &&
          (action !== "DOCTOR_ABSENT" || saved.absenceType === "DOCTOR_ABSENT");
        results.push({
          id,
          success: committed,
          message: committed
            ? "Status updated; notification delivery could not be confirmed"
            : error.message,
        });
      }
    }
    return {
      results,
      successCount: results.filter((row) => row.success).length,
      failureCount: results.filter((row) => !row.success).length,
    };
  };
  return { list, bulk };
}
