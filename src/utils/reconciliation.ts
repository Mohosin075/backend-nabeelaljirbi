import { bookingCurrencyCode } from "./money";

export function reconciliationGroups(rows: any[]) {
  const countries = new Map<string, any>(),
    doctors = new Map<string, any>(),
    clinics = new Map<string, any>();
  const totals = () => ({
    totalConsultFees: 0,
    totalServiceFees: 0,
    totalPatientServiceFees: 0,
    platformCollectedConsultFees: 0,
    netClinicReceivable: 0,
  });
  for (const row of rows) {
    const country = row.feeCountry || "HISTORICAL_UNSPECIFIED",
      currency = bookingCurrencyCode(row.feeCountry) || "Unspecified";
    const group = countries.get(country) || { country, currency, ...totals() };
    if (row.status === "COMPLETE") {
      group.totalConsultFees += row.consultFee || 0;
      group.totalServiceFees += row.clinicServiceFee || 0;
      group.totalPatientServiceFees += row.serviceFeeAmount || 0;
      if (row.collectionMode === "MODE_B")
        group.platformCollectedConsultFees += row.consultFee || 0;
    }
    countries.set(country, group);
    for (const [map, id, key, name, extra] of [
      [
        doctors,
        row.doctorId,
        "doctor",
        row.doctor?.user?.fullName || "Doctor",
        {},
      ],
      [
        clinics,
        row.clinicId,
        "clinic",
        row.clinic?.clinicName || "Clinic",
        { location: row.clinic?.location || "" },
      ],
    ] as const) {
      if (!id) continue;
      const identity = `${id}:${country}`,
        target = map.get(identity) || {
          [`${key}Id`]: id,
          [`${key}Name`]: name,
          country,
          currency,
          ...extra,
          totalBookings: 0,
          completedBookings: 0,
          totalConsultFee: 0,
          totalServiceFee: 0,
        };
      target.totalBookings++;
      if (row.status === "COMPLETE") {
        target.completedBookings++;
        target.totalConsultFee += row.consultFee || 0;
        target.totalServiceFee += row.clinicServiceFee || 0;
      }
      map.set(identity, target);
    }
  }
  const round = (row: any) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === "number" ? Number(value.toFixed(2)) : value,
      ]),
    );
  const byCountry = [...countries.values()].map((group) =>
    round({
      ...group,
      netClinicReceivable: group.totalConsultFees - group.totalServiceFees,
    }),
  );
  // An explicit null forbids treating mixed/unknown currency as a monetary total.
  const single = byCountry.length === 1 ? byCountry[0] : null;
  return {
    byCountry,
    currency: single?.currency || null,
    country: single?.country || null,
    ...Object.fromEntries(
      Object.keys(totals()).map((key) => [
        key,
        single ? single[key] : rows.length ? null : 0,
      ]),
    ),
    doctorBreakdown: [...doctors.values()].map(round),
    clinicBreakdown: [...clinics.values()].map(round),
  };
}
