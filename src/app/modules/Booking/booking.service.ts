import { BookingStatus, Prisma, TopUpType, UserRole, WeekDay } from "@prisma/client";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { CreateBookingPayload } from "./booking.interface";
import { BookingSchedulerService } from "../../jobs/services/bookingScheduler.service";
import { broadcastBookingUpdate } from "../../../helpars/socket/socketHandler";
import { Notification } from "../Notification/notification.service";
import { NotificationTemplateService } from "../NotificationTemplate/notificationTemplate.service";
import { checkCancellationAllowed, getAppointmentStartUTC } from "../../../utils/timezoneHelper";

type BookingActorRole = "PATIENT" | "DOCTOR" | "CLINIC" | "MANAGER" | "ADMIN" | "SYSTEM";

const assertBookingActor = async (
  booking: {
    patient?: { userId: string } | null;
    doctor?: { userId: string } | null;
    clinicId: string;
    clinic?: { userId: string } | null;
  },
  userId: string | undefined,
  role: string | undefined,
  allowedRoles: BookingActorRole[],
) => {
  if (role === "SYSTEM" || role === "ADMIN") return;
  if (!userId || !role || !allowedRoles.includes(role as BookingActorRole)) {
    throw new ApiError(httpStatus.FORBIDDEN, "You are not authorized to perform this booking action");
  }

  const ownsBooking =
    (role === "PATIENT" && booking.patient?.userId === userId) ||
    (role === "DOCTOR" && booking.doctor?.userId === userId) ||
    (role === "CLINIC" && booking.clinic?.userId === userId);
  if (ownsBooking) return;

  if (role === "MANAGER") {
    const manager = await prisma.manager.findFirst({
      where: { userId, clinicId: booking.clinicId },
      select: { id: true },
    });
    if (manager) return;
  }

  throw new ApiError(httpStatus.FORBIDDEN, "You are not authorized to perform this booking action");
};

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

  if (
    bookedFor === "FAMILY" &&
    (!familyMemberName?.trim() || !familyMemberRelation)
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Family member name and relation are required for family bookings",
    );
  }

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

  if (!clinic.adminVerified || !clinic.isVisible) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Clinic is not approved or visible to patients and cannot accept appointments"
    );
  }

  if (clinic.user?.banned || clinic.user?.status !== "ACTIVE") {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Clinic is currently suspended and cannot accept appointments"
    );
  }

  const effectiveClinicId = clinic.id;

  // 3. Fetch doctor and verify affiliation with this clinic
  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    include: {
      user: true,
      doctorClinics: {
        where: { isActive: true },
      },
    },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  if (!doctor.adminVerified) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Doctor is not approved by admin and cannot accept appointments"
    );
  }

  if (doctor.user?.banned || doctor.user?.status !== "ACTIVE") {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Doctor is currently suspended and cannot accept appointments"
    );
  }

  // Verify doctor belongs to or is linked with the clinic
  const isLinkedToClinic =
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

  const platformBookingSetting = await prisma.platformBookingSetting.findFirst();
  const maxDays = platformBookingSetting?.advanceBookingDays ?? clinic.advanceBookingDays ?? 14;
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

  const clinicWorkingDay = await prisma.workingDay.findFirst({
    where: {
      doctorId,
      clinicId: effectiveClinicId,
      day: targetDayOfWeek,
      isActive: true,
    },
    include: { slots: true },
  });
  const workingDay = clinicWorkingDay ?? await prisma.workingDay.findFirst({
    where: {
      doctorId,
      clinicId: null,
      day: targetDayOfWeek,
      isActive: true,
    },
    include: { slots: true },
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

  const appointmentStartUTC = getAppointmentStartUTC(
    targetDate,
    workingSlot.startTime,
    clinic.timezone,
  );
  if (appointmentStartUTC.getTime() <= Date.now()) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "This working period has already started and can no longer be booked",
    );
  }

  const dayStart = new Date(targetDate);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setUTCHours(23, 59, 59, 999);

  // 7. Financial calculation: Percentage-based service fee and Collection Mode
  const consultFee = doctor.consultFee || 0;
  const serviceFeePercentage = clinic.serviceFeePercentage ?? 10.0;
  const serviceFeeAmount = Number(
    ((consultFee * serviceFeePercentage) / 100).toFixed(2)
  );
  const collectionMode = clinic.collectionMode || "MODE_A";

  // Section 6: Clinic-side percentage-based service fee lifecycle
  const clinicServiceFee = !clinic.trial
    ? Number(((consultFee * serviceFeePercentage) / 100).toFixed(2))
    : 0;

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

  // 9. Execute transaction: Atomically verify capacity, freeze wallet hold & create booking request
  let booking;
  try {
    booking = await prisma.$transaction(async (tx) => {
    // Atomic capacity check inside transaction to prevent race conditions & overbooking
    const existingActiveBookingsCount = await tx.bookingAppointment.count({
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

    // Serial numbers are clinic-wide for a calendar day and are never reused
    // after a cancellation. The estimate still uses the active position in
    // this specific working period.
    const latestDailySerial = await tx.bookingAppointment.aggregate({
      where: {
        clinicId: effectiveClinicId,
        consultDate: { gte: dayStart, lte: dayEnd },
      },
      _max: { serialNumber: true },
    });
    const serialNumber = (latestDailySerial._max.serialNumber ?? 0) + 1;
    const queuePosition = existingActiveBookingsCount + 1;

    // Approximate estimated time derivation (clearly marked as estimate)
    let approximateEstimatedTime: string | null = null;
    if (workingSlot.startTime) {
      const [startH, startM] = workingSlot.startTime.split(":").map(Number);
      if (workingSlot.endTime) {
        const [endH, endM] = workingSlot.endTime.split(":").map(Number);
        const totalMinutes = endH * 60 + endM - (startH * 60 + startM);
        if (totalMinutes > 0 && workingSlot.capacity > 0) {
          const avgMinutesPerPatient = Math.max(
            10,
            Math.floor(totalMinutes / workingSlot.capacity)
          );
          const estMinutes =
            startH * 60 + startM + (queuePosition - 1) * avgMinutesPerPatient;
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

    // Recheck spendable balances inside the serializable transaction. The
    // earlier checks are for quick feedback; concurrent bookings must not
    // over-freeze either wallet.
    if (holdAmount > 0) {
      const patientWallet = await tx.user.findUnique({
        where: { id: user.id },
        select: { wallet: true, frozenWallet: true },
      });
      const patientAvailable = Math.max(
        0,
        (patientWallet?.wallet ?? 0) - (patientWallet?.frozenWallet ?? 0),
      );
      if (patientAvailable < holdAmount) {
        throw new ApiError(httpStatus.CONFLICT, "Wallet balance changed. Please refresh and try again.");
      }
    }

    if (clinicServiceFee > 0 && clinic.userId) {
      const clinicWallet = await tx.user.findUnique({
        where: { id: clinic.userId },
        select: { wallet: true, frozenWallet: true },
      });
      const clinicAvailable = Math.max(
        0,
        (clinicWallet?.wallet ?? 0) - (clinicWallet?.frozenWallet ?? 0),
      );
      if (clinicAvailable < clinicServiceFee) {
        throw new ApiError(httpStatus.CONFLICT, "Clinic wallet balance is insufficient for this booking.");
      }
    }

    // Freeze the patient hold amount
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

    // Freeze clinic per-booking fee hold (Section 6: "frozen at booking, both sides")
    if (clinicServiceFee > 0 && clinic.userId) {
      await tx.user.update({
        where: { id: clinic.userId },
        data: {
          frozenWallet: {
            increment: clinicServiceFee,
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
        clinicServiceFee,
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new ApiError(
        httpStatus.CONFLICT,
        "Availability changed while booking. Please refresh and try again."
      );
    }
    throw error;
  }

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
        deadlineTime: workingSlot.startTime,
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
  callerUserId?: string,
  callerRole?: string,
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

  await assertBookingActor(appointment, callerUserId, callerRole, ["CLINIC", "MANAGER", "ADMIN"]);

  if (appointment.status !== BookingStatus.PENDING) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot confirm appointment with status ${appointment.status}`
    );
  }

  let adminUser = await prisma.user.findUnique({
    where: { phoneNumber: `${process.env.ADMIN_PHONE_NUMBER}` },
  });

  if (!adminUser) {
    adminUser = await prisma.user.findFirst({
      where: { role: UserRole.ADMIN },
    });
  }

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

    // 4. Capture clinic service fee: deduct from clinic wallet and unfreeze clinic hold (Section 6)
    const clinicServiceFee = appointment.clinicServiceFee || 0;
    if (clinicServiceFee > 0 && clinicUserId) {
      await tx.user.update({
        where: { id: clinicUserId },
        data: {
          wallet: { decrement: clinicServiceFee },
          frozenWallet: { decrement: clinicServiceFee },
        },
      });

      await tx.user.update({
        where: { id: adminUser.id },
        data: {
          wallet: { increment: clinicServiceFee },
        },
      });

      await tx.topUp.create({
        data: {
          userId: clinicUserId,
          amount: clinicServiceFee,
          appointmentId: appointment.id,
          type: TopUpType.BOOKING,
        },
      });

      await tx.topUp.create({
        data: {
          userId: adminUser.id,
          amount: clinicServiceFee,
          appointmentId: appointment.id,
          type: TopUpType.BOOKING,
        },
      });
    }

    // 5. Record AdminTransaction ledger entry (Section 10 dedicated ledger traceability)
    if (serviceFeeAmount > 0 || clinicServiceFee > 0) {
      await tx.adminTransaction.create({
        data: {
          userId: patientUserId,
          clinicId: clinicUserId,
          patientServiceFee: serviceFeeAmount,
          clinicServiceFee: clinicServiceFee,
          totalAmount: Number((serviceFeeAmount + clinicServiceFee).toFixed(2)),
          appointmentId: appointment.id,
          type: TopUpType.BOOKING,
        },
      });
    }

    // 6. Update booking status to CONFIRMED
    const claimed = await tx.bookingAppointment.updateMany({
      where: { id: appointmentId, status: BookingStatus.PENDING },
      data: { status: BookingStatus.CONFIRMED },
    });
    if (claimed.count !== 1) {
      throw new ApiError(httpStatus.CONFLICT, "This booking has already been handled");
    }
    const confirmed = await tx.bookingAppointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });

    // 7. Patient notification with queue position and estimated time
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

  // Schedule 24h + 3h reminders and 12h auto-settle for CONFIRMED booking
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

  // Issue #2 fix: Schedule 12-hour auto-settle job (Section 5 requirement)
  // "An unresolved confirmed appointment auto-settles 12 hours after period end."
  try {
    const adminUser = await prisma.user.findUnique({
      where: { phoneNumber: `${process.env.ADMIN_PHONE_NUMBER}` },
      select: { id: true },
    });
    if (adminUser) {
      await BookingSchedulerService.scheduleConfirmedBookingTimeout({
        appointmentId: updatedBooking.id,
        patientId: updatedBooking.patientId,
        clinicId: updatedBooking.clinicId,
        clinicUserId: appointment.clinic.userId,
        adminUserId: adminUser.id,
        patientServiceFee: appointment.patientServiceFee || appointment.serviceFeeAmount || 0,
        clinicServiceFee: appointment.clinicServiceFee || 0,
        consultDate: updatedBooking.consultDate,
        endTime: updatedBooking.endTime!,
      });
    }
  } catch (autoSettleErr) {
    console.error("Error scheduling confirmed timeout:", autoSettleErr);
  }

  // FCM Push notification to patient using NotificationTemplate
  try {
    const userLang: "ar" | "en" =
      (appointment.patient?.user as any)?.language === "en" ? "en" : "ar";
    const isEn = userLang === "en";

    const rendered = await NotificationTemplateService.renderNotification(
      "BOOKING_CONFIRMED",
      userLang,
      {
        doctorName:
          appointment.doctor.user?.fullName || (isEn ? "Doctor" : "الطبيب"),
        clinicName:
          appointment.clinic?.clinicName || (isEn ? "Clinic" : "العيادة"),
        clinicAddress:
          appointment.clinic?.location ||
          appointment.clinic?.user?.address ||
          "",
        queueNumber: updatedBooking.serialNumber,
        estimatedTime:
          updatedBooking.approximateEstimatedTime ||
          updatedBooking.startTime ||
          "",
        date: new Date(updatedBooking.consultDate).toISOString().split("T")[0],
        patientName:
          appointment.patient.user?.fullName || (isEn ? "Patient" : "المريض"),
      }
    );

    if (rendered.pushEnabled && appointment.patient.user?.fcmToken) {
      await Notification.PatientNotification(
        updatedBooking.id,
        updatedBooking.patientId,
        "APPOINTMENT_CONFIRMED",
        rendered.title,
        rendered.body,
        appointment.patient.user.fcmToken
      );
    }
  } catch (fcmErr) {
    console.error("FCM error on booking confirmation:", fcmErr);
  }

  return updatedBooking;
};

const markPatientArrived = async (appointmentId: string, patientUserId: string) => {
  const appointment = await prisma.bookingAppointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { select: { userId: true } },
      clinic: { select: { userId: true } },
      doctor: { select: { userId: true } },
    },
  });

  if (!appointment) {
    throw new ApiError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  await assertBookingActor(appointment, patientUserId, "PATIENT", ["PATIENT"]);
  if (appointment.status !== BookingStatus.CONFIRMED) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot mark appointment as arrived with status ${appointment.status}`,
    );
  }

  const updated = await prisma.bookingAppointment.updateMany({
    where: { id: appointmentId, patientId: appointment.patientId, status: BookingStatus.CONFIRMED },
    data: { status: BookingStatus.ARRIVED },
  });
  if (updated.count !== 1) {
    throw new ApiError(httpStatus.CONFLICT, "This booking has already been handled");
  }

  const result = await prisma.bookingAppointment.findUniqueOrThrow({
    where: { id: appointmentId },
  });
  try {
    broadcastBookingUpdate({
      bookingId: result.id,
      status: BookingStatus.ARRIVED,
      clinicId: appointment.clinicId,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      patientUserId: appointment.patient.userId,
      clinicUserId: appointment.clinic.userId,
      doctorUserId: appointment.doctor.userId,
      serialNumber: appointment.serialNumber,
      consultDate: appointment.consultDate,
    });
  } catch (wsErr) {
    console.error("WS broadcast error on patient arrival:", wsErr);
  }
  return result;
};

/**
 * Rejection / silence by deadline unfreezes full hold and moves booking to REJECTED or CANCELLED
 */
const rejectBooking = async (
  appointmentId: string,
  reason?: string,
  cancelledBy: string = "CLINIC",
  callerUserId?: string,
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

  await assertBookingActor(
    appointment,
    callerUserId,
    cancelledBy,
    ["PATIENT", "DOCTOR", "CLINIC", "MANAGER", "ADMIN", "SYSTEM"],
  );

  if (appointment.status !== BookingStatus.PENDING) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot reject appointment with status ${appointment.status}`
    );
  }

  const patientUserId = appointment.patient.userId;
  const holdAmount = appointment.holdAmount || 0;
  const newStatus =
    cancelledBy === "PATIENT"
      ? BookingStatus.CANCELLED
      : BookingStatus.REJECTED;
  const defaultReason =
    cancelledBy === "PATIENT"
      ? "Cancelled by patient"
      : "Clinic rejected booking request";
  const reasonText = reason?.trim() || defaultReason;

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

    // Unfreeze the clinic's wallet hold (Section 6: "released in full on rejection or auto-reject")
    const clinicHold = appointment.clinicServiceFee || 0;
    const clinicUserId = appointment.clinic?.userId;
    if (clinicHold > 0 && clinicUserId) {
      await tx.user.update({
        where: { id: clinicUserId },
        data: {
          frozenWallet: { decrement: clinicHold },
        },
      });
    }

    const claimed = await tx.bookingAppointment.updateMany({
      where: { id: appointmentId, status: BookingStatus.PENDING },
      data: {
        status: newStatus,
        rejectionReason: reasonText,
        cancelledBy,
        cancellationReason: reasonText,
      },
    });
    if (claimed.count !== 1) {
      throw new ApiError(httpStatus.CONFLICT, "This booking has already been handled");
    }
    const updated = await tx.bookingAppointment.findUniqueOrThrow({
      where: { id: appointmentId },
    });

    // Notify patient
    const notifType =
      cancelledBy === "PATIENT"
        ? "APPOINTMENT_CANCELLED"
        : "APPOINTMENT_REJECTED";
    const notifTitle =
      cancelledBy === "PATIENT"
        ? "Booking Request Cancelled"
        : "Booking Request Rejected";
    const notifDesc =
      cancelledBy === "PATIENT"
        ? `Your appointment request for ${new Date(
            appointment.consultDate
          ).toLocaleDateString()} has been cancelled. Any frozen amount of ${holdAmount} LYD has been completely released back to your wallet.`
        : `Your appointment request for ${new Date(
            appointment.consultDate
          ).toLocaleDateString()} was not accepted. Reason: ${reasonText}. Any frozen amount of ${holdAmount} LYD has been completely released back to your wallet.`;

    await tx.patientNotification.create({
      data: {
        patientId: appointment.patientId,
        bookingAppointmentId: appointment.id,
        notificationType: notifType,
        title: notifTitle,
        description: notifDesc,
      },
    });

    return updated;
  });

  // Cancel scheduled BullMQ jobs
  try {
    await BookingSchedulerService.cancelPendingBookingTimeout(appointmentId);
    await BookingSchedulerService.cancelBookingNotifications(appointmentId);
  } catch (err) {
    console.error("Error cancelling jobs for rejected booking:", err);
  }

  // Broadcast WebSocket update for real-time synchronization across interfaces
  try {
    broadcastBookingUpdate({
      bookingId: appointment.id,
      status: newStatus,
      clinicId: appointment.clinicId,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      patientUserId: patientUserId,
      clinicUserId: appointment.clinic?.userId,
      reason: reasonText,
      serialNumber: appointment.serialNumber,
      consultDate: appointment.consultDate,
    });
  } catch (wsErr) {
    console.error("WS broadcast error:", wsErr);
  }

  // FCM Push notification to patient using NotificationTemplate
  try {
    const userLang: "ar" | "en" =
      (appointment.patient?.user as any)?.language === "en" ? "en" : "ar";
    const isEn = userLang === "en";

    const rendered = await NotificationTemplateService.renderNotification(
      "BOOKING_REJECTED",
      userLang,
      {
        doctorName:
          appointment.doctor.user?.fullName || (isEn ? "Doctor" : "الطبيب"),
        clinicName:
          appointment.clinic?.clinicName || (isEn ? "Clinic" : "العيادة"),
        reason: reasonText,
        patientName:
          appointment.patient.user?.fullName || (isEn ? "Patient" : "المريض"),
      }
    );

    if (rendered.pushEnabled && appointment.patient.user?.fcmToken) {
      await Notification.PatientNotification(
        rejectedBooking.id,
        rejectedBooking.patientId,
        "APPOINTMENT_REJECTED",
        rendered.title,
        rendered.body,
        appointment.patient.user.fcmToken
      );
    }
  } catch (fcmErr) {
    console.error("FCM error on booking rejection:", fcmErr);
  }

  return rejectedBooking;
};

const getBookings = async (userId: string, role: string, options: any) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);

  const { status, doctorId, clinicId, date } = options;

  let scope: any = {};
  if (role === "PATIENT") {
    const patient = await prisma.patient.findUnique({
      where: { userId },
    });
    scope.patientId = patient?.id ?? "__missing_patient__";
  } else if (role === "DOCTOR") {
    const doctor = await prisma.doctor.findUnique({
      where: { userId },
    });
    scope.doctorId = doctor?.id ?? "__missing_doctor__";
  } else if (role === "CLINIC") {
    const clinic = await prisma.clinic.findUnique({
      where: { userId },
    });
    scope.clinicId = clinic?.id ?? "__missing_clinic__";
  } else if (role === "MANAGER") {
    const manager = await prisma.manager.findUnique({
      where: { userId },
      select: { clinicId: true },
    });
    scope.clinicId = manager?.clinicId ?? "__missing_manager_clinic__";
  } else if (role !== "ADMIN") {
    throw new ApiError(httpStatus.FORBIDDEN, "You are not authorized to view bookings");
  }

  const filters: Prisma.BookingAppointmentWhereInput = {};
  if (status) {
    if (!Object.values(BookingStatus).includes(status as BookingStatus)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid booking status");
    }
    filters.status = status as BookingStatus;
  }
  if (doctorId) {
    filters.doctorId = doctorId;
  }
  if (clinicId) {
    filters.clinicId = clinicId;
  }
  if (date) {
    const queryDate = new Date(date);
    if (isNaN(queryDate.getTime())) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid booking date");
    }
    const dStart = new Date(queryDate);
    dStart.setUTCHours(0, 0, 0, 0);
    const dEnd = new Date(queryDate);
    dEnd.setUTCHours(23, 59, 59, 999);
    filters.consultDate = {
      gte: dStart,
      lte: dEnd,
    };
  }

  // Keep caller scope separate from filters so query parameters can only narrow
  // results; they must never replace a patient's/clinic's/doctor's ownership scope.
  const where: Prisma.BookingAppointmentWhereInput = {
    AND: [scope, filters],
  };

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

/**
 * 6 — Cancellation & Refunds
 * One engine handles every cancellation path — there is no rescheduling mechanism anywhere in the system.
 * - Patient-initiated cancellation is cancel-and-rebook: available up to 12 hours before the appointment, hard-blocked server-side after that point.
 * - Patient cancellation is allowed only before the configured cutoff.
 * - Once confirmed, the patient service fee is captured and never refunded;
 *   any collected consultation fee is refunded when a confirmed booking is cancelled.
 * - Pending cancellation releases the full hold because no amount has been captured.
 */
const cancelBooking = async (
  appointmentId: string,
  callerUserId?: string,
  callerRole?: string,
  reason?: string
) => {
  const booking = await prisma.bookingAppointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { include: { user: true } },
      clinic: { include: { user: true } },
      doctor: { include: { user: true } },
    },
  });

  if (!booking) {
    throw new ApiError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  await assertBookingActor(booking, callerUserId, callerRole, ["PATIENT", "DOCTOR", "CLINIC", "MANAGER", "ADMIN"]);

  if (
    booking.status === BookingStatus.CANCELLED ||
    booking.status === BookingStatus.REJECTED ||
    booking.status === BookingStatus.COMPLETE ||
    booking.status === BookingStatus.NOT_SHOW
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot cancel appointment with status ${booking.status}`
    );
  }

  // Determine who is cancelling
  const isPatient =
    callerRole === "PATIENT" ||
    (callerUserId && callerUserId === booking.patient.userId);
  const cancelledBy = isPatient
    ? "PATIENT"
    : callerRole === "DOCTOR"
    ? "DOCTOR"
    : callerRole === "CLINIC" || callerRole === "MANAGER"
    ? "CLINIC"
    : "ADMIN";

  // Case 1: If status is PENDING, simply unfreeze hold and cancel/reject
  if (booking.status === BookingStatus.PENDING) {
    const cancelReason =
      reason?.trim() || `Cancelled by ${cancelledBy.toLowerCase()}`;
    return await rejectBooking(
      appointmentId,
      cancelReason,
      callerRole || cancelledBy,
      callerUserId,
    );
  }

  // Case 2: If status is CONFIRMED, ARRIVED, or INPROGRESS
  if (
    booking.status === BookingStatus.CONFIRMED ||
    booking.status === BookingStatus.ARRIVED ||
    booking.status === BookingStatus.INPROGRESS
  ) {
    // Prevent double refunds (idempotency guard)
    if (booking.refundPatient || booking.returnPatientBalance) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Cancellation settlement has already been processed for this appointment"
      );
    }

    // 1. Patient-initiated cancellation: enforce 12-hour cutoff rule (Section 6)
    // "Patient-initiated cancellation is cancel-and-rebook: available up to 12 hours before the appointment, hard-blocked server-side after that point."
    // Dynamically computed against clinic's IANA timezone with no hardcoded offsets
    if (isPatient) {
      const platformBookingSetting = await prisma.platformBookingSetting.findFirst();
      const cutoffHours = platformBookingSetting?.cancellationCutoffHours ?? 12;
      const clinicTz = (booking.clinic as any)?.timezone || "Africa/Tripoli";
      const { isAllowed, hoursRemaining } = checkCancellationAllowed(
        booking.consultDate,
        booking.startTime,
        clinicTz,
        cutoffHours
      );

      if (!isAllowed) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `Appointments can only be cancelled at least ${cutoffHours} hours prior to the scheduled time in clinic local time (${clinicTz}). Current hours remaining: ${Math.max(
            0,
            hoursRemaining
          ).toFixed(1)}h`
        );
      }
    }

    const patientUserId = booking.patient.userId;
    const clinicUserId = booking.clinic.userId;
    const consultFee = booking.consultFee || 0;
    const collectionMode = booking.collectionMode || "MODE_A";

    // The one-policy rule takes precedence after confirmation: keep the
    // captured platform service fee; refund only the consultation amount paid
    // in Mode B. Mode A has no patient consultation charge to refund.
    const refundConsultFee = collectionMode === "MODE_B" ? consultFee : 0;
    const totalRefundToPatient = Number(refundConsultFee.toFixed(2));
    const cancelReasonText =
      reason?.trim() || `Cancelled by ${cancelledBy.toLowerCase()}`;

    const updatedBooking = await prisma.$transaction(async (tx) => {
      // Step A: In Mode B, reclaim consultation fee from clinic wallet
      if (refundConsultFee > 0 && clinicUserId) {
        await tx.user.update({
          where: { id: clinicUserId },
          data: {
            wallet: { decrement: refundConsultFee },
          },
        });

        await tx.topUp.create({
          data: {
            userId: clinicUserId,
            amount: refundConsultFee,
            appointmentId: booking.id,
            type: TopUpType.REFUND,
          },
        });
      }

      // Step B: Refund the eligible consultation amount to the patient wallet.
      if (totalRefundToPatient > 0 && patientUserId) {
        await tx.user.update({
          where: { id: patientUserId },
          data: {
            wallet: { increment: totalRefundToPatient },
          },
        });

        await tx.topUp.create({
          data: {
            userId: patientUserId,
            amount: totalRefundToPatient,
            appointmentId: booking.id,
            type: TopUpType.REFUND,
          },
        });
      }

      // Step E: Update booking record
      const claimed = await tx.bookingAppointment.updateMany({
        where: { id: appointmentId, status: booking.status },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledBy,
          cancellationReason: cancelReasonText,
          refundPatient: true,
          returnPatientBalance: true,
        },
      });
      if (claimed.count !== 1) {
        throw new ApiError(httpStatus.CONFLICT, "This booking has already been handled");
      }
      const updated = await tx.bookingAppointment.findUniqueOrThrow({
        where: { id: appointmentId },
      });

      // Step F: Explain consultation refund and retained service fee clearly.
      const refundMsg = totalRefundToPatient > 0
        ? `A consultation refund of ${totalRefundToPatient} LYD has been credited to your wallet. The captured service fee is non-refundable.`
        : "The service fee was captured when the booking was confirmed and is non-refundable.";

      await tx.patientNotification.create({
        data: {
          patientId: booking.patientId,
          bookingAppointmentId: booking.id,
          notificationType: "APPOINTMENT_CANCELLED",
          title: "Appointment Cancelled",
          description: `Your appointment with Dr. ${
            booking.doctor?.user?.fullName || "Doctor"
          } on ${new Date(
            booking.consultDate
          ).toLocaleDateString()} has been cancelled. Reason: ${cancelReasonText}. ${refundMsg}`,
        },
      });

      // Step G: Clinic notification
      if (cancelledBy !== "CLINIC") {
        await tx.clinicNotification.create({
          data: {
            clinicId: booking.clinicId,
            bookingAppointmentId: booking.id,
            notificationType: "APPOINTMENT_CANCELLED",
            title: "Appointment Cancelled",
            description: `Appointment #${booking.serialNumber} for patient ${
              booking.patient?.user?.fullName || "Patient"
            } on ${new Date(
              booking.consultDate
            ).toLocaleDateString()} was cancelled. Reason: ${cancelReasonText}.`,
          },
        });
      }

      return updated;
    });

    // Step H: Cancel BullMQ scheduled notification and timeout jobs
    try {
      await BookingSchedulerService.cancelBookingNotifications(appointmentId);
      await BookingSchedulerService.cancelPendingBookingTimeout(appointmentId);
      await BookingSchedulerService.cancelConfirmedBookingTimeout(appointmentId);
    } catch (schedErr) {
      console.error("Error cancelling scheduled jobs for cancelled booking:", schedErr);
    }

    // Step I: Broadcast real-time WebSocket event
    try {
      broadcastBookingUpdate({
        bookingId: booking.id,
        status: BookingStatus.CANCELLED,
        clinicId: booking.clinicId,
        doctorId: booking.doctorId,
        patientId: booking.patientId,
        patientUserId: patientUserId,
        clinicUserId: clinicUserId,
        reason: cancelReasonText,
        serialNumber: booking.serialNumber,
        consultDate: booking.consultDate,
      });
    } catch (wsErr) {
      console.error("WS broadcast error:", wsErr);
    }

    // Step J: FCM push notification to patient (if cancelled by clinic/doctor/admin)
    if (cancelledBy !== "PATIENT" && booking.patient?.user?.fcmToken) {
      try {
        const userLang: "ar" | "en" =
          (booking.patient?.user as any)?.language === "en" ? "en" : "ar";
        const isEn = userLang === "en";

        const rendered = await NotificationTemplateService.renderNotification(
          "BOOKING_CANCELLED",
          userLang,
          {
            doctorName:
              booking.doctor?.user?.fullName || (isEn ? "Doctor" : "الطبيب"),
            clinicName:
              booking.clinic?.clinicName || (isEn ? "Clinic" : "العيادة"),
            date: new Date(booking.consultDate).toISOString().split("T")[0],
            refundNotice: isEn
              ? `Consultation refund: ${refundConsultFee} LYD. The service fee is non-refundable.`
              : `المبلغ المسترد للاستشارة: ${refundConsultFee} دينار ليبي. رسوم الخدمة غير قابلة للاسترداد.`,
            cancelledBy: cancelledBy,
            patientName:
              booking.patient?.user?.fullName || (isEn ? "Patient" : "المريض"),
          }
        );

        if (rendered.pushEnabled) {
          await Notification.PatientNotification(
            booking.id,
            booking.patientId,
            "APPOINTMENT_CANCELLED",
            rendered.title,
            rendered.body,
            booking.patient.user.fcmToken
          );
        }
      } catch (fcmErr) {
        console.error("FCM error on cancellation:", fcmErr);
      }
    }

    return updatedBooking;
  }

  throw new ApiError(
    httpStatus.BAD_REQUEST,
    `Cannot cancel appointment with status ${booking.status}`
  );
};

const completeBooking = async (
  appointmentId: string,
  callerUserId?: string,
  callerRole?: string,
) => {
  const existing = await prisma.bookingAppointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { select: { userId: true } },
      doctor: { select: { userId: true } },
      clinic: { select: { userId: true } },
    },
  });

  if (!existing) {
    throw new ApiError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  await assertBookingActor(existing, callerUserId, callerRole, ["CLINIC", "MANAGER", "ADMIN", "SYSTEM"]);

  // Enforce valid state transitions: complete can only occur from CONFIRMED, INPROGRESS, or ARRIVED
  const validPriorStatuses: BookingStatus[] = [
    BookingStatus.CONFIRMED,
    BookingStatus.INPROGRESS,
    BookingStatus.ARRIVED,
  ];

  if (!validPriorStatuses.includes(existing.status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot complete appointment with status ${existing.status}. Valid statuses for completion: ${validPriorStatuses.join(", ")}`
    );
  }

  const completed = await prisma.bookingAppointment.updateMany({
    where: { id: appointmentId, status: { in: validPriorStatuses } },
    data: { status: BookingStatus.COMPLETE },
  });
  if (completed.count !== 1) {
    throw new ApiError(httpStatus.CONFLICT, "This booking has already been handled");
  }
  const booking = await prisma.bookingAppointment.findUniqueOrThrow({
    where: { id: appointmentId },
  });

  try {
    await BookingSchedulerService.cancelBookingNotifications(appointmentId);
    await BookingSchedulerService.cancelConfirmedBookingTimeout(appointmentId);
  } catch (schedErr) {
    console.error("Error cancelling scheduled jobs for completed booking:", schedErr);
  }

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

  try {
    broadcastBookingUpdate({
      bookingId: booking.id,
      status: BookingStatus.COMPLETE,
      clinicId: existing.clinicId,
      doctorId: existing.doctorId,
      patientId: booking.patientId,
      patientUserId: existing.patient?.userId,
      clinicUserId: existing.clinic?.userId,
      doctorUserId: existing.doctor?.userId,
      serialNumber: booking.serialNumber,
      consultDate: booking.consultDate,
    });
  } catch (wsErr) {
    console.error("WS broadcast error on completion:", wsErr);
  }

  return booking;
};

export const BookingService = {
  createBooking,
  getBookings,
  confirmBooking,
  markPatientArrived,
  rejectBooking,
  cancelBooking,
  completeBooking,
};
