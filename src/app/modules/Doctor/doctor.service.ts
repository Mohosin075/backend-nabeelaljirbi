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
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");

  const { accessToken } = generateTokens(user, UserRole.DOCTOR);

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(payload.fullName && { fullName: payload.fullName }),
      ...(payload.gender && { gender: payload.gender }),
      ...(payload.dateOfBirth && {
        dateOfBirth: new Date(payload.dateOfBirth),
      }),
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
            speciality: payload.speciality,
            experience: payload.experience ? payload.experience : undefined,
            licenseNumber: payload.licenseNumber,
            consultFee: payload.consultFee
              ? Number(payload.consultFee)
              : undefined,
            clinicId: payload.clinicId,
            biography: payload.biography,
          },
          update: {
            ...(payload.speciality && {
              speciality: payload.speciality,
            }),
            ...(payload.experience && {
              experience: payload.experience,
            }),
            ...(payload.licenseNumber && {
              licenseNumber: payload.licenseNumber,
            }),
            ...(payload.consultFee !== undefined && {
              consultFee: Number(payload.consultFee),
            }),
            ...(payload.clinicId && {
              clinicId: payload.clinicId,
            }),
            ...(payload.clinicId && {
              joinClinicDate: new Date(),
            }),
            ...(payload.biography && { biography: payload.biography }),
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
          speciality: true,
          experience: true,
          licenseNumber: true,
          consultFee: true,
          clinicId: true,
          joinClinicDate: true,
          biography: true,
        },
      },
    },
  });

  return updatedUser;
};

const addWorkingHours = async (
  userId: string,
  payload: {
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

  // 1️⃣ Upsert working day
  const workingDay = await prisma.workingDay.upsert({
    where: {
      doctorId_day: {
        doctorId: doctor.id,
        day: payload.day as WeekDay,
      },
    },
    create: {
      doctorId: doctor.id,
      day: payload.day as WeekDay,
    },
    update: {},
  });

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
    slots: slotsData,
  };
};

const getWorkingHoursByDay = async (userId: string) => {
  const doctor = await prisma.doctor.findUnique({
    where: { userId },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  const workingDay = await prisma.workingDay.findMany({
    where: {
      doctorId: doctor.id,
    },
    select: {
      day: true,
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

  if (!workingDay) {
    return {
      slots: [],
    };
  }

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
};
