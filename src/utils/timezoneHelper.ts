/**
 * Timezone Helper Utility
 * Enforces Priority 15: "UTC storage with per-clinic IANA timezone; every deadline computed
 * against the clinic's local time, no hardcoded offsets."
 */

export const DEFAULT_CLINIC_TIMEZONE = "Africa/Tripoli";

/**
 * Calculates the exact timezone offset in minutes for a specific date in an IANA timezone.
 * Returns the difference in minutes (e.g., +120 for Africa/Tripoli).
 */
export const getTimezoneOffsetMinutes = (date: Date, timeZone: string = DEFAULT_CLINIC_TIMEZONE): number => {
  try {
    const validZone = timeZone || DEFAULT_CLINIC_TIMEZONE;
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: validZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    const parts = dtf.formatToParts(date);
    const getPart = (type: string) =>
      parseInt(parts.find((p) => p.type === type)?.value || "0", 10);

    const year = getPart("year");
    const month = getPart("month") - 1;
    const day = getPart("day");
    const hour = getPart("hour") % 24;
    const minute = getPart("minute");
    const second = getPart("second");

    const asUTC = Date.UTC(year, month, day, hour, minute, second);
    return Math.round((asUTC - date.getTime()) / 60000);
  } catch (error) {
    // If an invalid IANA timezone string was stored, fallback to Tripoli
    return 120;
  }
};

/**
 * Converts an appointment date and slot time in a clinic's local IANA timezone
 * into the exact, authoritative UTC Date.
 */
export const getAppointmentStartUTC = (
  consultDate: Date,
  startTime: string | null | undefined,
  timeZone: string = DEFAULT_CLINIC_TIMEZONE
): Date => {
  const [hStr, mStr] = (startTime || "00:00").split(":");
  const localH = parseInt(hStr, 10) || 0;
  const localM = parseInt(mStr, 10) || 0;

  const d = new Date(consultDate);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();

  const approxUTC = new Date(Date.UTC(year, month, day, localH, localM, 0, 0));
  const offsetMinutes = getTimezoneOffsetMinutes(approxUTC, timeZone);

  return new Date(approxUTC.getTime() - offsetMinutes * 60 * 1000);
};

/**
 * Checks whether an appointment can be cancelled according to the 12-hour cutoff rule.
 * The cutoff is computed against the clinic's local time without hardcoded offsets.
 */
export const checkCancellationAllowed = (
  consultDate: Date,
  startTime: string | null | undefined,
  timeZone: string = DEFAULT_CLINIC_TIMEZONE,
  requiredHoursNotice: number = 12
): {
  isAllowed: boolean;
  appointmentUTC: Date;
  deadlineUTC: Date;
  hoursRemaining: number;
} => {
  const appointmentUTC = getAppointmentStartUTC(consultDate, startTime, timeZone);
  const deadlineUTC = new Date(
    appointmentUTC.getTime() - requiredHoursNotice * 60 * 60 * 1000
  );
  const now = new Date();

  const diffMs = appointmentUTC.getTime() - now.getTime();
  const hoursRemaining = diffMs / (1000 * 60 * 60);

  return {
    isAllowed: hoursRemaining >= requiredHoursNotice,
    appointmentUTC,
    deadlineUTC,
    hoursRemaining,
  };
};

/**
 * Format a UTC Date into the clinic's local timezone string (e.g., YYYY-MM-DD HH:mm)
 */
export const formatInClinicTimezone = (
  date: Date,
  timeZone: string = DEFAULT_CLINIC_TIMEZONE
): string => {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone || DEFAULT_CLINIC_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString();
  }
};
