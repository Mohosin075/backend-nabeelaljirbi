import { Request, Response } from "express";
import httpStatus from "http-status";
import { paginationFields } from "../../../constants/pagination";
import catchAsync from "../../../shared/catchAsync";
import pick from "../../../shared/pick";
import sendResponse from "../../../shared/sendResponse";
import { PatientService } from "./patient.service";
import { fileUploadToS3 } from "../../../helpars/s3Bucket/fileUploadToS3";

const updatePatientProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
    let profileImage = "";

  if (req.file) {
    const file = req.file;

    const uploadedUrl = await fileUploadToS3(
      "profile",
      "patient",
      file.originalname,
      file.mimetype,
      file.path
    );

    profileImage = uploadedUrl;
  }

  console.log("profileImage: ",profileImage);

  const parsedData = JSON.parse(req.body.data);

  const productData = { ...parsedData, profileImage: profileImage };

  const result = await PatientService.updatePatientProfile(userId, productData);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient profile updated successfully",
    data: result,
  });
});

const getPatientProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;

  const result = await PatientService.getPatientProfile(userId!);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient profile retrieved successfully",
    data: result,
  });
});

const getPopularDoctors = catchAsync(async (req: Request, res: Response) => {
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["search", "rating", "consultFee", "city", "country", "speciality"]);

  const result = await PatientService.getPopularDoctors(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Popular doctors retrieved successfully",
    data: result,
  });
});


const getNearestClinics = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
    const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["search", "rating", "consultFee", "city", "country", "speciality"]);


  const result = await PatientService.getNearestClinics(
    userId!,
    filters,
    options
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Nearest clinics retrieved successfully",
    data: result,
  });
});

const getClinicDetailsById = catchAsync(async (req: Request, res: Response) => {
  const clinicUserId = req.params.clinicUserId;

  const result = await PatientService.getClinicDetailsById(clinicUserId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic details retrieved successfully",
    data: result,
  });
});

const getClinicDoctors = catchAsync(async (req: Request, res: Response) => {
  const { clinicUserId } = req.params;
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, [
    "search",
    "rating",
    "consultFee",
    "speciality",
    "city",
    "country",
  ]);

  const result = await PatientService.getClinicDoctors(
    clinicUserId,
    filters,
    options
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic doctors retrieved successfully",
    data: result,
  });
});


const getDoctor = catchAsync(async (req: Request, res: Response) => {
  const doctorId = req.params.doctorId;

  const result = await PatientService.getDoctor(doctorId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor details retrieved successfully",
    data: result,
  });
});


const bookingAppointment = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;

  const { clinicId, doctorId, workingSlotId, consultDate } = req.body;

  const result = await PatientService.bookingAppointment(userId!, clinicId, doctorId, workingSlotId, consultDate);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment booked successfully",
    data: result,
  });
});

const cancelAppointment = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { bookingId } = req.params;

  const result = await PatientService.cancelAppointment(userId!, bookingId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment cancelled successfully",
    data: result,
  });
});

const acceptAppointment = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { bookingId } = req.params;

  const result = await PatientService.acceptAppointment(userId!, bookingId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment confirmed successfully",
    data: result,
  });
});

const getAppointmentHistory = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const options = pick(req.query, paginationFields);

  const result = await PatientService.getAppointmentHistory(userId!, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment history retrieved successfully",
    data: result,
  });
});


const createPatientInsurance = catchAsync(async (req, res) => {
  const userId = req.user.id;
  let imageUrl = "";

  if (req.file) {
    imageUrl = await fileUploadToS3(
      "clinic",
      "insurance",
      req.file.originalname,
      req.file.mimetype,
      req.file.path
    );
  }

  const bodyData = req.body.data ? JSON.parse(req.body.data) : req.body;

  const payload = {
    insuranceDetails: bodyData.insuranceDetails,
    image: imageUrl,
  };

  const result = await PatientService.createPatientInsurance(userId, payload);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Patient insurance created successfully",
    data: result,
  });
});

const updatePatientInsurance = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { insuranceId } = req.params;
  let imageUrl: string | undefined = undefined;

  if (req.file) {
    imageUrl = await fileUploadToS3(
      "clinic",
      "insurance",
      req.file.originalname,
      req.file.mimetype,
      req.file.path
    );
  }

  const bodyData = req.body.data ? JSON.parse(req.body.data) : req.body;

  const payload = {
    ...(bodyData.insuranceDetails && { insuranceDetails: bodyData.insuranceDetails }),
    ...(imageUrl && { image: imageUrl }),
  };

  const result = await PatientService.updatePatientInsurance(userId, insuranceId, payload);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient insurance updated successfully",
    data: result,
  });
});

const deletePatientInsurance = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { insuranceId } = req.params;

  const result = await PatientService.deletePatientInsurance(userId, insuranceId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient insurance deleted successfully",
    data: result,
  });
});

const getPatientInsurance = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;

  const result = await PatientService.getPatientInsurance(userId!);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Patient insurance retrieved successfully",
    data: result,
  });
});

export const PatientController = {
  updatePatientProfile,
  getPatientProfile,
  getPopularDoctors,
  getNearestClinics,
  getClinicDetailsById,
  getClinicDoctors,
  getDoctor,
  bookingAppointment,
  cancelAppointment,
  acceptAppointment,
  getAppointmentHistory,
  createPatientInsurance,
  updatePatientInsurance,
  deletePatientInsurance,
  getPatientInsurance
};

