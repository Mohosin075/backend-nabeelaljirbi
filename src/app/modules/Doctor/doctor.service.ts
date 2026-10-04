import { Prisma, UserRole, WeekDay } from "@prisma/client";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { IPaginationOptions } from "../../../interfaces/paginations";
import { generateTokens } from "../Auth/auth.service";

const getDoctorProfile = async (userId: string) => {
  console.log("userId --->", userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      fullName: true,
      gender: true,
      dateOfBirth: true,
      country: true,
      city: true,
      address: true,
      profileImage: true,
      phoneNumber: true,
      status: true,
      role: true,
      email: true,
      referralCode: true,
      wallet: true,
      totalReferrals: true,
      totalEarnings: true,
      currentEarnings: true,
      doctor: {
        select: {
          speciality: true,
          experience: true,
          licenseNumber: true,
          consultFee: true,
          clinicId: true,
          joinClinicDate: true,
          createdAt: true,
          biography: true,
          qualifications: true,
          clinic: {
            select: {
              logo: true,
              clinicName: true,
              about: true,
              contactPhone: true,
              location: true,
              latitude: true,
              longitude: true,
              adminVerified: true,
            },
          },
          doctorClinics: {
            where: { isActive: true },
            select: {
              id: true,
              clinicId: true,
              joinedAt: true,
              clinic: {
                select: {
                  id: true,
                  clinicName: true,
                  logo: true,
                  location: true,
                  contactPhone: true,
                },
              },
            },
          },
          joinRequests: {
            select: {
              id: true,
              clinicId: true,
              status: true,
              note: true,
              createdAt: true,
              clinic: {
                select: {
                  id: true,
                  clinicName: true,
                  logo: true,
                },
              },
            },
          },
        },
      },
      ratingsReceived: {
        select: {
          rating: true,
        },
      },
    },
  });

  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");

  const { ratingsReceived, ...rest } = user;
  const ratings = ratingsReceived.map((r) => r.rating);
  const reviewCount = ratings.length;
  const averageRating = reviewCount
    ? ratings.reduce((a, b) => a + b, 0) / reviewCount
    : 0;
  const weightedRating = averageRating * Math.log(1 + reviewCount);

  return {
    ...rest,
    weightedRating: Number(weightedRating.toFixed(1)),
    reviewCount,
  };
};

const updateDoctorProfile = async (userId: string, payload: any) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { doctor: true },
  });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");

  const { accessToken } = generateTokens(user, UserRole.DOCTOR);

  let parsedDateOfBirth: Date | undefined = undefined;
  if (payload.dateOfBirth) {
    const d = new Date(payload.dateOfBirth);
    if (!isNaN(d.getTime())) {
      parsedDateOfBirth = d;
    }
  }

  const isClinicChanging =
    Boolean(payload.clinicId) && user.doctor?.clinicId !== payload.clinicId;

  const parsedConsultFee = Number(payload.consultFee);
  const consultFeeVal =
    payload.consultFee !== undefined &&
    payload.consultFee !== null &&
    payload.consultFee !== "" &&
    !isNaN(parsedConsultFee)
      ? parsedConsultFee
      : undefined;

  // `biography` is overloaded: older app builds store the qualifications JSON
  // there, while the CV upload screen stores an S3 URL there. Only mirror it into
  // `qualifications` when it is NOT a URL, so a CV upload never wipes them.
  const isUrl = (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v.trim());
  const qualificationsVal: string | null | undefined =
    payload.qualifications !== undefined
      ? payload.qualifications
      : payload.biography !== undefined && !isUrl(payload.biography)
        ? payload.biography
        : undefined;
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(payload.fullName && { fullName: payload.fullName }),
      ...(payload.gender && { gender: payload.gender }),
      ...(parsedDateOfBirth && { dateOfBirth: parsedDateOfBirth }),
      ...(payload.country && { country: payload.country }),
      ...(payload.city && { city: payload.city }),
      ...(payload.address && { address: payload.address }),
      ...(payload.profileImage && { profileImage: payload.profileImage }),
      accessToken,
      ...(payload.profileCompleted !== undefined && {
        profileCompleted: payload.profileCompleted,
        ...(payload.email && {
          email: payload.email,
        }),
      }),

      role: UserRole.DOCTOR,

      doctor: {
        upsert: {
          create: {
            about: payload.about,
            speciality: payload.speciality,
            qualifications: qualificationsVal ?? undefined,
            experience: payload.experience ? payload.experience : undefined,
            licenseNumber: payload.licenseNumber,
            consultFee: consultFeeVal !== undefined ? consultFeeVal : undefined,
            clinicId: payload.clinicId,
            ...(payload.clinicId && { joinClinicDate: new Date() }),
            biography: payload.biography,
          },
          update: {
            ...(payload.about !== undefined && {
              about: payload.about,
            }),
            ...(payload.speciality && {
              speciality: payload.speciality,
            }),
            ...(qualificationsVal !== undefined && {
              qualifications: qualificationsVal,
            }),
            ...(payload.experience && {
              experience: payload.experience,
            }),
            ...(payload.licenseNumber && {
              licenseNumber: payload.licenseNumber,
            }),
            ...(consultFeeVal !== undefined && {
              consultFee: consultFeeVal,
            }),
            ...(payload.clinicId && {
              clinicId: payload.clinicId,
            }),
            ...(isClinicChanging && {
              joinClinicDate: new Date(),
            }),
            ...(payload.biography !== undefined && { biography: payload.biography }),
          },
        },
      },
    },

    // 👇 RETURN ONLY REQUIRED FIELDS (same pattern as patient)
    select: {
      fullName: true,
      gender: true,
      dateOfBirth: true,
      country: true,
      city: true,
      address: true,
      profileImage: true,

      phoneNumber: true,
      status: true,
      role: true,
      referralCode: true,
      email: true,
      accessToken: true,

      doctor: {
        select: {
          about: true,
          speciality: true,
          experience: true,
          licenseNumber: true,
          consultFee: true,
          clinicId: true,
          joinClinicDate: true,
          biography: true,
          qualifications: true,
        },
      },
    },
  });

  return updatedUser;
};

const addWorkingHours = async (
  userId: string,
  payload: {
    clinicId?: string;
    day: string;
    slots: {
      startTime: string;
      endTime: string;
      capacity: number;
      isActive: boolean;
    }[];
  },
) => {
  const doctor = await prisma.doctor.findUnique({
    where: { userId },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  // 1️⃣ Find or create working day scoped by doctorId, clinicId, day
  const targetClinicId = payload.clinicId || null;

  let workingDay = await prisma.workingDay.findFirst({
    where: {
      doctorId: doctor.id,
      clinicId: targetClinicId,
      day: payload.day as WeekDay,
    },
  });

  if (!workingDay) {
    workingDay = await prisma.workingDay.create({
      data: {
        doctorId: doctor.id,
        clinicId: targetClinicId,
        day: payload.day as WeekDay,
      },
    });
  }

  // 2️⃣ Remove existing slots (replace mode)
  await prisma.workingSlot.deleteMany({
    where: {
      workingDayId: workingDay.id,
    },
  });

  // 3️⃣ Create new slots
  const slotsData = payload.slots.map((slot) => ({
    workingDayId: workingDay.id,
    startTime: slot.startTime,
    endTime: slot.endTime,
    capacity: slot.capacity,
    isActive: slot.isActive,
  }));

  await prisma.workingSlot.createMany({
    data: slotsData,
  });

  return {
    day: payload.day,
    clinicId: targetClinicId,
    slots: slotsData,
  };
};

const getWorkingHoursByDay = async (userId: string, clinicId?: string) => {
  const doctor = await prisma.doctor.findUnique({
    where: { userId },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  const whereCondition: any = {
    doctorId: doctor.id,
  };

  if (clinicId) {
    whereCondition.clinicId = clinicId;
  }

  const workingDay = await prisma.workingDay.findMany({
    where: whereCondition,
    select: {
      id: true,
      day: true,
      clinicId: true,
      slots: {
        select: {
          id: true,
          startTime: true,
          endTime: true,
          capacity: true,
          isActive: true,
        },
        orderBy: {
          startTime: "asc",
        },
      },
    },
  });

  return {
    slots: workingDay,
  };
};

const getAppointments = async (
  userId: string,
  filters: any,
  options: IPaginationOptions,
) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);

  const doctor = await prisma.doctor.findUnique({
    where: { userId },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  const { searchTerm, ...filterData } = filters;

  const andConditions: Prisma.BookingAppointmentWhereInput[] = [];

  andConditions.push({ doctorId: doctor.id });

  if (searchTerm) {
    andConditions.push({
      OR: [
        {
          patient: {
            user: {
              fullName: {
                contains: searchTerm,
                mode: "insensitive",
              },
            },
          },
        },
        {
          patient: {
            user: {
              phoneNumber: {
                contains: searchTerm,
                mode: "insensitive",
              },
            },
          },
        },
      ],
    });
  }

  if (filterData.status) {
    andConditions.push({ status: filterData.status });
  }

  const whereConditions: Prisma.BookingAppointmentWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const appointments = await prisma.bookingAppointment.findMany({
    where: whereConditions,
    include: {
      patient: {
        select: {
          user: {
            select: {
              fullName: true,
              profileImage: true,
              phoneNumber: true,
              gender: true,
              dateOfBirth: true,
            },
          },
        },
      },
      clinic: true,
      doctorRatings: {
        select: {
          rating: true,
        },
      },
    },
    skip,
    take: limit,
    orderBy: {
      [sortBy]: sortOrder,
    },
  });

  const total = await prisma.bookingAppointment.count({
    where: whereConditions,
  });

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: appointments,
  };
};

const createDoctorInsurance = async (
  userId: string,
  payload: {
    insuranceDetails: string;
    image: string;
  },
) => {
  const doctor = await prisma.user.findUnique({
    where: { id: userId, role: UserRole.DOCTOR },
    include: { doctor: true },
  });

  if (!doctor || !doctor.doctor)
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");

  return await prisma.doctorInsurance.create({
    data: {
      doctorId: doctor.doctor.id,
      insuranceDetails: payload.insuranceDetails,
      image: payload.image,
    },
  });
};

const updateDoctorInsurance = async (
  userId: string,
  insuranceId: string,
  payload: {
    insuranceDetails?: string;
    image?: string;
  },
) => {
  const doctor = await prisma.user.findUnique({
    where: { id: userId, role: UserRole.DOCTOR },
    include: { doctor: true },
  });

  if (!doctor || !doctor.doctor)
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");

  const isExist = await prisma.doctorInsurance.findUnique({
    where: {
      id: insuranceId,
    },
  });

  if (!isExist) {
    throw new ApiError(httpStatus.NOT_FOUND, "Insurance not found");
  }

  return await prisma.doctorInsurance.update({
    where: {
      id: insuranceId,
    },
    data: payload,
  });
};

const deleteDoctorInsurance = async (userId: string, insuranceId: string) => {
  const doctor = await prisma.user.findUnique({
    where: { id: userId, role: UserRole.DOCTOR },
    include: { doctor: true },
  });

  if (!doctor || !doctor.doctor)
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");

  const isExist = await prisma.doctorInsurance.findUnique({
    where: {
      id: insuranceId,
    },
  });

  if (!isExist) {
    throw new ApiError(httpStatus.NOT_FOUND, "Insurance not found");
  }

  await prisma.doctorInsurance.delete({
    where: {
      id: insuranceId,
    },
  });
};

const getDoctorInsurances = async (userId: string) => {
  const doctor = await prisma.user.findUnique({
    where: { id: userId, role: UserRole.DOCTOR },
    include: { doctor: true },
  });

  if (!doctor || !doctor.doctor)
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");

  return await prisma.doctorInsurance.findMany({
    where: {
      doctorId: doctor.doctor.id,
    },
  });
};

const requestJoinClinic = async (
  userId: string,
  payload: { clinicId: string; note?: string }
) => {
  const doctor = await prisma.doctor.findUnique({
    where: { userId },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor profile not found");
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: payload.clinicId },
  });

  if (!clinic) {
    throw new ApiError(httpStatus.NOT_FOUND, "Target clinic not found");
  }

  // 1️⃣ Check active clinic count (Max 3 limit)
  const activeCount = await prisma.doctorClinic.count({
    where: {
      doctorId: doctor.id,
      isActive: true,
    },
  });

  if (activeCount >= 3) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Doctor has already joined the maximum limit of 3 clinics"
    );
  }

  // 2️⃣ Check if doctor is already active in this clinic
  const existingLink = await prisma.doctorClinic.findFirst({
    where: {
      doctorId: doctor.id,
      clinicId: payload.clinicId,
      isActive: true,
    },
  });

  if (existingLink) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Doctor is already linked to this clinic"
    );
  }

  // 3️⃣ Check if pending request exists
  const existingPending = await prisma.doctorClinicRequest.findFirst({
    where: {
      doctorId: doctor.id,
      clinicId: payload.clinicId,
      status: "PENDING",
    },
  });

  if (existingPending) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "A join request to this clinic is already pending approval"
    );
  }

  // 4️⃣ Create new request
  const request = await prisma.doctorClinicRequest.create({
    data: {
      doctorId: doctor.id,
      clinicId: payload.clinicId,
      note: payload.note,
      status: "PENDING",
    },
    include: {
      clinic: {
        select: {
          id: true,
          clinicName: true,
          logo: true,
          location: true,
        },
      },
    },
  });

  return request;
};

const getDoctorJoinRequests = async (userId: string) => {
  const doctor = await prisma.doctor.findUnique({
    where: { userId },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  const requests = await prisma.doctorClinicRequest.findMany({
    where: { doctorId: doctor.id },
    include: {
      clinic: {
        select: {
          id: true,
          clinicName: true,
          logo: true,
          location: true,
          contactPhone: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const activeClinics = await prisma.doctorClinic.findMany({
    where: { doctorId: doctor.id, isActive: true },
    include: {
      clinic: {
        select: {
          id: true,
          clinicName: true,
          logo: true,
          location: true,
          contactPhone: true,
        },
      },
    },
    orderBy: { joinedAt: "desc" },
  });

  return {
    activeClinics,
    requests,
    activeCount: activeClinics.length,
    maxLimit: 3,
  };
};

const cancelJoinRequest = async (userId: string, requestId: string) => {
  const doctor = await prisma.doctor.findUnique({
    where: { userId },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  const request = await prisma.doctorClinicRequest.findFirst({
    where: { id: requestId, doctorId: doctor.id },
  });

  if (!request) {
    throw new ApiError(httpStatus.NOT_FOUND, "Join request not found");
  }

  const updated = await prisma.doctorClinicRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED" },
  });

  return updated;
};

export const DoctorService = {
  updateDoctorProfile,
  getDoctorProfile,
  addWorkingHours,
  getAppointments,
  getWorkingHoursByDay,
  createDoctorInsurance,
  updateDoctorInsurance,
  deleteDoctorInsurance,
  getDoctorInsurances,
  requestJoinClinic,
  getDoctorJoinRequests,
  cancelJoinRequest,
};
