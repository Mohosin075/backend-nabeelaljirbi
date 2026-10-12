import { BookingStatus, TopUpType, WeekDay } from "@prisma/client";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { CreateBookingPayload } from "./booking.interface";
import { BookingSchedulerService } from "../../jobs/services/bookingScheduler.service";

/**
 * 4 — Booking Flow
 * Flow: Doctor -> Clinic -> Date -> Working Period -> Request -> Clinic Approval -> Confirmed.
 * - Strictly period- and capacity-based, never minute-exact
 * - Day-of-week validation blocks requests outside doctor's configured working days
 * - Advance-booking window (Admin/Clinic-configurable 7/14/30/60 days, default 14)
 * - Financially: Request freezes required amount (Hold) rather than deducting it
 * - Collection Mode: Mode A (service fee only) or Mode B (service fee + consult fee)
 * - Approval converts Hold to actual charge -> Confirmed
 * - Rejection / silence by deadline unfreezes full hold -> Rejected
 */

const createBooking = async (userId: string, payload: CreateBookingPayload) => {
  const {
    clinicId,
    doctorId,
    workingSlotId,
    consultDate,
    bookedFor = "SELF",
    familyMemberName,
    familyMemberRelation,
  } = payload;

  // 1. Fetch user & patient record
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { patient: true },
  });

  if (!user || !user.patient) {
    throw new ApiError(httpStatus.NOT_FOUND, "Patient profile not found");
  }

  // 2. Resolve clinic: incoming clinicId might be Clinic.id, Clinic.userId, or doctor's direct clinic
  let resolvedClinicId = clinicId;
  if (!resolvedClinicId) {
    const doc = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: {
        clinicId: true,
        doctorClinics: { select: { clinicId: true }, where: { isActive: true } },
      },
    });
    resolvedClinicId = doc?.clinicId || doc?.doctorClinics[0]?.clinicId || "";
  }

  let clinic = await prisma.clinic.findUnique({
    where: { id: resolvedClinicId },
    include: { user: true },
  });

  if (!clinic) {
    clinic = await prisma.clinic.findFirst({
      where: { userId: resolvedClinicId },
      include: { user: true },
    });
  }

  if (!clinic) {
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");
  }

  const effectiveClinicId = clinic.id;

  // 3. Fetch doctor and verify affiliation with this clinic
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    include: {
      user: {
        select: {
          fullName: true,
          profileImage: true,
        },
      },
      doctorClinics: {
        where: { isActive: true },
      },
    },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  // Verify doctor belongs to or is linked with the clinic
  const isLinkedToClinic =
    doctor.clinicId === effectiveClinicId ||
    doctor.doctorClinics.some(
      (dc) => dc.clinicId === effectiveClinicId && dc.isActive
    );
  if (!isLinkedToClinic) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Doctor is not affiliated with this clinic"
    );
  }

  // 4. Validate Advance-Booking Window (configurable per clinic/admin, default 14 days)
  const dateInput = consultDate || (payload as any).date;
  const targetDate = new Date(dateInput);
  if (!dateInput || isNaN(targetDate.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Invalid consult date");
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const maxDays = clinic.advanceBookingDays || 14;
  const maxAllowedDate = new Date(today);
  maxAllowedDate.setUTCDate(maxAllowedDate.getUTCDate() + maxDays);
  maxAllowedDate.setUTCHours(23, 59, 59, 999);

  const checkDate = new Date(targetDate);
  checkDate.setUTCHours(0, 0, 0, 0);

  if (checkDate < today) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Cannot book appointments for past dates"
    );
  }

  if (checkDate > maxAllowedDate) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Advance booking is limited to ${maxDays} days in advance`
    );
  }

  // 5. Day-of-week validation
  const weekDayMap: WeekDay[] = [
    WeekDay.SUNDAY,
    WeekDay.MONDAY,
    WeekDay.TUESDAY,
    WeekDay.WEDNESDAY,
    WeekDay.THURSDAY,
    WeekDay.FRIDAY,
    WeekDay.SATURDAY,
  ];
  const targetDayOfWeek = weekDayMap[targetDate.getUTCDay()];

  const workingDay = await prisma.workingDay.findFirst({
    where: {
      doctorId,
      OR: [
        { clinicId: effectiveClinicId },
        { clinicId: null },
      ],
      day: targetDayOfWeek,
      isActive: true,
    },
    orderBy: [
      { clinicId: "desc" },
    ],
    include: {
      slots: true,
    },
  });

  if (!workingDay) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Doctor does not have active working hours on ${targetDayOfWeek} at this clinic`
    );
  }

  // 6. Working period slot and capacity validation
  const workingSlot = workingDay.slots.find(
    (slot) => slot.id === workingSlotId && slot.isActive
  );

  if (!workingSlot) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Selected working period is not available or inactive"
    );
  }

  const dayStart = new Date(targetDate);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setUTCHours(23, 59, 59, 999);

  // Count existing bookings for this doctor, clinic, date, and workingSlot
  const existingActiveBookingsCount = await prisma.bookingAppointment.count({
    where: {
      doctorId,
      clinicId: effectiveClinicId,
      workingSlotId: workingSlot.id,
      consultDate: {
        gte: dayStart,
        lte: dayEnd,
      },
      status: {
        in: [
          BookingStatus.PENDING,
          BookingStatus.CONFIRMED,
          BookingStatus.INPROGRESS,
          BookingStatus.ARRIVED,
        ],
      },
    },
  });

  if (existingActiveBookingsCount >= workingSlot.capacity) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Working period (${workingSlot.startTime} - ${workingSlot.endTime}) capacity of ${workingSlot.capacity} patients is full`
    );
  }

  // Next queue/serial number
  const serialNumber = existingActiveBookingsCount + 1;

  // Approximate estimated time derivation (clearly marked as estimate)
  let approximateEstimatedTime: string | null = null;
  if (workingSlot.startTime) {
    const [startH, startM] = workingSlot.startTime.split(":").map(Number);
    // Rough estimate: spread evenly across slot duration if multiple capacity
    if (workingSlot.endTime) {
      const [endH, endM] = workingSlot.endTime.split(":").map(Number);
      const totalMinutes = endH * 60 + endM - (startH * 60 + startM);
      if (totalMinutes > 0 && workingSlot.capacity > 0) {
        const avgMinutesPerPatient = Math.max(
          10,
          Math.floor(totalMinutes / workingSlot.capacity)
        );
        const estMinutes =
          startH * 60 + startM + (serialNumber - 1) * avgMinutesPerPatient;
        const estH = Math.floor(estMinutes / 60) % 24;
        const estM = estMinutes % 60;
        approximateEstimatedTime = `${String(estH).padStart(2, "0")}:${String(
          estM
        ).padStart(2, "0")}`;
      }
    }
    if (!approximateEstimatedTime) {
      approximateEstimatedTime = workingSlot.startTime;
    }
  }

  // 7. Financial calculation: Percentage-based service fee and Collection Mode
  const consultFee = doctor.consultFee || 0;
  const serviceFeePercentage = clinic.serviceFeePercentage || 10.0;
  const serviceFeeAmount = Number(
    ((consultFee * serviceFeePercentage) / 100).toFixed(2)
  );
  const collectionMode = clinic.collectionMode || "MODE_A";

  // Mode A: Service fee only is frozen (hold)
  // Mode B: Service fee + consultation fee is frozen (hold)
  const holdAmount =
    collectionMode === "MODE_B"
      ? Number((consultFee + serviceFeeAmount).toFixed(2))
      : serviceFeeAmount;

  // 8. Patient wallet validation (Available balance = wallet - frozenWallet)
  const currentWallet = user.wallet || 0;
  const currentFrozen = user.frozenWallet || 0;
  const availableWallet = Math.max(0, currentWallet - currentFrozen);

  if (availableWallet < holdAmount) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Insufficient wallet balance. Required hold: ${holdAmount} LYD, Available balance: ${availableWallet.toFixed(
        2
      )} LYD`
    );
  }

  // 9. Execute transaction: Freeze wallet hold & create booking request
  const booking = await prisma.$transaction(async (tx) => {
    // Freeze the hold amount
    if (holdAmount > 0) {
      await tx.user.update({
        where: { id: user.id },
        data: {
          frozenWallet: {
            increment: holdAmount,
          },
        },
      });
    }

    const createdBooking = await tx.bookingAppointment.create({
      data: {
        clinicId: effectiveClinicId,
        doctorId,
        patientId: user.patient!.id,
        workingSlotId: workingSlot.id,
        consultDate: dayStart,
        startTime: workingSlot.startTime,
        endTime: workingSlot.endTime,
        serialNumber,
        status: BookingStatus.PENDING,
        holdAmount,
        collectionMode,
        consultFee,
        serviceFeePercentage,
        serviceFeeAmount,
        totalAmount: holdAmount,
        bookedFor,
        familyMemberName: bookedFor === "FAMILY" ? familyMemberName : null,
        familyMemberRelation:
          bookedFor === "FAMILY" ? familyMemberRelation : null,
        approximateEstimatedTime,
        clinicServiceFee: 0,
        patientServiceFee: serviceFeeAmount,
      },
      include: {
        doctor: {
          include: {
            user: {
              select: {
                fullName: true,
                profileImage: true,
              },
            },
          },
        },
        clinic: {
          select: {
            id: true,
            clinicName: true,
            location: true,
            contactPhone: true,
            logo: true,
          },
        },
        patient: {
          include: {
            user: {
              select: {
                fullName: true,
                phoneNumber: true,
                profileImage: true,
              },
            },
          },
        },
      },
    });

    // Patient notification: Request Sent (Pending Clinic Approval)
    await tx.patientNotification.create({
      data: {
        patientId: user.patient!.id,
        bookingAppointmentId: createdBooking.id,
        notificationType: "APPOINTMENT_REQUEST_SENT",
        title: "Booking Request Sent",
        description: `Your appointment request for ${new Date(
          dayStart
        ).toLocaleDateString()} with Dr. ${
          doctor.user?.fullName || "Doctor"
        } at ${
          clinic.clinicName || "Clinic"
        } has been sent and is awaiting clinic approval.`,
      },
    });

    // Clinic notification: New Pending Request
    await tx.clinicNotification.create({
      data: {
        clinicId: clinic.id,
        bookingAppointmentId: createdBooking.id,
        notificationType: "NEW_BOOKING_REQUEST",
        title: "New Booking Request",
        description: `New appointment request received for Dr. ${
          doctor.user?.fullName || "Doctor"
        } on ${new Date(dayStart).toLocaleDateString()} (${
          workingSlot.startTime
        } - ${workingSlot.endTime}). Please review before period starts.`,
      },
    });

    return createdBooking;
  });

  // 10. Schedule pending timeout: Period start time is the clinic response deadline
  try {
    const adminUser = await prisma.user.findUnique({
      where: { phoneNumber: `${process.env.ADMIN_PHONE_NUMBER}` },
    });

    if (adminUser) {
      await BookingSchedulerService.schedulePendingBookingTimeout({
        appointmentId: booking.id,
        patientId: user.patient.id,
        patientUserId: user.id,
        clinicUserId: clinic.userId,
        adminUserId: adminUser.id,
        patientServiceFee: booking.patientServiceFee,
        consultDate: booking.consultDate,
        endTime: workingSlot.startTime || workingSlot.endTime, // deadline is period start time!
      });
    }
  } catch (scheduleError) {
    console.error("Failed to schedule pending timeout job:", scheduleError);
  }

  return booking;
};

/**
 * Clinic Approval converts the Hold into an actual charge and moves booking to CONFIRMED
 */
const confirmBooking = async (
  appointmentId: string,
  callerUserId?: string
) => {
  const appointment = await prisma.bookingAppointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { include: { user: true } },
      clinic: { include: { user: true } },
      doctor: { include: { user: true } },
    },
  });

  if (!appointment) {
    throw new ApiError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  if (appointment.status !== BookingStatus.PENDING) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot confirm appointment with status ${appointment.status}`
    );
  }

  const adminUser = await prisma.user.findUnique({
    where: { phoneNumber: `${process.env.ADMIN_PHONE_NUMBER}` },
  });

  if (!adminUser) {
    throw new ApiError(httpStatus.NOT_FOUND, "Admin user not found");
  }

  const patientUserId = appointment.patient.userId;
  const clinicUserId = appointment.clinic.userId;
  const holdAmount = appointment.holdAmount || 0;
  const serviceFeeAmount = appointment.serviceFeeAmount || 0;
  const consultFee = appointment.consultFee || 0;
  const collectionMode = appointment.collectionMode || "MODE_A";

  // Execute confirmation transaction: Convert hold into actual charge
  const updatedBooking = await prisma.$transaction(async (tx) => {
    // 1. Unfreeze hold and deduct from patient wallet
    if (holdAmount > 0) {
      await tx.user.update({
        where: { id: patientUserId },
        data: {
          wallet: { decrement: holdAmount },
          frozenWallet: { decrement: holdAmount },
        },
      });
    }

    // 2. Transfer platform service fee to Admin
    if (serviceFeeAmount > 0) {
      await tx.user.update({
        where: { id: adminUser.id },
        data: {
          wallet: { increment: serviceFeeAmount },
        },
      });

      // Record platform fee transaction
      await tx.topUp.create({
        data: {
          userId: adminUser.id,
          amount: serviceFeeAmount,
          appointmentId: appointment.id,
          type: TopUpType.BOOKING,
        },
      });
    }

    // 3. In Mode B: Credit consultation fee to clinic wallet
    if (collectionMode === "MODE_B" && consultFee > 0) {
      await tx.user.update({
        where: { id: clinicUserId },
        data: {
          wallet: { increment: consultFee },
        },
      });

      await tx.topUp.create({
        data: {
          userId: clinicUserId,
          amount: consultFee,
          appointmentId: appointment.id,
          type: TopUpType.BOOKING,
        },
      });
    }

    // 4. Update booking status to CONFIRMED
    const confirmed = await tx.bookingAppointment.update({
      where: { id: appointmentId },
      data: {
        status: BookingStatus.CONFIRMED,
      },
    });

    // 5. Patient notification with queue position and estimated time
    await tx.patientNotification.create({
      data: {
        patientId: appointment.patientId,
        bookingAppointmentId: appointment.id,
        notificationType: "APPOINTMENT_CONFIRMED",
        title: "Appointment Confirmed",
        description: `Your appointment with Dr. ${
          appointment.doctor.user?.fullName || "Doctor"
        } on ${new Date(appointment.consultDate).toLocaleDateString()} (${
          appointment.startTime
        } - ${
          appointment.endTime
        }) is Confirmed. Queue #${appointment.serialNumber}. Approx time: ${
          appointment.approximateEstimatedTime || appointment.startTime
        } (Estimate).`,
      },
    });

    return confirmed;
  });

  // Cancel pending timeout job
  try {
    await BookingSchedulerService.cancelPendingBookingTimeout(appointmentId);
  } catch (err) {
    console.error("Error cancelling pending timeout:", err);
  }

  // Schedule reminders for 24 hours and 3 hours before appointment
  try {
    await BookingSchedulerService.scheduleBookingNotifications({
      appointmentId: updatedBooking.id,
      patientId: updatedBooking.patientId,
      doctorId: updatedBooking.doctorId,
      clinicId: updatedBooking.clinicId,
      consultDate: updatedBooking.consultDate,
      startTime: updatedBooking.startTime!,
      endTime: updatedBooking.endTime!,
      status: updatedBooking.status,
    });
  } catch (reminderErr) {
    console.error("Error scheduling reminders:", reminderErr);
  }

  return updatedBooking;
};

/**
 * Rejection / silence by deadline unfreezes full hold and moves booking to REJECTED
 */
const rejectBooking = async (
  appointmentId: string,
  reason?: string,
  cancelledBy: string = "CLINIC"
) => {
  const appointment = await prisma.bookingAppointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { include: { user: true } },
      clinic: true,
      doctor: { include: { user: true } },
    },
  });

  if (!appointment) {
    throw new ApiError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  if (appointment.status !== BookingStatus.PENDING) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot reject appointment with status ${appointment.status}`
    );
  }

  const patientUserId = appointment.patient.userId;
  const holdAmount = appointment.holdAmount || 0;

  // Execute rejection transaction: Unfreeze full hold amount
  const rejectedBooking = await prisma.$transaction(async (tx) => {
    // Unfreeze the patient's wallet hold (money was never deducted, unfreezing restores balance)
    if (holdAmount > 0) {
      await tx.user.update({
        where: { id: patientUserId },
        data: {
          frozenWallet: { decrement: holdAmount },
        },
      });
    }

    const updated = await tx.bookingAppointment.update({
      where: { id: appointmentId },
      data: {
        status: BookingStatus.REJECTED,
        rejectionReason: reason || "Clinic rejected booking request",
        cancelledBy,
        cancellationReason: reason || "Clinic rejected booking request",
      },
    });

    // Notify patient
    await tx.patientNotification.create({
      data: {
        patientId: appointment.patientId,
        bookingAppointmentId: appointment.id,
        notificationType: "APPOINTMENT_REJECTED",
        title: "Booking Request Rejected",
        description: `Your appointment request for ${new Date(
          appointment.consultDate
        ).toLocaleDateString()} was not accepted. Any frozen amount of ${holdAmount} LYD has been completely released back to your wallet.`,
      },
    });

    return updated;
  });

  // Cancel scheduled jobs
  try {
    await BookingSchedulerService.cancelPendingBookingTimeout(appointmentId);
    await BookingSchedulerService.cancelBookingNotifications(appointmentId);
  } catch (err) {
    console.error("Error cancelling jobs for rejected booking:", err);
  }

  return rejectedBooking;
};

const getBookings = async (userId: string, role: string, options: any) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);

  const { status, doctorId, clinicId, date } = options;

  let where: any = {};
  if (role === "PATIENT") {
    // If user is patient role, map userId to patient.id or match user.id
    const patient = await prisma.patient.findUnique({
      where: { userId },
    });
    where.patientId = patient ? patient.id : userId;
  } else if (role === "DOCTOR") {
    const doctor = await prisma.doctor.findUnique({
      where: { userId },
    });
    where.doctorId = doctor ? doctor.id : userId;
  } else if (role === "CLINIC") {
    const clinic = await prisma.clinic.findUnique({
      where: { userId },
    });
    where.clinicId = clinic ? clinic.id : userId;
  }

  if (status) {
    where.status = status;
  }
  if (doctorId) {
    where.doctorId = doctorId;
  }
  if (clinicId) {
    where.clinicId = clinicId;
  }
  if (date) {
    const queryDate = new Date(date);
    const dStart = new Date(queryDate);
    dStart.setUTCHours(0, 0, 0, 0);
    const dEnd = new Date(queryDate);
    dEnd.setUTCHours(23, 59, 59, 999);
    where.consultDate = {
      gte: dStart,
      lte: dEnd,
    };
  }

  const bookings = await prisma.bookingAppointment.findMany({
    where,
    include: {
      patient: {
        include: {
          user: {
            select: {
              fullName: true,
              phoneNumber: true,
              profileImage: true,
              gender: true,
              dateOfBirth: true,
            },
          },
        },
      },
      doctor: {
        include: {
          user: {
            select: {
              fullName: true,
              profileImage: true,
            },
          },
        },
      },
      clinic: {
        select: {
          id: true,
          clinicName: true,
          location: true,
          logo: true,
          contactPhone: true,
        },
      },
      workingSlot: true,
    },
    skip,
    take: limit,
    orderBy: {
      [sortBy || "createdAt"]: sortOrder || "desc",
    },
  });

  const total = await prisma.bookingAppointment.count({ where });

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: bookings,
  };
};

const cancelBooking = async (appointmentId: string, callerUserId?: string) => {
  const booking = await prisma.bookingAppointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { include: { user: true } },
    },
  });

  if (!booking) {
    throw new ApiError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  // If status is PENDING, simply reject / unfreeze
  if (booking.status === BookingStatus.PENDING) {
    return await rejectBooking(appointmentId, "Cancelled by user", "PATIENT");
  }

  // If status is CONFIRMED, execute cancellation refund
  const updatedBooking = await prisma.bookingAppointment.update({
    where: { id: appointmentId },
    data: {
      status: BookingStatus.CANCELLED,
      cancelledBy: "PATIENT",
    },
  });

  await BookingSchedulerService.cancelBookingNotifications(appointmentId);
  await BookingSchedulerService.cancelPendingBookingTimeout(appointmentId);
  await BookingSchedulerService.cancelConfirmedBookingTimeout(appointmentId);

  await prisma.patientNotification.create({
    data: {
      patientId: booking.patientId,
      bookingAppointmentId: booking.id,
      notificationType: "APPOINTMENT_CANCELLED",
      title: "Appointment Cancelled",
      description: `Your appointment on ${new Date(
        booking.consultDate
      ).toLocaleDateString()} has been cancelled.`,
    },
  });

  return updatedBooking;
};

const completeBooking = async (appointmentId: string) => {
  const booking = await prisma.bookingAppointment.update({
    where: { id: appointmentId },
    data: { status: BookingStatus.COMPLETE },
  });

  await BookingSchedulerService.cancelBookingNotifications(appointmentId);
  await BookingSchedulerService.cancelConfirmedBookingTimeout(appointmentId);

  await prisma.patientNotification.create({
    data: {
      patientId: booking.patientId,
      bookingAppointmentId: booking.id,
      notificationType: "APPOINTMENT_COMPLETED",
      title: "Appointment Completed",
      description: `Your appointment on ${new Date(
        booking.consultDate
      ).toLocaleDateString()} has been completed. Thank you!`,
    },
  });

  return booking;
};

export const BookingService = {
  createBooking,
  getBookings,
  confirmBooking,
  rejectBooking,
  cancelBooking,
  completeBooking,
};
