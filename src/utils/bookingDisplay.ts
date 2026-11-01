export const automaticUnresolvedWhere = {
  OR: [
    { absenceType: "AUTO_UNRESOLVED" },
    {
      noShowReason: {
        startsWith: "Auto-settled: Neglected (no arrival recorded)",
      },
    },
    {
      cancellationReason: {
        startsWith: "Auto-settled: Neglected (no arrival recorded)",
      },
    },
  ],
};

export function bookingDisplayStatus(row: {
  status: string;
  absenceType?: string | null;
  noShowReason?: string | null;
  cancellationReason?: string | null;
}) {
  if (row.absenceType === "DOCTOR_ABSENT") return "DOCTOR_ABSENT";
  if (row.status === "NOT_SHOW") {
    const automatic =
      row.absenceType === "AUTO_UNRESOLVED" ||
      [row.noShowReason, row.cancellationReason].some((reason) =>
        reason?.startsWith("Auto-settled: Neglected (no arrival recorded)"),
      );
    return automatic ? "AUTO_UNRESOLVED" : "PATIENT_NO_SHOW";
  }
  return row.status;
}

// Explicit null branches keep legacy manual no-shows visible under SQL's nullable comparisons.
export const patientNoShowWhere = {
  AND: [
    {
      OR: [{ absenceType: null }, { absenceType: { not: "AUTO_UNRESOLVED" } }],
    },
    {
      OR: [
        { noShowReason: null },
        {
          NOT: {
            noShowReason: {
              startsWith: "Auto-settled: Neglected (no arrival recorded)",
            },
          },
        },
      ],
    },
    {
      OR: [
        { cancellationReason: null },
        {
          NOT: {
            cancellationReason: {
              startsWith: "Auto-settled: Neglected (no arrival recorded)",
            },
          },
        },
      ],
    },
  ],
};
