import { Request, Response } from "express";
import httpStatus from "http-status";
import { paginationFields } from "../../../constants/pagination";
import catchAsync from "../../../shared/catchAsync";
import pick from "../../../shared/pick";
import sendResponse from "../../../shared/sendResponse";
import { DoctorService } from "./doctor.service";

import { fileUploadToS3 } from "../../../helpars/s3Bucket/fileUploadToS3";
import ApiError from "../../../errors/ApiErrors";
import { doctorValidation } from "./doctor.validation";

const updateDoctorProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;

  let profileImage = "";
  let biography = "";

  const files = req.files as {
    profilePicture?: Express.Multer.File[];
    biography?: Express.Multer.File[];
  };

  // ✅ Profile Picture Upload
  if (files?.profilePicture?.length) {
    const file = files.profilePicture[0];

    const uploadedUrl = await fileUploadToS3(
      "profile",
      "doctor",
      file.originalname,
      file.mimetype,
      file.path
    );

    profileImage = uploadedUrl;
  }

  // ✅ Biography File Upload (if it's a file)
  if (files?.biography?.length) {
    const file = files.biography[0];

    const uploadedUrl = await fileUploadToS3(
      "profile",
      "doctor",
      file.originalname,
      file.mimetype,
      file.path
    );

    biography = uploadedUrl;
  }

  // ✅ Parse body (multipart sends the profile as a JSON string in `data`)
  let rawPayload: unknown;
  if (req.body.data) {
    try {
      rawPayload = JSON.parse(req.body.data);
    } catch {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid profile data format");
    }
  } else {
    rawPayload = req.body;
  }

  // ✅ Validate (throws ZodError -> 400 with field-level errorMessages)
  const payload: Record<string, any> =
    await doctorValidation.updateDoctorProfileValidationSchema.parseAsync(
      rawPayload ?? {}
    );

  // Prisma stores experience as text; some clients send a number.
  if (typeof payload.experience === "number") {
    payload.experience = String(payload.experience);
  }

  const doctorData = {
    ...payload,
    ...(profileImage && { profileImage }),
    ...(biography && { biography }),
  };

  const result = await DoctorService.updateDoctorProfile(userId!, doctorData);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor profile updated successfully",
    data: result,
  });
});

const getDoctorProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;

  const result = await DoctorService.getDoctorProfile(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor profile retrieved successfully",
    data: result,
  });
});



const addWorkingHours = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const payload = req.body;

  const result = await DoctorService.addWorkingHours(userId, payload);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Working hours saved successfully",
    data: result,
  });
});


const getWorkingHoursByDay = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;

  const result = await DoctorService.getWorkingHoursByDay(
    userId,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Working hours retrieved successfully`,
    data: result,
  });
});



const getAppointments = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const options = pick(req.query, paginationFields);
  const filters = pick(req.query, ["searchTerm", "status"]);

  const result = await DoctorService.getAppointments(userId!, filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointments retrieved successfully",
    data: result,
  });
});


const createDoctorInsurance = catchAsync(async (req: Request, res: Response) => {
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

  const result = await DoctorService.createDoctorInsurance(userId, payload);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Doctor insurance created successfully",
    data: result,
  });
});

const updateDoctorInsurance = catchAsync(async (req: Request, res: Response) => {
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

  const result = await DoctorService.updateDoctorInsurance(userId, insuranceId, payload);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor insurance updated successfully",
    data: result,
  });
});

const deleteDoctorInsurance = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { insuranceId } = req.params;

  const result = await DoctorService.deleteDoctorInsurance(userId, insuranceId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor insurance deleted successfully",
    data: result,
  });
});

const getDoctorInsurances = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;

  const result = await DoctorService.getDoctorInsurances(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor insurance retrieved successfully",
    data: result,
  });
});


export const DoctorController = {
  updateDoctorProfile,
  getDoctorProfile,
  addWorkingHours,
  getWorkingHoursByDay,
  getAppointments,
  createDoctorInsurance,
  updateDoctorInsurance,
  deleteDoctorInsurance,
  getDoctorInsurances,
};
