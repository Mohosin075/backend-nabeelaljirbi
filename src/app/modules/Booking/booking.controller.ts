import { Request, Response } from "express";
import httpStatus from "http-status";
import { paginationFields } from "../../../constants/pagination";
import catchAsync from "../../../shared/catchAsync";
import pick from "../../../shared/pick";
import sendResponse from "../../../shared/sendResponse";
import { BookingService } from "./booking.service";

const createBooking = catchAsync(async (req: Request, res: Response) => {
  const patientId = req.user?.id;
  const payload = req.body;

  const result = await BookingService.createBooking(patientId!, payload);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Booking created successfully",
    data: result,
  });
});

const getBookings = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const role = req.user?.role;
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["status", "doctorId", "clinicId", "date", "searchTerm"]);

  const result = await BookingService.getBookings(userId!, role!, { ...options, ...filters });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Bookings retrieved successfully",
    data: result,
  });
});

const confirmBooking = catchAsync(async (req: Request, res: Response) => {
  const { appointmentId } = req.params;

  const result = await BookingService.confirmBooking(appointmentId, req.user?.id, req.user?.role);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Booking confirmed successfully. Notifications scheduled.",
    data: result,
  });
});

const cancelBooking = catchAsync(async (req: Request, res: Response) => {
  const { appointmentId } = req.params;
  const userId = req.user?.id;
  const role = req.user?.role;
  const { reason } = req.body; // Issue #4 fix: pass reason through

  const result = await BookingService.cancelBooking(appointmentId, userId, role, reason);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Booking cancelled successfully. Notifications removed.",
    data: result,
  });
});

const completeBooking = catchAsync(async (req: Request, res: Response) => {
  const { appointmentId } = req.params;

  const result = await BookingService.completeBooking(appointmentId, req.user?.id, req.user?.role);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Booking completed successfully.",
    data: result,
  });
});

const rejectBooking = catchAsync(async (req: Request, res: Response) => {
  const { appointmentId } = req.params;
  const { reason } = req.body;

  const result = await BookingService.rejectBooking(
    appointmentId,
    reason,
    req.user?.role || "CLINIC",
    req.user?.id,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Booking request rejected successfully. Frozen funds released.",
    data: result,
  });
});

export const BookingController = {
  createBooking,
  getBookings,
  confirmBooking,
  rejectBooking,
  cancelBooking,
  completeBooking,
};
