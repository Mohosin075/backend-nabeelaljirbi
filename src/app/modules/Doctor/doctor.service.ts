import { BookingStatus, Prisma, UserRole, WeekDay } from "@prisma/client";
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
          id: true,
          speciality: true,
          experience: true,
          licenseNumber: true,
          consultFee: true,
          clinicId: true,
          joinClinicDate: true,
          createdAt: true,
          biography: true,
          qualifications: true,
          badgeActive: true,
          adminVerified: true,
          verificationStatus: true,
          verificationDocuments: true,
          verificationAdminNote: true,
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
  if (user.role !== UserRole.DOCTOR || !user.doctor) {
    throw new ApiError(httpStatus.FORBIDDEN, "Only doctor accounts can update doctor profiles");
  }

  const { accessToken } = generateTokens(user, UserRole.DOCTOR);

  let parsedDateOfBirth: Date | undefined = undefined;
  if (payload.dateOfBirth) {
    const d = new Date(payload.dateOfBirth);
    if (!isNaN(d.getTime())) {
      parsedDateOfBirth = d;
    }
  }

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
  const isQualificationsJson = (v: unknown) =>
    typeof v === "string" && v.trim().startsWith("[");
  const qualificationsVal: string | null | undefined =
    payload.qualifications !== undefined
      ? payload.qualifications
      : payload.biography !== undefined && isQualificationsJson(payload.biography)
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

      doctor: {
        upsert: {
          create: {
            about: payload.about,
            speciality: payload.speciality,
            qualifications: qualificationsVal ?? undefined,
            experience: payload.experience ? payload.experience : undefined,
            licenseNumber: payload.licenseNumber,
            consultFee: consultFeeVal !== undefined ? consultFeeVal : undefined,
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

  if (payload.clinicId) {
    await requestJoinClinic(userId, {
      clinicId: payload.clinicId,
      note: "Sent during profile registration",
    });
  }

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
  if (targetClinicId) {
    const activeLink = await prisma.doctorClinic.findFirst({
      where: { doctorId: doctor.id, clinicId: targetClinicId, isActive: true },
      select: { id: true },
    });
    if (!activeLink) {
      throw new ApiError(httpStatus.FORBIDDEN, "Clinic-specific schedules require an approved clinic link");
    }
  }

  const slotsData = payload.slots.map((slot) => ({
    startTime: slot.startTime,
    endTime: slot.endTime,
    capacity: slot.capacity,
    isActive: slot.isActive ?? true,
  }));

  await prisma.$transaction(async (tx) => {
    let workingDay = await tx.workingDay.findFirst({
      where: {
        doctorId: doctor.id,
        clinicId: targetClinicId,
        day: payload.day as WeekDay,
      },
    });

    if (!workingDay) {
      workingDay = await tx.workingDay.create({
        data: {
          doctorId: doctor.id,
          clinicId: targetClinicId,
          day: payload.day as WeekDay,
        },
      });
    }

    await tx.workingSlot.deleteMany({ where: { workingDayId: workingDay.id } });
    if (slotsData.length > 0) {
      await tx.workingSlot.createMany({
        data: slotsData.map((slot) => ({ ...slot, workingDayId: workingDay.id })),
      });
    }
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
  const doctor = await prisma.doctor.findUnique({ where: { userId } });
  if (!doctor) throw new ApiError(httpStatus.NOT_FOUND, "Doctor profile not found");

  const clinic = await prisma.clinic.findUnique({
    where: { id: payload.clinicId },
    include: { user: true },
  });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Target clinic not found");
  if (
    !clinic.adminVerified ||
    !clinic.isVisible ||
    clinic.user.status !== "ACTIVE" ||
    clinic.user.banned
  ) {
    throw new ApiError(httpStatus.BAD_REQUEST, "This clinic is not accepting join requests");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const activeCount = await tx.doctorClinic.count({
        where: { doctorId: doctor.id, isActive: true },
      });
      if (activeCount >= 3) {
        throw new ApiError(httpStatus.BAD_REQUEST, "Doctor has already joined the maximum limit of 3 clinics");
      }

      const existingLink = await tx.doctorClinic.findFirst({
        where: { doctorId: doctor.id, clinicId: payload.clinicId, isActive: true },
      });
      if (existingLink) {
        throw new ApiError(httpStatus.BAD_REQUEST, "Doctor is already linked to this clinic");
      }

      const existingPending = await tx.doctorClinicRequest.findFirst({
        where: { doctorId: doctor.id, clinicId: payload.clinicId, status: "PENDING" },
      });
      if (existingPending) {
        throw new ApiError(httpStatus.BAD_REQUEST, "A join request to this clinic is already pending approval");
      }

      return tx.doctorClinicRequest.create({
        data: {
          doctorId: doctor.id,
          clinicId: payload.clinicId,
          note: payload.note,
          status: "PENDING",
        },
        include: {
          clinic: { select: { id: true, clinicName: true, logo: true, location: true } },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new ApiError(httpStatus.CONFLICT, "Join request changed concurrently. Please refresh and try again.");
    }
    throw error;
  }
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

const getReconciliationReports = async (
  userId: string,
  filters: {
    clinicId?: string;
    period?: "daily" | "weekly" | "monthly" | "last_month" | "custom";
    startDate?: string;
    endDate?: string;
    date?: string;
    time?: string;
    shift?: "morning" | "evening" | "all";
    status?: string;
    searchTerm?: string;
  },
  options: IPaginationOptions
) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);

  const doctor = await prisma.doctor.findUnique({
    where: { userId },
    include: {
      clinic: true,
      doctorClinics: {
        where: { isActive: true },
        include: { clinic: true },
      },
    },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor profile not found");
  }

  // Linked clinics (for UI tabs/filter)
  const linkedClinicsMap = new Map<
    string,
    { id: string; clinicName: string | null; location: string | null; logo: string | null }
  >();
  if (doctor.clinic) {
    linkedClinicsMap.set(doctor.clinic.id, {
      id: doctor.clinic.id,
      clinicName: doctor.clinic.clinicName,
      location: doctor.clinic.location,
      logo: doctor.clinic.logo,
    });
  }
  for (const dc of doctor.doctorClinics) {
    if (dc.clinic) {
      linkedClinicsMap.set(dc.clinic.id, {
        id: dc.clinic.id,
        clinicName: dc.clinic.clinicName,
        location: dc.clinic.location,
        logo: dc.clinic.logo,
      });
    }
  }
  const availableClinics = Array.from(linkedClinicsMap.values());

  const andConditions: Prisma.BookingAppointmentWhereInput[] = [
    { doctorId: doctor.id },
  ];

  // 1. Clinic filter
  if (filters.clinicId && filters.clinicId.toLowerCase() !== "all") {
    andConditions.push({ clinicId: filters.clinicId });
  }

  // 2. Date / Period filter
  let periodStart: Date | undefined;
  let periodEnd: Date | undefined;
  const now = new Date();

  if (filters.date) {
    const parts = filters.date.split("-").map(Number);
    if (parts.length === 3 && !parts.some(isNaN)) {
      periodStart = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0));
      periodEnd = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999));
    }
  } else if (filters.period === "daily") {
    periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
  } else if (filters.period === "weekly") {
    const dayOfWeek = now.getUTCDay();
    periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek, 0, 0, 0, 0));
    periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOfWeek + 6, 23, 59, 59, 999));
  } else if (filters.period === "monthly") {
    periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  } else if (filters.period === "last_month") {
    periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
    periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
  } else if (filters.startDate || filters.endDate) {
    if (filters.startDate) {
      const parts = filters.startDate.split("-").map(Number);
      if (parts.length === 3 && !parts.some(isNaN)) {
        periodStart = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0));
      }
    }
    if (filters.endDate) {
      const parts = filters.endDate.split("-").map(Number);
      if (parts.length === 3 && !parts.some(isNaN)) {
        periodEnd = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999));
      }
    }
  }

  if (periodStart || periodEnd) {
    andConditions.push({
      consultDate: {
        ...(periodStart ? { gte: periodStart } : {}),
        ...(periodEnd ? { lte: periodEnd } : {}),
      },
    });
  }

  // 3. Time / Slot / Shift filter
  if (filters.time && filters.time.trim()) {
    const t = filters.time.trim();
    andConditions.push({
      OR: [
        { startTime: { contains: t, mode: "insensitive" } },
        { endTime: { contains: t, mode: "insensitive" } },
      ],
    });
  } else if (filters.shift === "morning") {
    andConditions.push({
      startTime: { lt: "13:00" },
    });
  } else if (filters.shift === "evening") {
    andConditions.push({
      startTime: { gte: "13:00" },
    });
  }

  // 4. Status filter
  if (filters.status && filters.status.toUpperCase() !== "ALL") {
    andConditions.push({
      status: filters.status.toUpperCase() as BookingStatus,
    });
  }

  // 5. Search term
  if (filters.searchTerm && filters.searchTerm.trim()) {
    const term = filters.searchTerm.trim();
    andConditions.push({
      patient: {
        user: {
          OR: [
            { fullName: { contains: term, mode: "insensitive" } },
            { phoneNumber: { contains: term, mode: "insensitive" } },
          ],
        },
      },
    });
  }

  const whereConditions: Prisma.BookingAppointmentWhereInput = {
    AND: andConditions,
  };

  const appointments = await prisma.bookingAppointment.findMany({
    where: whereConditions,
    include: {
      clinic: {
        select: {
          id: true,
          clinicName: true,
          location: true,
          logo: true,
          contactPhone: true,
        },
      },
      patient: {
        select: {
          id: true,
          user: {
            select: {
              fullName: true,
              phoneNumber: true,
              profileImage: true,
            },
          },
        },
      },
    },
    orderBy: sortBy && sortOrder ? { [sortBy]: sortOrder } : { consultDate: "desc" },
    skip,
    take: limit,
  });

  const total = await prisma.bookingAppointment.count({ where: whereConditions });

  // Compute aggregate stats across matching appointments
  const allMatching = await prisma.bookingAppointment.findMany({
    where: whereConditions,
    select: {
      id: true,
      status: true,
      consultDate: true,
      clinicId: true,
      clinic: {
        select: {
          id: true,
          clinicName: true,
          logo: true,
        },
      },
    },
  });

  const consultFee = doctor.consultFee || 0;
  let totalCompleted = 0;
  let totalConfirmed = 0;
  let totalCancelled = 0;
  let totalNoShow = 0;
  let totalPending = 0;

  const clinicSummaryMap = new Map<
    string,
    {
      clinicId: string;
      clinicName: string;
      logo?: string | null;
      totalCount: number;
      completedCount: number;
      totalAmount: number;
    }
  >();
  const dailySummaryMap = new Map<
    string,
    {
      date: string;
      totalCount: number;
      completedCount: number;
      totalAmount: number;
    }
  >();

  for (const apt of allMatching) {
    if (apt.status === "COMPLETE") totalCompleted++;
    else if (
      apt.status === "CONFIRMED" ||
      apt.status === "INPROGRESS" ||
      apt.status === "ARRIVED"
    )
      totalConfirmed++;
    else if (apt.status === "CANCELLED") totalCancelled++;
    else if (apt.status === "NOT_SHOW") totalNoShow++;
    else if (apt.status === "PENDING") totalPending++;

    // Clinic breakdown
    const cId = apt.clinicId;
    const cName = apt.clinic?.clinicName || "Unknown Clinic";
    const existingClinic = clinicSummaryMap.get(cId) || {
      clinicId: cId,
      clinicName: cName,
      logo: apt.clinic?.logo || null,
      totalCount: 0,
      completedCount: 0,
      totalAmount: 0,
    };
    existingClinic.totalCount++;
    if (apt.status === "COMPLETE") {
      existingClinic.completedCount++;
      existingClinic.totalAmount += consultFee;
    }
    clinicSummaryMap.set(cId, existingClinic);

    // Date breakdown
    const dateStr = apt.consultDate
      ? apt.consultDate.toISOString().split("T")[0]
      : "Unknown";
    const existingDaily = dailySummaryMap.get(dateStr) || {
      date: dateStr,
      totalCount: 0,
      completedCount: 0,
      totalAmount: 0,
    };
    existingDaily.totalCount++;
    if (apt.status === "COMPLETE") {
      existingDaily.completedCount++;
      existingDaily.totalAmount += consultFee;
    }
    dailySummaryMap.set(dateStr, existingDaily);
  }

  const clinicBreakdown = Array.from(clinicSummaryMap.values());
  const dailyBreakdown = Array.from(dailySummaryMap.values()).sort((a, b) =>
    b.date.localeCompare(a.date)
  );

  return {
    summary: {
      totalAppointments: allMatching.length,
      completedAppointments: totalCompleted,
      confirmedAppointments: totalConfirmed,
      cancelledAppointments: totalCancelled,
      noShowAppointments: totalNoShow,
      pendingAppointments: totalPending,
      consultFeePerSession: consultFee,
      totalEarnedAmount: totalCompleted * consultFee,
      totalPotentialAmount: (totalCompleted + totalConfirmed) * consultFee,
    },
    availableClinics,
    clinicBreakdown,
    dailyBreakdown,
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data: appointments.map((apt) => ({
      id: apt.id,
      serialNumber: apt.serialNumber,
      consultDate: apt.consultDate,
      startTime: apt.startTime,
      endTime: apt.endTime,
      status: apt.status,
      consultFee: consultFee,
      clinic: {
        id: apt.clinic.id,
        clinicName: apt.clinic.clinicName,
        location: apt.clinic.location,
        logo: apt.clinic.logo,
        contactPhone: apt.clinic.contactPhone,
      },
      patient: {
        id: apt.patient.id,
        fullName: apt.patient.user.fullName,
        phoneNumber: apt.patient.user.phoneNumber,
        profileImage: apt.patient.user.profileImage,
      },
      approximateEstimatedTime: apt.approximateEstimatedTime,
      cancellationReason: apt.cancellationReason,
      rejectionReason: apt.rejectionReason,
      bookedFor: apt.bookedFor,
      familyMemberName: apt.familyMemberName,
      familyMemberRelation: apt.familyMemberRelation,
      createdAt: apt.createdAt,
    })),
  };
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
  getReconciliationReports,
};
