import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { RatingService } from "./rating.service";

const createRating = catchAsync(async (req: Request, res: Response) => {
  const patientId = req.user?.id;
  const { appointmentId, rating } = req.body;

  const result = await RatingService.createRating(patientId!, { appointmentId, rating });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Rating created successfully",
    data: result,
  });
});

const getRatingsForDoctor = catchAsync(async (req: Request, res: Response) => {
  const { doctorId } = req.params;

  const result = await RatingService.getRatingsForDoctor(doctorId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Ratings retrieved successfully",
    data: result,
  });
});

export const RatingController = {
  createRating,
  getRatingsForDoctor,
};
