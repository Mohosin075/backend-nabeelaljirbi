import { Request, Response } from "express";
import httpStatus from "http-status";
import { paginationFields } from "../../../constants/pagination";
import catchAsync from "../../../shared/catchAsync";
import pick from "../../../shared/pick";
import sendResponse from "../../../shared/sendResponse";
import { ClinicService } from "./clinic.service";
import { fileUploadToS3 } from "../../../helpars/s3Bucket/fileUploadToS3";
import ApiError from "../../../errors/ApiErrors";

const updateClinicProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  let logoUrl = "";

  // Upload clinic logo if provided
  if (req.file) {
    const file = req.file;
    const uploadedUrl = await fileUploadToS3(
      "profile",
      "clinic",
      file.originalname,
      file.mimetype,
      file.path,
    );
    logoUrl = uploadedUrl;
  }

  // Parse payload
  let payload;
  if (req.body.data) {
    payload = JSON.parse(req.body.data);
  } else {
    payload = req.body;
  }

  const clinicData = { ...payload, ...(logoUrl && { logo: logoUrl }) };

  const result = await ClinicService.updateClinicProfile(userId!, clinicData);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic profile updated successfully",
    data: result,
  });
});

const getClinicProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;

  const result = await ClinicService.getClinicProfile(userId!);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic profile retrieved successfully",
    data: result,
  });
});

const createClinicSpecialist = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const { specialistId } = req.body;

  const result = await ClinicService.createClinicSpecialist(
    userId,
    specialistId,
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Clinic specialist created successfully",
    data: result,
  });
});

const deleteClinicSpecialist = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const specialistId = req.params.id;

  const result = await ClinicService.deleteClinicSpecialist(
    userId,
    specialistId,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic specialist deleted successfully",
    data: result,
  });
});

const getClinicSpecialists = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const options = pick(req.query, paginationFields);

  const result = await ClinicService.getClinicSpecialists(userId!, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic specialists retrieved successfully",
    data: result,
  });
});

const createClinicInsurance = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const { insuranceId } = req.body;

  const result = await ClinicService.createClinicInsurance(userId, insuranceId);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Clinic insurance created successfully",
    data: result,
  });
});

const getClinicInsurances = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const options = pick(req.query, paginationFields);

  const result = await ClinicService.getClinicInsurances(userId!, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic insurances retrieved successfully",
    data: result,
  });
});

const deleteClinicInsurance = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const insuranceId = req.params.id;

  const result = await ClinicService.deleteClinicInsurance(userId, insuranceId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic insurance deleted successfully",
    data: result,
  });
});

const createPhotoGallery = catchAsync(async (req, res) => {
  const userId = req.user.id;

  const files = req.files as
    | { images?: Express.Multer.File[]; image?: Express.Multer.File[] }
    | undefined;

  const galleryFiles = [
    ...(files?.images || []),
    ...(files?.image || []),
    ...(req.file ? [req.file] : []),
  ];

  if (!galleryFiles.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Gallery photos are required");
  }

  const imageUrls = await Promise.all(
    galleryFiles.map((file) =>
      fileUploadToS3(
        "clinic",
        "gallery",
        file.originalname,
        file.mimetype,
        file.path,
      ),
    ),
  );

  const result = await ClinicService.createPhotoGallery(userId, imageUrls);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Photos added successfully",
    data: result,
  });
});

const getPhotoGalleries = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const options = pick(req.query, paginationFields);

  const result = await ClinicService.getPhotoGalleries(userId!, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Photo galleries retrieved successfully",
    data: result,
  });
});

const deletePhotoGallery = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const galleryId = req.params.id;

  const result = await ClinicService.deletePhotoGallery(userId, galleryId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Photo gallery deleted successfully",
    data: result,
  });
});

const clearPhotoGalleries = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const galleryIds = req.body.galleryIds;

  const result = await ClinicService.clearPhotoGalleries(userId, galleryIds);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Selected photo galleries deleted successfully",
    data: result,
  });
});

const updateBookingStatus = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { bookingId, status } = req.body;

  const result = await ClinicService.updateBookingStatus(
    userId!,
    bookingId,
    status,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Booking status updated successfully",
    data: result,
  });
});

const getBookingHistory = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, [
    "searchTerm",
    "status",
    "doctorId",
    "consultDate",
  ]);

  const result = await ClinicService.getBookingHistory(
    userId!,
    filters,
    options,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Booking history retrieved successfully",
    data: result,
  });
});

const getClinicManagerStats = catchAsync(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const result = await ClinicService.getClinicManagerStats(userId);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Clinic stats retrieved successfully",
      data: result,
    });
  },
);

const updateAppointmentStatus = catchAsync(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const { bookingId, status } = req.body;

    const result = await ClinicService.updateAppointmentStatus(
      userId,
      bookingId,
      status,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Appointment status updated successfully",
      data: result,
    });
  },
);

const managerUpdateAppointmentStatus = catchAsync(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const { bookingId, status } = req.body;

    const result = await ClinicService.managerUpdateAppointmentStatus(
      userId,
      bookingId,
      status,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Appointment status updated successfully",
      data: result,
    });
  },
);

const getClinicStats = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await ClinicService.getClinicStats(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic stats retrieved successfully",
    data: result,
  });
});

const getClinicDoctor = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, [
    "search",
    "rating",
    "consultFee",
    "specialty",
  ]);

  const result = await ClinicService.getClinicDoctor(userId, filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinic doctors retrieved successfully",
    data: result,
  });
});

const removeDoctorFromClinic = catchAsync(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const { doctorId } = req.params;

    const result = await ClinicService.removeDoctorFromClinic(doctorId, userId);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctor removed from clinic successfully",
      data: result,
    });
  },
);

const getDoctorAppointments = catchAsync(
  async (req: Request, res: Response) => {
    const clinicId = req.user.id;
    const doctorId = req.params.doctorId;
    const options = pick(req.query, paginationFields);
    const filters = pick(req.query, ["searchTerm", "doctorId", "status"]);

    const result = await ClinicService.getDoctorAppointments(
      doctorId,
      clinicId,
      filters,
      options,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctor appointments retrieved successfully",
      data: result,
    });
  },
);

const getClinics = catchAsync(async (req: Request, res: Response) => {
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["searchTerm", "adminVerified"]);

  const result = await ClinicService.getClinics(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Clinics retrieved successfully",
    data: result,
  });
});

const getManagerBookingHistory = catchAsync(
  async (req: Request, res: Response) => {
    const clinicId = req.user?.id;
    const options = pick(req.query, paginationFields);
    const filters = pick(req.query, [
      "searchTerm",
      "status",
      "doctorId",
      "consultDate",
    ]);

    const result = await ClinicService.getManagerBookingHistory(
      clinicId!,
      filters,
      options,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Manager booking history retrieved successfully",
      data: result,
    });
  },
);

const getClinicManagerDoctor = catchAsync(
  async (req: Request, res: Response) => {
    const clinicId = req.user.id;
    const options = pick(req.query, paginationFields);
    const filters = pick(req.query, ["searchTerm", "status", "doctorId"]);

    const result = await ClinicService.getClinicManagerDoctor(
      clinicId,
      filters,
      options,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Manager booking history retrieved successfully",
      data: result,
    });
  },
);

export const ClinicController = {
  updateClinicProfile,
  getClinicProfile,
  createClinicSpecialist,
  getClinicSpecialists,
  createClinicInsurance,
  getClinicInsurances,
  deleteClinicSpecialist,
  deleteClinicInsurance,
  createPhotoGallery,
  getPhotoGalleries,
  deletePhotoGallery,
  clearPhotoGalleries,
  updateBookingStatus,
  getBookingHistory,
  getClinicManagerStats,
  updateAppointmentStatus,
  managerUpdateAppointmentStatus,
  getClinicStats,
  getClinicDoctor,
  getClinicManagerDoctor,
  removeDoctorFromClinic,
  getDoctorAppointments,
  getClinics,
  getManagerBookingHistory,
};
