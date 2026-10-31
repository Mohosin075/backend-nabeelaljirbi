import ApiError from "../../../errors/ApiErrors";

export function requireAdmin(
  actor: any,
  tiers = ["SUPER_ADMIN", "OPERATIONS"],
) {
  if (actor.role !== "ADMIN" || !tiers.includes(actor.adminTier))
    throw new ApiError(403, "Main Admin permission required");
}
export async function bookingScope(db: any, actor: any) {
  if (actor.role === "ADMIN") {
    requireAdmin(actor, [
      "SUPER_ADMIN",
      "OPERATIONS",
      "FINANCE",
      "SUPPORT",
      "READ_ONLY",
    ]);
    return {};
  }
  if (actor.role === "PATIENT") {
    const patient = await db.patient.findUnique({
      where: { userId: actor.id },
    });
    if (patient) return { patientId: patient.id };
  }
  if (actor.role === "DOCTOR") {
    const doctor = await db.doctor.findUnique({ where: { userId: actor.id } });
    if (doctor) return { doctorId: doctor.id };
  }
  if (["CLINIC", "MANAGER"].includes(actor.role)) {
    const clinic = await db.clinic.findFirst({
      where:
        actor.role === "CLINIC"
          ? { userId: actor.id }
          : { manager: { some: { userId: actor.id } } },
    });
    if (clinic) return { clinicId: clinic.id };
  }
  throw new ApiError(403, "A valid profile is required");
}
