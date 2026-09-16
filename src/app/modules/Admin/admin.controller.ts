import { Request, Response } from "express";
import httpStatus from "http-status";
import { paginationFields } from "../../../constants/pagination";
import catchAsync from "../../../shared/catchAsync";
import pick from "../../../shared/pick";
import sendResponse from "../../../shared/sendResponse";
import { AdminService } from "./admin.service";

const AdminStats = catchAsync(async (req: Request, res: Response) => {
    const result = await AdminService.AdminStats();
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Admin stats retrieved successfully",
      data: result,
    });
  });

const getDoctors = catchAsync(async (req: Request, res: Response) => {
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["searchTerm", "search", "speciality", "clinicId"]) as any;
  if (req.query.search && !filters.searchTerm) {
    filters.searchTerm = req.query.search;
  }

  const result = await AdminService.getDoctors(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctors retrieved successfully",
    data: result,
  });
});

const getPatients = catchAsync(async (req: Request, res: Response) => {
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["searchTerm", "search"]) as any;
  if (req.query.search && !filters.searchTerm) {
    filters.searchTerm = req.query.search;
  }

  const result = await AdminService.getPatients(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patients retrieved successfully",
    data: result,
  });
});

const getClinics = catchAsync(async (req: Request, res: Response) => {
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["searchTerm", "search", "adminVerified"]) as any;
  if (req.query.search && !filters.searchTerm) {
    filters.searchTerm = req.query.search;
  }

  const result = await AdminService.getClinics(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinics retrieved successfully",
    data: result,
  });
});

const AdminClinicVerified = catchAsync(async (req: Request, res: Response) => {
  const { clinicId } = req.params;

  const { adminVerified } = req.body;

  const result = await AdminService.AdminClinicVerified(clinicId, adminVerified);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Clinic ${adminVerified ? "verified" : "unverified"} successfully`,
    data: result,
  });
});

const bannedUser = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.params;

  const { banned } = req.body;

  const result = await AdminService.bannedUser(userId, banned);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `User ${banned ? "banned" : "unbanned"} successfully`,
    data: result,
  });
});

const getPatientPlatformSubscription = catchAsync(async (req: Request, res: Response) => {
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["searchTerm", "banned"]);

  const result = await AdminService.getPatientPlatformSubscription(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient platform subscriptions retrieved successfully",
    data: result,
  });
});

const getClinicPlatformSubscription = catchAsync(async (req: Request, res: Response) => {
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["searchTerm", "banned", "adminVerified"]);

  const result = await AdminService.getClinicPlatformSubscription(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic platform subscriptions retrieved successfully",
    data: result,
  });
});

const SetServiceFree = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.params;

  const { serviceFree } = req.body;

  const result = await AdminService.SetServiceFree(userId, serviceFree);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Service free set successfully",
    data: result,
  });
});

const updateWallet = catchAsync(async (req: Request, res: Response) => {

  const { amount, userId } = req.body;

  const result = await AdminService.updateWallet(userId, amount);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Wallet updated successfully",
    data: result,
  });
});

const patientNotification = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.createPatientNotification(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient notification sent successfully",
    data: result,
  });
});

const clinicNotification = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.createClinicNotification(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic notification sent successfully",
    data: result,
  });
});

export const AdminController = {
  getDoctors,
  getPatients,
  getClinics,
  AdminClinicVerified,
  AdminStats,
  bannedUser,
  getPatientPlatformSubscription,
  getClinicPlatformSubscription,
  SetServiceFree,
  updateWallet,
  patientNotification,
  clinicNotification
};
