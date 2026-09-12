import { Request, Response } from "express";
import httpStatus from "http-status";
import { paginationFields } from "../../../constants/pagination";
import catchAsync from "../../../shared/catchAsync";
import pick from "../../../shared/pick";
import sendResponse from "../../../shared/sendResponse";
import { Notification } from "./notification.service";

const getDoctorNotification = catchAsync(async (req: Request, res: Response) => {
    const doctorId = req.user?.id;
    const filters = pick(req.query, ['search']);
    const options = pick(req.query, paginationFields);

    const result = await Notification.getDoctorNotification(doctorId!, filters, options);

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Doctor notifications retrieved successfully",
        data: result,
    });
});

const getClinicNotification = catchAsync(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const filters = pick(req.query, ['search']);
    const options = pick(req.query, paginationFields);

    const result = await Notification.getClinicNotification(userId!, filters, options);

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Clinic notifications retrieved successfully",
        data: result,
    });
});

const getPatientNotification = catchAsync(async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const filters = pick(req.query, ['search']);
    const options = pick(req.query, paginationFields);

    const result = await Notification.getPatientNotification(userId!, filters, options);

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Patient notifications retrieved successfully",
        data: result,
    });
});

export const NotificationController = {
    getDoctorNotification,
    getClinicNotification,
    getPatientNotification
};
