import ApiError from "../../../errors/ApiErrors";
import { money } from "../../../utils/money";
import { getAppointmentStartUTC } from "../../../utils/timezoneHelper";

export const commonFields = [
  "fullName",
  "phoneNumber",
  "email",
  "gender",
  "dateOfBirth",
  "country",
  "city",
  "address",
];
export const roleFields: Record<string, string[]> = {
  PATIENT: [],
  DOCTOR: [
    "speciality",
    "qualifications",
    "experience",
    "licenseNumber",
    "consultFee",
  ],
  CLINIC: [
    "clinicName",
    "managerName",
    "managerPhone",
    "contactPhone",
    "location",
    "latitude",
    "longitude",
    "timezone",
  ],
};
export function profileAccess(user: any) {
  const locked =
    user.role === "PATIENT"
      ? Boolean(user.profileApproved)
      : user.role === "DOCTOR"
        ? Boolean(user.doctor?.adminVerified)
        : user.role === "CLINIC"
          ? Boolean(user.clinic?.adminVerified)
          : true;
  const entity =
    user.role === "DOCTOR"
      ? user.doctor
      : user.role === "CLINIC"
        ? user.clinic
        : {};
  const fields = [...commonFields, ...(roleFields[user.role] || [])];
  const values = Object.fromEntries(
    fields.map((field) => [
      field,
      commonFields.includes(field)
        ? (user[field] ?? null)
        : (entity?.[field] ?? null),
    ]),
  );
  return { locked, fields, values, role: user.role, publicInfo: { about: entity?.about ?? null, image: user.role === "CLINIC" ? entity?.logo ?? null : user.profileImage ?? null } };
}
export function normalizedChange(field: string, value: unknown): any {
  if (value == null || value === "") return null;
  if (["consultFee", "latitude", "longitude"].includes(field)) {
    const result = Number(value);
    if (!Number.isFinite(result)) throw new ApiError(400, `Invalid ${field}`);
    if (field === "latitude" && Math.abs(result) > 90)
      throw new ApiError(400, "Invalid latitude");
    if (field === "longitude" && Math.abs(result) > 180)
      throw new ApiError(400, "Invalid longitude");
    return field === "consultFee" ? money(result) : result;
  }
  if (typeof value !== "string" && !(value instanceof Date))
    throw new ApiError(400, `Invalid ${field}`);
  if (field === "dateOfBirth") {
    const date = new Date(value as any);
    if (isNaN(date.getTime())) throw new ApiError(400, "Invalid date of birth");
    return date.toISOString();
  }
  const text = String(value).trim();
  if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))
    throw new ApiError(400, "Invalid email");
  if (text.length > 5000) throw new ApiError(400, `${field} is too long`);
  if (field === "phoneNumber" && !/^\+?[0-9]{6,16}$/.test(text))
    throw new ApiError(400, "Invalid phone number");
  if (field === "timezone") {
    try {
      new Intl.DateTimeFormat("en", { timeZone: text }).format();
    } catch {
      throw new ApiError(400, "Invalid timezone");
    }
  }
  return text;
}
// Existing production profiles can contain older formatting or invalid values.
// Validation applies to the proposed replacement, never blocks correcting it.
export function storedChange(field: string, value: unknown): any {
  try {
    return normalizedChange(field, value);
  } catch {
    return value ?? null;
  }
}
export async function assertProfileEditable(
  tx: any,
  userId: string,
  payload: any,
) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: { doctor: true, clinic: true },
  });
  if (!user) throw new ApiError(404, "Account not found");
  const access = profileAccess(user);
  if (!access.locked) return;
  const changed = access.fields.filter(
    (field) =>
      payload[field] !== undefined &&
      JSON.stringify(normalizedChange(field, payload[field])) !==
        JSON.stringify(storedChange(field, access.values[field])),
  );
  if (changed.length)
    throw new ApiError(
      403,
      `Approved profile is locked. Submit a profile change request for: ${changed.join(", ")}`,
    );
}
export function bankDetails(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ApiError(400, "Bank details are required");
  const result: Record<string, string> = {};
  for (const key of ["iban", "accountNumber", "beneficiaryName", "bankName"]) {
    if (typeof value[key] !== "string" || value[key].trim().length > 160)
      throw new ApiError(400, `Invalid ${key}`);
    result[key] = value[key].trim();
  }
  if (
    !result.beneficiaryName ||
    !result.bankName ||
    (!result.iban && !result.accountNumber)
  )
    throw new ApiError(
      400,
      "Save beneficiary, bank and IBAN or account number first",
    );
  return result;
}
export function assertArrivalWindow(
  booking: any,
  hours: number,
  now = Date.now(),
) {
  if (!Number.isInteger(hours) || hours < 0 || hours > 72)
    throw new ApiError(400, "Arrival window must be 0–72 hours");
  const starts = getAppointmentStartUTC(
    booking.consultDate,
    booking.startTime,
    booking.clinic?.timezone,
  ).getTime();
  if (now < starts - hours * 3600000)
    throw new ApiError(
      400,
      `Arrival can only be recorded from ${hours} hours before the appointment`,
    );
}
export function pageOptions(query: any) {
  const page = Number(query.page || 1),
    limit = Number(query.limit || 25);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 5000
  )
    throw new ApiError(400, "Invalid pagination (1–5000 rows)");
  return { page, limit, skip: (page - 1) * limit };
}
export function bookingFilters(input: any, now = new Date()): any {
  const query = { ...input };
  if (
    query.period === "custom" &&
    !query.date &&
    (!query.startDate || !query.endDate)
  )
    throw new ApiError(400, "Choose both dates for a custom report");
  if (
    !query.date &&
    !query.startDate &&
    !query.endDate &&
    query.period &&
    !["all", "custom"].includes(query.period)
  ) {
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const end = new Date(start);
    if (query.period === "weekly") {
      start.setUTCDate(start.getUTCDate() - start.getUTCDay());
      end.setTime(start.getTime());
      end.setUTCDate(end.getUTCDate() + 6);
    } else if (query.period === "monthly") {
      start.setUTCDate(1);
      end.setUTCMonth(end.getUTCMonth() + 1, 0);
    } else if (query.period === "last_month") {
      start.setUTCMonth(start.getUTCMonth() - 1, 1);
      end.setUTCDate(0);
    } else if (query.period !== "daily")
      throw new ApiError(400, "Invalid report period");
    query.startDate = start.toISOString();
    query.endDate = end.toISOString();
  }
  const where: any = {};
  for (const key of ["clinicId", "doctorId", "patientId"])
    if (query[key] && String(query[key]).toUpperCase() !== "ALL")
      where[key] = String(query[key]);
  if (query.specialty && String(query.specialty).toUpperCase() !== "ALL")
    where.doctor = {
      speciality: { contains: String(query.specialty), mode: "insensitive" },
    };
  if (query.location && String(query.location).toUpperCase() !== "ALL")
    where.clinic = {
      location: { contains: String(query.location), mode: "insensitive" },
    };
  if (query.time)
    where.AND = [
      {
        OR: [
          { startTime: { contains: String(query.time) } },
          { endTime: { contains: String(query.time) } },
        ],
      },
    ];
  else if (query.shift === "morning") where.startTime = { lt: "13:00" };
  else if (query.shift === "evening") where.startTime = { gte: "13:00" };
  if (query.status === "DOCTOR_ABSENT") where.absenceType = "DOCTOR_ABSENT";
  else if (query.status === "PATIENT_NO_SHOW") where.status = "NOT_SHOW";
  else if (query.status && query.status !== "ALL") {
    if (
      ![
        "PENDING",
        "CANCELLED",
        "CONFIRMED",
        "INPROGRESS",
        "COMPLETE",
        "ARRIVED",
        "NOT_UPDATED",
        "NOT_SHOW",
        "REJECTED",
      ].includes(query.status)
    )
      throw new ApiError(400, "Invalid booking status");
    where.status = String(query.status);
  }
  if (query.date || query.startDate || query.endDate) {
    const range: any = {};
    if (query.date || query.startDate) {
      const date = new Date(query.date || query.startDate);
      if (isNaN(date.getTime())) throw new ApiError(400, "Invalid start date");
      date.setUTCHours(0, 0, 0, 0);
      range.gte = date;
    }
    if (query.date || query.endDate) {
      const date = new Date(query.date || query.endDate);
      if (isNaN(date.getTime())) throw new ApiError(400, "Invalid end date");
      date.setUTCHours(23, 59, 59, 999);
      range.lte = date;
    }
    if (range.gte && range.lte && range.gte > range.lte)
      throw new ApiError(400, "Start date must precede end date");
    where.consultDate = range;
  }
  if (query.searchTerm)
    where.OR = [
      {
        patient: {
          user: { phoneNumber: { contains: String(query.searchTerm) } },
        },
      },
      {
        patient: {
          user: {
            fullName: {
              contains: String(query.searchTerm),
              mode: "insensitive",
            },
          },
        },
      },
      {
        doctor: {
          user: { phoneNumber: { contains: String(query.searchTerm) } },
        },
      },
      {
        doctor: {
          user: {
            fullName: {
              contains: String(query.searchTerm),
              mode: "insensitive",
            },
          },
        },
      },
    ];
  return where;
}
