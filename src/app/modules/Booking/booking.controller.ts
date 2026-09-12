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

  const result = await BookingService.getBookings(userId!, role!, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Bookings retrieved successfully",
    data: result,
  });
});

const confirmBooking = catchAsync(async (req: Request, res: Response) => {
  const { appointmentId } = req.params;

  const result = await BookingService.confirmBooking(appointmentId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Booking confirmed successfully. Notifications scheduled.",
    data: result,
  });
});

const cancelBooking = catchAsync(async (req: Request, res: Response) => {
  const { appointmentId } = req.params;

  const result = await BookingService.cancelBooking(appointmentId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Booking cancelled successfully. Notifications removed.",
    data: result,
  });
});

const completeBooking = catchAsync(async (req: Request, res: Response) => {
  const { appointmentId } = req.params;

  const result = await BookingService.completeBooking(appointmentId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Booking completed successfully.",
    data: result,
  });
});

export const BookingController = {
  createBooking,
  getBookings,
  confirmBooking,
  cancelBooking,
  completeBooking,
};
