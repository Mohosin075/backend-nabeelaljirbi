import { BookingStatus } from "@prisma/client";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { BookingInterface } from "./booking.interface";
import { BookingSchedulerService } from "../../jobs/services/bookingScheduler.service";


const createBooking = async (patientId: string, payload: BookingInterface) => {
  const { clinicId, doctorId, workingSlotId, consultDate } = payload;

  // Check if doctor works on that day
  const workingHours = await prisma.workingHours.findFirst({
    where: {
      doctorId,
      // day: new Date(consultDate).toLocaleDateString("en-US", { weekday: "long" }),
      // slots: { has: time },
    },
  });
  if (!workingHours) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Doctor not available at this time"
    );
  }

  // Check capacity
  const existingBookings = await prisma.bookingAppointment.count({
    where: {
      doctorId,
      consultDate: new Date(consultDate),
      // time,
      status: { in: [BookingStatus.PENDING, BookingStatus.INPROGRESS] },
    },
  });
  if (existingBookings >= workingHours.capacity) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Slot is full");
  }

  // Get serial number
  const lastBooking = await prisma.bookingAppointment.findFirst({
    // where: { doctorId, date: new Date(date), time },
    orderBy: { serialNumber: "desc" },
  });
  const serialNumber = lastBooking ? lastBooking.serialNumber + 1 : 1;


  // Get working slot
  const workingSlot = await prisma.workingSlot.findFirst({
    where: {
      id: payload.workingSlotId,
    },
  });

  if (!workingSlot) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Invalid working slot");
  }

  const booking = await prisma.bookingAppointment.create({
    data: {
      clinicId,
      doctorId,
      patientId,
      serialNumber,
      consultDate: payload.consultDate,
      startTime: workingSlot.startTime,
      endTime: workingSlot.endTime,
      clinicServiceFee: 0,
      patientServiceFee: 0,
      status: BookingStatus.PENDING,
    },
  });

  // Create patient notification
  await prisma.patientNotification.create({
    data: {
      patientId: booking.patientId,
      bookingAppointmentId: booking.id,
      notificationType: 'APPOINTMENT_PENDING',
      title: 'Appointment Booked',
      description: `Your appointment request for ${new Date(booking.consultDate).toLocaleDateString()} has been received and is pending confirmation.`,
    },
  });

  return booking;
};

const getBookings = async (userId: string, role: string, options: any) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);

  let where: any = {};
  if (role === "PATIENT") {
    where.patientId = userId;
  } else if (role === "DOCTOR") {
    where.doctorId = userId;
  } else if (role === "CLINIC") {
    where.clinicId = userId;
  }

  const bookings = await prisma.bookingAppointment.findMany({
    where,
    include: {
      patient: true,
      doctor: true,
      clinic: true,
    },
    skip,
    take: limit,
    orderBy: {
      [sortBy]: sortOrder,
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

const confirmBooking = async (appointmentId: string) => {
  // Update booking status to CONFIRMED
  const booking = await prisma.bookingAppointment.update({
    where: { id: appointmentId },
    data: { status: BookingStatus.CONFIRMED },
  });

  // Schedule notifications for 24 hours and 3 hours before appointment
  await BookingSchedulerService.scheduleBookingNotifications({
    appointmentId: booking.id,
    patientId: booking.patientId,
    doctorId: booking.doctorId,
    clinicId: booking.clinicId,
    consultDate: booking.consultDate,
    startTime: booking.startTime!,
    endTime: booking.endTime!,
    status: booking.status,
  });

  // Create patient notification
  await prisma.patientNotification.create({
    data: {
      patientId: booking.patientId,
      bookingAppointmentId: booking.id,
      notificationType: 'APPOINTMENT_CONFIRMED',
      title: 'Appointment Confirmed',
      description: `Your appointment on ${new Date(booking.consultDate).toLocaleDateString()} at ${booking.startTime} has been confirmed.`,
    },
  });

  return booking;
};

const cancelBooking = async (appointmentId: string) => {
  // Update booking status to CANCELLED
  const booking = await prisma.bookingAppointment.update({
    where: { id: appointmentId },
    data: { status: BookingStatus.CANCELLED },
  });

  // Cancel all scheduled reminders and lifecycle jobs
  await BookingSchedulerService.cancelBookingNotifications(appointmentId);
  await BookingSchedulerService.cancelPendingBookingTimeout(appointmentId);
  await BookingSchedulerService.cancelConfirmedBookingTimeout(appointmentId);

  // Create patient notification
  await prisma.patientNotification.create({
    data: {
      patientId: booking.patientId,
      bookingAppointmentId: booking.id,
      notificationType: 'APPOINTMENT_CANCELLED',
      title: 'Appointment Cancelled',
      description: `Your appointment on ${new Date(booking.consultDate).toLocaleDateString()} has been cancelled.`,
    },
  });

  return booking;
};

const completeBooking = async (appointmentId: string) => {
  // Update booking status to COMPLETE
  const booking = await prisma.bookingAppointment.update({
    where: { id: appointmentId },
    data: { status: BookingStatus.COMPLETE },
  });

  // Cancel any remaining scheduled reminders and lifecycle jobs
  await BookingSchedulerService.cancelBookingNotifications(appointmentId);
  await BookingSchedulerService.cancelConfirmedBookingTimeout(appointmentId);

  // Create patient notification
  await prisma.patientNotification.create({
    data: {
      patientId: booking.patientId,
      bookingAppointmentId: booking.id,
      notificationType: 'APPOINTMENT_COMPLETED',
      title: 'Appointment Completed',
      description: `Your appointment on ${new Date(booking.consultDate).toLocaleDateString()} has been completed. Thank you!`,
    },
  });

  return booking;
};

export const BookingService = {
  createBooking,
  getBookings,
  confirmBooking,
  cancelBooking,
  completeBooking,
};
