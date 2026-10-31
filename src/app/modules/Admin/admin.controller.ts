import { Request, Response } from "express";
import httpStatus from "http-status";
import { paginationFields } from "../../../constants/pagination";
import catchAsync from "../../../shared/catchAsync";
import pick from "../../../shared/pick";
import sendResponse from "../../../shared/sendResponse";
import ApiError from "../../../errors/ApiErrors";
import { BookingStatus } from "@prisma/client";
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
  const filters = pick(req.query, ["searchTerm", "search", "speciality", "clinicId", "adminVerified"]) as any;
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

  const result = await AdminService.AdminClinicVerified(clinicId, adminVerified, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Clinic ${adminVerified ? "verified" : "unverified"} successfully`,
    data: result,
  });
});

const AdminDoctorVerified = catchAsync(async (req: Request, res: Response) => {
  const { doctorId } = req.params;
  const { adminVerified } = req.body;

  const result = await AdminService.AdminDoctorVerified(doctorId, adminVerified, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Doctor ${adminVerified ? "verified" : "unverified"} successfully`,
    data: result,
  });
});

const bannedUser = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { banned, reason } = req.body;

  const result = await AdminService.bannedUser(userId, banned, reason, (req as any).user);

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

  const result = await AdminService.SetServiceFree(userId, serviceFree, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Service free set successfully",
    data: result,
  });
});

const updateWallet = catchAsync(async (req: Request, res: Response) => {
  const { amount, userId } = req.body;

  const result = await AdminService.updateWallet(userId, amount, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Wallet updated successfully",
    data: result,
  });
});

const patientNotification = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.createPatientNotification(req.body, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient notification sent successfully",
    data: result,
  });
});

const clinicNotification = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.createClinicNotification(req.body, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic notification sent successfully",
    data: result,
  });
});

const suspendDoctor = catchAsync(async (req: Request, res: Response) => {
  const { doctorId } = req.params;
  const { suspended, reason } = req.body;

  const result = await AdminService.suspendDoctor(doctorId, suspended !== false, reason, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.message,
    data: result,
  });
});

const suspendClinic = catchAsync(async (req: Request, res: Response) => {
  const { clinicId } = req.params;
  const { suspended, reason } = req.body;

  const result = await AdminService.suspendClinic(clinicId, suspended !== false, reason, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.message,
    data: result,
  });
});

const overrideAppointmentStatus = catchAsync(async (req: Request, res: Response) => {
  const { appointmentId } = req.params;
  const { status, reason } = req.body;

  if (!status || !Object.values(BookingStatus).includes(status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Valid status is required. Allowed values: ${Object.values(BookingStatus).join(", ")}`
    );
  }

  const result = await AdminService.overrideAppointmentStatus(
    appointmentId,
    status,
    reason,
    (req as any).user
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment status overridden successfully by admin",
    data: result,
  });
});

// Section 9: Clinic Visibility
const updateClinicVisibility = catchAsync(async (req: Request, res: Response) => {
  const { clinicId } = req.params;
  const { isVisible } = req.body;

  const result = await AdminService.updateClinicVisibility(
    clinicId,
    isVisible !== false,
    (req as any).user
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Clinic visibility set to ${isVisible !== false ? "Visible" : "Hidden"} successfully`,
    data: result,
  });
});

// Section 9: Admin Staff Management (5 Tiers)
const getAdminStaff = catchAsync(async (req: Request, res: Response) => {
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["searchTerm", "adminTier", "status"]);

  const result = await AdminService.getAdminStaff(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Admin staff retrieved successfully",
    data: result,
  });
});

const createAdminStaff = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.createAdminStaff(req.body, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Admin staff created successfully",
    data: result,
  });
});

const updateAdminStaffTier = catchAsync(async (req: Request, res: Response) => {
  const { staffId } = req.params;
  const { adminTier } = req.body;

  const result = await AdminService.updateAdminStaffTier(staffId, adminTier, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Admin staff tier updated successfully",
    data: result,
  });
});

const toggleAdminStaffStatus = catchAsync(async (req: Request, res: Response) => {
  const { staffId } = req.params;
  const { status } = req.body;

  const result = await AdminService.toggleAdminStaffStatus(staffId, status, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Admin staff status updated to ${status} successfully`,
    data: result,
  });
});

// Section 9: Audit Logs
const getAuditLogs = catchAsync(async (req: Request, res: Response) => {
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, [
    "searchTerm",
    "action",
    "targetType",
    "adminId",
    "startDate",
    "endDate",
  ]);

  const result = await AdminService.getAuditLogs(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Audit logs retrieved successfully",
    data: result,
  });
});

// Section 9: Booking Settings
const getBookingSettings = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.getBookingSettings();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Platform booking settings retrieved successfully",
    data: result,
  });
});

const updateBookingSettings = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.updateBookingSettings(req.body, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Platform booking settings updated successfully",
    data: result,
  });
});

// Section 9: Platform Financials Overview
const getPlatformFinancialOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.getPlatformFinancialOverview();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Platform financial overview retrieved successfully",
    data: result,
  });
});

// Section 10: Traceable Financial Ledger
const getFinancialLedger = catchAsync(async (req: Request, res: Response) => {
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["searchTerm", "category", "type", "startDate", "endDate"]);

  const result = await AdminService.getFinancialLedger(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Financial ledger retrieved successfully",
    meta: result.meta,
    data: {
      summary: result.summary,
      transactions: result.data,
      meta: result.meta,
    },
  });
});

// Section 9: Settlements
const getSettlements = catchAsync(async (req: Request, res: Response) => {
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["searchTerm", "status", "partyType", "clinicId", "doctorId", "startDate", "endDate", "payoutMethod"]);

  const result = await AdminService.getSettlements(filters, options, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Settlements retrieved successfully",
    data: result,
  });
});

const createSettlement = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.createSettlement(req.body, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Settlement request created successfully",
    data: result,
  });
});

const updateSettlementStatus = catchAsync(async (req: Request, res: Response) => {
  const { settlementId } = req.params;
  const result = await AdminService.updateSettlementStatus(
    settlementId,
    req.body,
    (req as any).user
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Settlement status updated successfully",
    data: result,
  });
});

// Section 9: Complaints
const getComplaints = catchAsync(async (req: Request, res: Response) => {
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["searchTerm", "status", "targetType", "startDate", "endDate"]);

  const result = await AdminService.getComplaints(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Complaints retrieved successfully",
    data: result,
  });
});

const getComplaintById = catchAsync(async (req: Request, res: Response) => {
  const { complaintId } = req.params;
  const result = await AdminService.getComplaintById(complaintId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Complaint retrieved successfully",
    data: result,
  });
});

const createComplaint = catchAsync(async (req: Request, res: Response) => {
  const result = await AdminService.createComplaint(req.body, (req as any).user);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Complaint submitted successfully",
    data: result,
  });
});

const resolveComplaint = catchAsync(async (req: Request, res: Response) => {
  const { complaintId } = req.params;
  const result = await AdminService.resolveComplaint(
    complaintId,
    req.body,
    (req as any).user
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Complaint resolved successfully",
    data: result,
  });
});

export const AdminController = {
  getDoctors,
  getPatients,
  getClinics,
  AdminClinicVerified,
  AdminDoctorVerified,
  updateClinicVisibility,
  AdminStats,
  bannedUser,
  suspendDoctor,
  suspendClinic,
  getPatientPlatformSubscription,
  getClinicPlatformSubscription,
  SetServiceFree,
  updateWallet,
  patientNotification,
  clinicNotification,
  overrideAppointmentStatus,
  // Section 9 controllers:
  getAdminStaff,
  createAdminStaff,
  updateAdminStaffTier,
  toggleAdminStaffStatus,
  getAuditLogs,
  getBookingSettings,
  updateBookingSettings,
  getPlatformFinancialOverview,
  getFinancialLedger,
  getSettlements,
  createSettlement,
  updateSettlementStatus,
  getComplaints,
  getComplaintById,
  createComplaint,
  resolveComplaint,
};
