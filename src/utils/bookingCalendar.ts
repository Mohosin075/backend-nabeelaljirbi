import type { Prisma, PrismaClient } from "@prisma/client";
import { getClinicCalendarDate } from "./timezoneHelper";

export async function bookingCalendar(
  db: PrismaClient,
  scope: Prisma.BookingAppointmentWhereInput,
) {
  const now = new Date(Date.now());
  const clinics = await db.bookingAppointment.findMany({
    where: scope,
    distinct: ["clinicId"],
    select: { clinicId: true, clinic: { select: { timezone: true } } },
  });
  const clinicDays = clinics.map(({ clinicId, clinic }) => ({
    clinicId,
    date: getClinicCalendarDate(now, clinic.timezone),
  }));
  const todayScope = {
    OR: clinicDays.map(({ clinicId, date }) => ({
      clinicId,
      consultDate: { gte: date, lt: new Date(date.getTime() + 86400000) },
    })),
  };
  const upcomingScope = {
    OR: clinicDays.map(({ clinicId, date }) => ({
      clinicId,
      consultDate: { gte: date },
    })),
  };
  const futureScope = {
    OR: clinicDays.map(({ clinicId, date }) => ({
      clinicId,
      consultDate: { gte: new Date(date.getTime() + 86400000) },
    })),
  };
  return { clinicDays, todayScope, upcomingScope, futureScope };
}
