import { Prisma, UserRole, BookingStatus, TopUpType } from "@prisma/client";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { IPaginationOptions } from "../../../interfaces/paginations";
import { generateTokens } from "../Auth/auth.service";
import { BookingSchedulerService } from "../../jobs/services/bookingScheduler.service";
import { Notification } from "../Notification/notification.service";
import { BookingService } from "../Booking/booking.service";
import { broadcastBookingUpdate } from "../../../helpars/socket/socketHandler";

interface DoctorFilters {
  search?: string; // name or speciality
  rating?: number; // minimum avg rating
  consultFee?: number; // max fee
  specialty?: string;
}

const getClinicProfile = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      country: true,
      city: true,
      address: true,
      phoneNumber: true,
      email: true,
      wallet: true,
      referralCode: true,
      totalReferrals: true,
      totalEarnings: true,
      currentEarnings: true,
      platformSubscriptionActive: true,
      serviceFree: true,
      clinic: {
        select: {
          id: true,
          managerName: true,
          managerPhone: true,
          logo: true,
          clinicName: true,
          about: true,
          contactPhone: true,
          location: true,
          latitude: true,
          longitude: true,
          views: true,
          adminVerified: true,
          badgeActive: true,
          verificationStatus: true,
          verificationDocuments: true,
          verificationAdminNote: true,
        },
      },
    },
  });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");

  let averageRating = 0;
  let reviewCount = 0;
  let weightedRating = 0;

  if (user.clinic) {
    const doctors = await prisma.doctor.findMany({
      where: { clinicId: user.clinic.id },
      select: { userId: true },
    });

    const doctorUserIds = doctors.map((d) => d.userId);

    const ratings = await prisma.doctorRating.aggregate({
      where: {
        doctorId: { in: doctorUserIds },
      },
      _avg: {
        rating: true,
      },
      _count: {
        rating: true,
      },
    });

    averageRating = ratings._avg.rating || 0;
    reviewCount = ratings._count.rating || 0;
    weightedRating = averageRating * Math.log(1 + reviewCount);
  }

  const { id: clinicId, ...clinicData } = user.clinic || {};

  const activeSubscription =
    await prisma.purchaseClinicPlatformSubscription.findFirst({
      where: {
        userId: userId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

  return {
    ...user,
    clinic: user.clinic
      ? {
          ...clinicData,
          averageRating: Number(averageRating.toFixed(1)),
          reviewCount,
          // weightedRating: Number(weightedRating.toFixed(1)),
        }
      : null,
    activeSubscription,
  };
};

const updateClinicProfile = async (userId: string, payload: any) => {
  // 1️⃣ Check if user exists
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");

  const { accessToken } = generateTokens(user, UserRole.CLINIC);

  // 2️⃣ Update user & upsert clinic
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(payload.fullName && { fullName: payload.fullName }),
      ...(payload.country && { country: payload.country }),
      ...(payload.city && { city: payload.city }),
      ...(payload.address && { address: payload.address }),
      role: UserRole.CLINIC,
      accessToken,
      ...(payload.profileCompleted !== undefined && {
        profileCompleted: payload.profileCompleted,
        ...(payload.email && { email: payload.email }),
      }),

      clinic: {
        upsert: {
          create: {
            managerName: payload.managerName,
            managerPhone: payload.managerPhone,
            logo: payload.logo,
            clinicName: payload.clinicName,
            about: payload.about,
            contactPhone: payload.contactPhone,
            location: payload.location,
            latitude: payload.latitude,
            longitude: payload.longitude,
            timezone: payload.timezone || "Africa/Tripoli",
          },
          update: {
            ...(payload.managerName && { managerName: payload.managerName }),
            ...(payload.managerPhone && { managerPhone: payload.managerPhone }),
            ...(payload.logo && { logo: payload.logo }),
            ...(payload.clinicName && { clinicName: payload.clinicName }),
            ...(payload.about && { about: payload.about }),
            ...(payload.contactPhone && { contactPhone: payload.contactPhone }),
            ...(payload.location && { location: payload.location }),
            ...(payload.latitude && { latitude: payload.latitude }),
            ...(payload.longitude && { longitude: payload.longitude }),
            ...(payload.timezone && { timezone: payload.timezone }),
          },
        },
      },
    },

    // 3️⃣ RETURN ONLY REQUIRED FIELDS
    select: {
      fullName: true,
      country: true,
      city: true,
      address: true,

      phoneNumber: true,
      status: true,
      role: true,
      referralCode: true,
      email: true,
      accessToken: true,
      clinic: {
        select: {
          id: true,
          managerName: true,
          managerPhone: true,
          logo: true,
          clinicName: true,
          about: true,
          contactPhone: true,
          location: true,
          latitude: true,
          longitude: true,
          timezone: true,
        },
      },
    },
  });

  if (payload.managerName && payload.managerPhone && updatedUser.clinic?.id) {
    await addClinicManager(
      updatedUser.clinic.id,
      payload.managerName,
      payload.managerPhone,
    );
  }

  return updatedUser;
};

const createClinicSpecialist = async (userId: string, specialistId: string) => {
  const clinic = await getClinicByUserId(userId);

  const specialist = await prisma.specialists.findUnique({
    where: { id: specialistId },
  });

  if (!specialist)
    throw new ApiError(httpStatus.NOT_FOUND, "Specialist not found");

  const isExist = await prisma.clinicSpecialist.findUnique({
    where: {
      clinicId_specialistId: {
        clinicId: clinic.id,
        specialistId: specialistId,
      },
    },
  });

  if (isExist) {
    return { specialistData: isExist };
  }

  return prisma.clinicSpecialist.create({
    data: {
      clinicId: clinic.id,
      specialistId: specialistId,
    },
  });
};

const deleteClinicSpecialist = async (userId: string, specialistId: string) => {
  const clinic = await getClinicByUserId(userId);

  const specialist = await prisma.clinicSpecialist.findUnique({
    where: { id: specialistId },
  });
  if (!specialist)
    throw new ApiError(httpStatus.NOT_FOUND, "Specialist not found");

  await prisma.clinicSpecialist.delete({
    where: { id: specialistId },
  });
};

const getClinicSpecialists = async (userId: string, options: any) => {
  const clinic = await getClinicByUserId(userId);

  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);

  const specialists = await prisma.clinicSpecialist.findMany({
    where: { clinicId: clinic.id },
    skip,
    select: {
      id: true,
      specialist: {
        select: {
          name: true,
          image: true,
        },
      },
    },
    take: limit,
    orderBy: {
      [sortBy]: sortOrder,
    },
  });

  const total = await prisma.clinicSpecialist.count({
    where: { clinicId: clinic.id },
  });

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: specialists,
  };
};

// Similar for ClinicInsurance and PhotoGallery

const createClinicInsurance = async (userId: string, insuranceId: string) => {
  const clinic = await getClinicByUserId(userId);

  const insurance = await prisma.insurances.findUnique({
    where: { id: insuranceId },
  });
  if (!insurance)
    throw new ApiError(httpStatus.NOT_FOUND, "Insurance not found");

  const isExist = await prisma.clinicInsurance.findUnique({
    where: {
      clinicId_insuranceId: {
        clinicId: clinic.id,
        insuranceId: insuranceId,
      },
    },
  });

  if (isExist) {
    // throw new ApiError(httpStatus.BAD_REQUEST, "Insurance already exist");
    return { insuranceData: isExist };
  }

  const insuranceData = await prisma.clinicInsurance.create({
    data: {
      clinicId: clinic.id,
      insuranceId: insuranceId,
    },
  });
  return insuranceData;
};

const getClinicInsurances = async (userId: string, options: any) => {
  const clinic = await getClinicByUserId(userId);

  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);

  const insurances = await prisma.clinicInsurance.findMany({
    where: { clinicId: clinic.id },
    skip,
    take: limit,
    select: {
      id: true,
      insurance: {
        select: {
          image: true,
          name: true,
        },
      },
    },
    orderBy: {
      [sortBy]: sortOrder,
    },
  });

  const total = await prisma.clinicInsurance.count({
    where: { clinicId: clinic.id },
  });

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: insurances,
  };
};

const deleteClinicInsurance = async (userId: string, insuranceId: string) => {
  const clinic = await getClinicByUserId(userId);

  const insurance = await prisma.clinicInsurance.findUnique({
    where: { id: insuranceId },
  });
  if (!insurance)
    throw new ApiError(httpStatus.NOT_FOUND, "Insurance not found");

  await prisma.clinicInsurance.delete({
    where: { id: insuranceId },
  });
};

const createPhotoGallery = async (userId: string, images: string[]) => {
  const clinic = await getClinicByUserId(userId);

  return await prisma.$transaction(
    images.map((image) =>
      prisma.photoGallery.create({
        data: {
          clinicId: clinic.id,
          image,
        },
      }),
    ),
  );
};

const getPhotoGalleries = async (userId: string, options: any) => {
  const clinic = await getClinicByUserId(userId);

  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);

  const galleries = await prisma.photoGallery.findMany({
    where: { clinicId: clinic.id },
    skip,
    take: limit,
    orderBy: {
      [sortBy]: sortOrder,
    },
  });

  const total = await prisma.photoGallery.count({
    where: { clinicId: clinic.id },
  });

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: galleries,
  };
};

const deletePhotoGallery = async (userId: string, galleryId: string) => {
  const clinic = await getClinicByUserId(userId);

  const gallery = await prisma.photoGallery.findUnique({
    where: { id: galleryId },
  });
  if (!gallery || gallery.clinicId !== clinic.id) {
    throw new ApiError(httpStatus.NOT_FOUND, "Gallery not found");
  }

  await prisma.photoGallery.delete({
    where: { id: galleryId },
  });
};

const clearPhotoGalleries = async (
  userId: string,
  galleryIds: string | string[],
) => {
  const clinic = await getClinicByUserId(userId);

  const ids = Array.isArray(galleryIds) ? galleryIds : [galleryIds];
  const filteredIds = ids.filter((id) => typeof id === "string" && id.trim());

  if (!filteredIds.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Gallery ids are required");
  }

  return await prisma.photoGallery.deleteMany({
    where: {
      clinicId: clinic.id,
      id: {
        in: filteredIds,
      },
    },
  });
};

const updateBookingStatus = async (
  userId: string,
  bookingId: string,
  status: string,
  reason?: string,
) => {
  return handleUnifiedStatusChange(
    bookingId,
    status as BookingStatus,
    userId,
    "CLINIC",
    reason,
  );
};

const getBookingHistory = async (
  userId: string,
  filters: any,
  options: IPaginationOptions,
) => {
  const clinic = await getClinicByUserId(userId);

  console.log("clinic data");

  const { limit, page, skip } = paginationHelpers.calculatePagination(options);
  const { searchTerm, status, ...filterData } = filters;

  const andConditions: Prisma.BookingAppointmentWhereInput[] = [];

  andConditions.push({ clinicId: clinic.id });

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

  if (status) {
    andConditions.push({
      status: { equals: status },
    });
  }

  if (filterData.doctorId) {
    andConditions.push({
      doctorId: { equals: filterData.doctorId },
    });
  }

  if (filterData.consultDate) {
    const searchDate = new Date(filterData.consultDate);
    // 🌍 UTC HANDLING: Set date boundaries using UTC to ensure consistent date filtering
    // regardless of server timezone
    const startOfDay = new Date(searchDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(searchDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    andConditions.push({
      consultDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
    });
  }

  const whereConditions: Prisma.BookingAppointmentWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  // 1️⃣ Fetch ALL matching bookings (no pagination yet)
  const bookings = await prisma.bookingAppointment.findMany({
    where: whereConditions,
    orderBy: {
      createdAt: "desc", // Default sort: Today -> Future
    },
    select: {
      id: true,
      consultDate: true,
      status: true,
      serialNumber: true,
      startTime: true,
      endTime: true,
      approximateEstimatedTime: true,
      cancellationReason: true,
      rejectionReason: true,
      bookedFor: true,
      familyMemberName: true,
      familyMemberRelation: true,
      clinic: {
        select: {
          id: true,
          clinicName: true,
          location: true,
        },
      },
      doctor: {
        select: {
          id: true,
          user: {
            select: {
              fullName: true,
              profileImage: true,
            },
          },
          speciality: true,
        },
      },
      patient: {
        select: {
          user: {
            select: {
              fullName: true,
              phoneNumber: true,
              profileImage: true,
              gender: true,
              dateOfBirth: true,
            },
          },
        },
      },
    },
  });

  // 2️⃣ Map/Process Data if needed (e.g. adding computed fields)
  // For now, we just pass it through or reshape if required
  const processedBookings = bookings.map((booking) => ({
    ...booking,
    // Add any custom fields here if needed in future
  }));

  // 3️⃣ Pagination using Slice (In-Memory)
  // Note: For very large datasets, DB pagination is better, but user requested this style.
  const paginatedBookings = processedBookings.slice(skip, skip + limit);

  return {
    meta: {
      page,
      limit,
      total: processedBookings.length,
    },
    data: paginatedBookings,
  };
};

const getManagerBookingHistory = async (
  userId: string,
  filters: any,
  options: IPaginationOptions,
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { clinic: true, manager: { include: { clinic: true } } },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  let clinicId: string | null = null;
  if (user.clinic) {
    clinicId = user.clinic.id;
  } else if (user.manager && user.manager.length > 0 && user.manager[0]?.clinic) {
    clinicId = user.manager[0].clinic.id;
  } else if (user.role === UserRole.ADMIN && filters.clinicId) {
    clinicId = filters.clinicId;
  } else if (user.role !== UserRole.ADMIN) {
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found for this user");
  }

  const { limit, page, skip } = paginationHelpers.calculatePagination(options);
  const { searchTerm, ...filterData } = filters;

  const andConditions: Prisma.BookingAppointmentWhereInput[] = [];

  if (clinicId) {
    andConditions.push({ clinicId });
  }

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
    andConditions.push({
      status: { equals: filterData.status },
    });
  }

  if (filterData.doctorId) {
    andConditions.push({
      doctorId: { equals: filterData.doctorId },
    });
  }

  if (filterData.consultDate) {
    const searchDate = new Date(filterData.consultDate);
    // 🌍 UTC HANDLING: Set date boundaries using UTC to ensure consistent date filtering
    // regardless of server timezone
    const startOfDay = new Date(searchDate);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(searchDate);
    endOfDay.setUTCHours(23, 59, 59, 999);

    andConditions.push({
      consultDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
    });
  }

  const whereConditions: Prisma.BookingAppointmentWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  // 1️⃣ Fetch ALL matching bookings (no pagination yet)
  const bookings = await prisma.bookingAppointment.findMany({
    where: whereConditions,
    orderBy: {
      createdAt: "desc", // Default sort: Today -> Future
    },
    select: {
      id: true,
      consultDate: true,
      status: true,
      serialNumber: true,
      startTime: true,
      endTime: true,
      approximateEstimatedTime: true,
      cancellationReason: true,
      rejectionReason: true,
      bookedFor: true,
      familyMemberName: true,
      familyMemberRelation: true,
      clinic: {
        select: {
          id: true,
          clinicName: true,
          location: true,
        },
      },
      doctor: {
        select: {
          id: true,
          user: {
            select: {
              fullName: true,
              profileImage: true,
            },
          },
          speciality: true,
        },
      },
      patient: {
        select: {
          user: {
            select: {
              fullName: true,
              phoneNumber: true,
              profileImage: true,
              gender: true,
              dateOfBirth: true,
            },
          },
        },
      },
    },
  });

  // 2️⃣ Map/Process Data if needed (e.g. adding computed fields)
  // For now, we just pass it through or reshape if required
  const processedBookings = bookings.map((booking) => ({
    ...booking,
    // Add any custom fields here if needed in future
  }));

  // 3️⃣ Pagination using Slice (In-Memory)
  // Note: For very large datasets, DB pagination is better, but user requested this style.
  const paginatedBookings = processedBookings.slice(skip, skip + limit);

  return {
    meta: {
      page,
      limit,
      total: processedBookings.length,
    },
    data: paginatedBookings,
  };
};

const getClinicManagerStats = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      clinic: true,
      manager: {
        include: { clinic: true },
      },
    },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  let clinicId: string | null = null;
  if (user.clinic) {
    clinicId = user.clinic.id;
  } else if (user.manager && user.manager.length > 0 && user.manager[0]?.clinic) {
    clinicId = user.manager[0].clinic.id;
  }

  // If user has no linked clinic and is not ADMIN, safely return zeros instead of crashing
  if (!clinicId && user.role !== UserRole.ADMIN) {
    return {
      totalAppointment: 0,
      todayAppointment: 0,
      pendingAppointment: 0,
      completedAppointment: 0,
      noShowAppointment: 0,
      confirmedAppointment: 0,
      cancelledAppointment: 0,
    };
  }

  // 🌍 UTC HANDLING: Always use UTC for date boundaries to ensure consistent
  // statistics calculation regardless of server timezone
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(today.getUTCDate() + 1);

  const clinicWhere: Prisma.BookingAppointmentWhereInput = clinicId
    ? { clinicId }
    : {};

  const [
    totalAppointment,
    todayAppointment,
    pendingAppointment,
    completedAppointment,
    noShowAppointment,
    confirmedAppointment,
    cancelledAppointment,
  ] = await Promise.all([
    // Total
    prisma.bookingAppointment.count({
      where: clinicWhere,
    }),
    // Today
    prisma.bookingAppointment.count({
      where: {
        ...clinicWhere,
        consultDate: {
          gte: today,
          lt: tomorrow,
        },
        status: {
          in: [
            BookingStatus.CONFIRMED,
            BookingStatus.INPROGRESS,
            BookingStatus.COMPLETE,
            BookingStatus.ARRIVED,
            BookingStatus.NOT_SHOW,
          ],
        },
      },
    }),
    // Pending
    prisma.bookingAppointment.count({
      where: {
        ...clinicWhere,
        status: BookingStatus.PENDING,
      },
    }),
    // Completed
    prisma.bookingAppointment.count({
      where: {
        ...clinicWhere,
        status: BookingStatus.COMPLETE,
      },
    }),
    // No Show
    prisma.bookingAppointment.count({
      where: {
        ...clinicWhere,
        status: BookingStatus.NOT_SHOW,
      },
    }),
    // Confirmed
    prisma.bookingAppointment.count({
      where: {
        ...clinicWhere,
        status: BookingStatus.CONFIRMED,
      },
    }),
    // Cancelled
    prisma.bookingAppointment.count({
      where: {
        ...clinicWhere,
        status: BookingStatus.CANCELLED,
      },
    }),
  ]);

  return {
    totalAppointment,
    todayAppointment,
    pendingAppointment,
    completedAppointment,
    noShowAppointment,
    confirmedAppointment,
    cancelledAppointment,
  };
};

const handleUnifiedStatusChange = async (
  bookingId: string,
  status: BookingStatus,
  userId: string,
  role: "CLINIC" | "MANAGER" | "DOCTOR" | "PATIENT" | "ADMIN",
  reason?: string,
) => {
  const appointment = await prisma.bookingAppointment.findUnique({
    where: { id: bookingId },
    include: {
      patient: { select: { id: true, userId: true, user: true } },
      doctor: { select: { id: true, userId: true, user: true } },
      clinic: { select: { id: true, userId: true, user: true, clinicName: true } },
    },
  });

  if (!appointment) {
    throw new ApiError(httpStatus.NOT_FOUND, "Booking not found");
  }

  // Authorization check
  if (role === "ADMIN") {
    // Admin has global override permission
  } else if (role === "CLINIC" && appointment.clinic?.userId !== userId) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "You are not authorized to update this appointment"
    );
  } else if (role === "MANAGER") {
    const manager = await prisma.manager.findFirst({
      where: { userId, clinicId: appointment.clinicId },
    });
    if (!manager) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        "Manager does not belong to this clinic"
      );
    }
  } else if (role === "DOCTOR" && appointment.doctor?.userId !== userId) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "You are not authorized to update this appointment"
    );
  } else if (role === "PATIENT") {
    if (appointment.patient?.userId !== userId) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        "You are not authorized to update this appointment"
      );
    }
    if (
      status !== BookingStatus.ARRIVED &&
      status !== BookingStatus.COMPLETE &&
      status !== BookingStatus.CANCELLED
    ) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        "Patients can only update appointment status to ARRIVED, COMPLETE, or CANCELLED"
      );
    }
  }

  // Terminal state protection: terminal states cannot be transitioned further
  const terminalStatuses: BookingStatus[] = [
    BookingStatus.COMPLETE,
    BookingStatus.CANCELLED,
    BookingStatus.REJECTED,
    BookingStatus.NOT_SHOW,
  ];

  if (terminalStatuses.includes(appointment.status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Cannot change status of an appointment that is already ${appointment.status}`
    );
  }

  // Core lifecycle transitions: PENDING can only become CONFIRMED, REJECTED, or CANCELLED
  if (
    appointment.status === BookingStatus.PENDING &&
    (status === BookingStatus.ARRIVED ||
      status === BookingStatus.INPROGRESS ||
      status === BookingStatus.COMPLETE ||
      status === BookingStatus.NOT_SHOW)
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Appointment is PENDING. It must be CONFIRMED before transitioning to ${status}`
    );
  }

  let result: any;

  if (status === BookingStatus.CONFIRMED) {
    result = await BookingService.confirmBooking(bookingId, userId);
  } else if (status === BookingStatus.CANCELLED) {
    const caller = role === "DOCTOR" ? "DOCTOR" : role === "PATIENT" ? "PATIENT" : "CLINIC";
    result = await BookingService.cancelBooking(bookingId, userId, caller, reason);
  } else if (status === BookingStatus.REJECTED) {
    const caller = role === "DOCTOR" ? "DOCTOR" : "CLINIC";
    result = await BookingService.rejectBooking(bookingId, reason, caller);
  } else if (status === BookingStatus.COMPLETE) {
    result = await BookingService.completeBooking(bookingId);
  } else if (status === BookingStatus.ARRIVED) {
    result = await prisma.bookingAppointment.update({
      where: { id: bookingId },
      data: { status: BookingStatus.ARRIVED },
    });

    if (appointment.patient?.user?.fcmToken) {
      await Notification.PatientNotification(
        result.id,
        result.patientId,
        "APPOINTMENT_ARRIVED",
        "Arrival Recorded",
        `You have been marked as arrived for your appointment with Dr. ${
          appointment.doctor?.user?.fullName || "the doctor"
        }.`,
        appointment.patient.user.fcmToken,
      );
    }
  } else if (status === BookingStatus.INPROGRESS) {
    result = await prisma.bookingAppointment.update({
      where: { id: bookingId },
      data: { status: BookingStatus.INPROGRESS },
    });

    if (appointment.patient?.user?.fcmToken) {
      await Notification.PatientNotification(
        result.id,
        result.patientId,
        "APPOINTMENT_INPROGRESS",
        "Consultation In Progress",
        `Your consultation with Dr. ${
          appointment.doctor?.user?.fullName || "the doctor"
        } is now in progress.`,
        appointment.patient.user.fcmToken,
      );
    }
  } else if (status === BookingStatus.NOT_SHOW) {
    const noShowReasonText = reason?.trim();
    if (!noShowReasonText) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "A reason is required when marking an appointment as No Show"
      );
    }
    result = await prisma.bookingAppointment.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.NOT_SHOW,
        cancellationReason: noShowReasonText,
        ...({ noShowReason: noShowReasonText } as any),
      },
    });

    try {
      await BookingSchedulerService.cancelBookingNotifications(bookingId);
      await BookingSchedulerService.cancelConfirmedBookingTimeout(bookingId);
    } catch (e) {
      // non-blocking
    }

    if (appointment.patient?.user?.fcmToken) {
      await Notification.PatientNotification(
        result.id,
        result.patientId,
        "APPOINTMENT_NOT_SHOW",
        "Marked as No Show",
        `Your appointment was marked as No Show. Reason: ${noShowReasonText}`,
        appointment.patient.user.fcmToken,
      );
    }
  } else {
    result = await prisma.bookingAppointment.update({
      where: { id: bookingId },
      data: { status },
    });
  }

  // Real-time synchronization across all three interfaces
  try {
    broadcastBookingUpdate({
      bookingId: result.id,
      status: result.status,
      clinicId: appointment.clinicId,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      patientUserId: appointment.patient?.userId,
      clinicUserId: appointment.clinic?.userId,
      doctorUserId: appointment.doctor?.userId,
      reason: reason || result.cancellationReason || result.rejectionReason,
      serialNumber: appointment.serialNumber,
      consultDate: appointment.consultDate,
    });
  } catch (err) {
    console.error("WS broadcast error:", err);
  }

  return result;
};

const updateAppointmentStatus = async (
  userId: string,
  bookingId: string,
  status: BookingStatus,
  reason?: string,
  userRole?: string,
) => {
  const mappedRole =
    userRole === "DOCTOR" || userRole === "PATIENT" || userRole === "MANAGER" || userRole === "ADMIN"
      ? (userRole as "DOCTOR" | "PATIENT" | "MANAGER" | "ADMIN")
      : "CLINIC";
  return handleUnifiedStatusChange(bookingId, status, userId, mappedRole, reason);
};

const managerUpdateAppointmentStatus = async (
  userId: string,
  bookingId: string,
  status: BookingStatus,
  reason?: string,
) => {
  return handleUnifiedStatusChange(bookingId, status, userId, "MANAGER", reason);
};

const getClinicStats = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { clinic: true, manager: { include: { clinic: true } } },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  let clinicId: string | null = null;
  if (user.clinic) {
    clinicId = user.clinic.id;
  } else if (user.manager && user.manager.length > 0 && user.manager[0]?.clinic) {
    clinicId = user.manager[0].clinic.id;
  }

  // 🌍 UTC HANDLING: Always use UTC for date boundaries to ensure consistent
  // statistics calculation regardless of server timezone
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(today.getUTCDate() + 1);

  const whereClinic: Prisma.BookingAppointmentWhereInput = clinicId
    ? { clinicId }
    : {};

  const [
    todayAppointment,
    pendingAppointment,
    confirmedAppointment,
    completedAppointment,
    cancelledAppointment,
    noShowAppointment,
    totalAppointment,
    doctorCount,
  ] = await Promise.all([
    // Today
    prisma.bookingAppointment.count({
      where: {
        ...whereClinic,
        consultDate: {
          gte: today,
          lt: tomorrow,
        },
        status: {
          in: [
            BookingStatus.CONFIRMED,
            BookingStatus.INPROGRESS,
            BookingStatus.COMPLETE,
            BookingStatus.ARRIVED,
            BookingStatus.NOT_SHOW,
          ],
        },
      },
    }),
    // Pending
    prisma.bookingAppointment.count({
      where: {
        ...whereClinic,
        status: BookingStatus.PENDING,
      },
    }),
    // Confirmed
    prisma.bookingAppointment.count({
      where: {
        ...whereClinic,
        status: BookingStatus.CONFIRMED,
      },
    }),
    // Completed
    prisma.bookingAppointment.count({
      where: {
        ...whereClinic,
        status: BookingStatus.COMPLETE,
      },
    }),
    // Cancelled
    prisma.bookingAppointment.count({
      where: {
        ...whereClinic,
        status: BookingStatus.CANCELLED,
      },
    }),
    // No show
    prisma.bookingAppointment.count({
      where: {
        ...whereClinic,
        status: BookingStatus.NOT_SHOW,
      },
    }),
    // Total
    prisma.bookingAppointment.count({
      where: whereClinic,
    }),
    // Doctor
    clinicId
      ? prisma.doctor.count({ where: { clinicId } })
      : prisma.doctor.count(),
  ]);

  return {
    todayAppointment,
    pendingAppointment,
    confirmedAppointment,
    completedAppointment,
    cancelledAppointment,
    noShowAppointment,
    totalAppointment,
    doctorCount,
  };
};

const getClinicDoctor = async (
  userId: string,
  filters: DoctorFilters,
  options: IPaginationOptions,
) => {
  const { page, skip, limit } = paginationHelpers.calculatePagination(options);

  const { search, rating, consultFee, specialty } = filters;

  const clinic = await getClinicByUserId(userId);

  // 1️⃣ Build Prisma WHERE conditions
  const andConditions: Prisma.UserWhereInput[] = [
    { role: UserRole.DOCTOR },
    {
      OR: [
        { doctor: { clinicId: clinic.id } },
        { doctor: { doctorClinics: { some: { clinicId: clinic.id, isActive: true } } } },
      ],
    },
  ];

  if (consultFee) {
    andConditions.push({
      doctor: {
        consultFee: { lte: Number(consultFee) },
      },
    });
  }

  if (specialty) {
    andConditions.push({
      doctor: {
        speciality: {
          contains: specialty,
          mode: "insensitive",
        },
      },
    });
  }

  if (search) {
    andConditions.push({
      OR: [
        {
          fullName: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          doctor: {
            speciality: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
      ],
    });
  }

  const whereConditions: Prisma.UserWhereInput = {
    AND: andConditions,
  };

  // 2️⃣ Fetch doctors
  const doctors = await prisma.user.findMany({
    where: whereConditions,
    include: {
      doctor: {
        select: {
          id: true,
          consultFee: true,
          speciality: true,
          experience: true,
          about: true,
          biography: true,
          qualifications: true,
          licenseNumber: true,
          clinic: true,
        },
      },
      ratingsReceived: {
        select: { rating: true },
      },
    },
  });

  // 🌍 UTC HANDLING: Always use UTC for today's date to ensure consistent
  // calculations regardless of server timezone
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // 3️⃣ Calculate rating & weighted score & counts
  const doctorsWithRating = await Promise.all(
    doctors.map(async (doc) => {
      const ratings = doc.ratingsReceived.map((r) => r.rating);
      const reviewCount = ratings.length;
      const averageRating = reviewCount
        ? ratings.reduce((a, b) => a + b, 0) / reviewCount
        : 0;
      const weightedRating = averageRating * Math.log(1 + reviewCount);

      const [totalConsult, upcomingConsult] = await Promise.all([
        prisma.bookingAppointment.count({
          where: { doctorId: doc.doctor?.id },
        }),
        prisma.bookingAppointment.count({
          where: {
            doctorId: doc.doctor?.id,
            consultDate: { gte: today },
            status: { not: BookingStatus.CANCELLED },
          },
        }),
      ]);

      return {
        id: doc.id,
        doctorId: doc.doctor?.id,
        name: doc.fullName,
        country: doc.country,
        city: doc.city,
        specialty: doc.doctor?.speciality,
        experience: doc.doctor?.experience,
        fee: doc.doctor?.consultFee,
        profileImage: doc.profileImage,
        clinic: doc.doctor?.clinic?.clinicName,
        rating: Number(averageRating.toFixed(1)),
        reviewCount,
        weightedRating: Number(weightedRating.toFixed(1)),
        totalConsult,
        upcomingConsult,
        about: doc.doctor?.about,
        biography: doc.doctor?.biography,
        qualifications: doc.doctor?.qualifications,
        phoneNumber: doc.phoneNumber,
        email: doc.email,
        licenseNumber: doc.doctor?.licenseNumber,
      };
    }),
  );

  // 4️⃣ Filter by minimum rating
  const filteredDoctors = rating
    ? doctorsWithRating.filter((d) => d.rating >= Number(rating))
    : doctorsWithRating;

  // 5️⃣ Sort by popularity (weighted score)
  const sortedDoctors = filteredDoctors.sort(
    (a, b) => b.weightedRating - a.weightedRating,
  );

  // 6️⃣ Pagination
  const paginatedDoctors = sortedDoctors.slice(skip, skip + limit);

  return {
    meta: {
      page,
      limit,
      total: filteredDoctors.length,
    },
    data: paginatedDoctors,
  };
};

const getClinicManagerDoctor = async (
  userId: string,
  filters: DoctorFilters,
  options: IPaginationOptions,
) => {
  const { page, skip, limit } = paginationHelpers.calculatePagination(options);

  const { search, rating, consultFee, specialty } = filters;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { clinic: true, manager: { include: { clinic: true } } },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  let clinicId: string | null = null;
  if (user.clinic) {
    clinicId = user.clinic.id;
  } else if (user.manager && user.manager.length > 0 && user.manager[0]?.clinic) {
    clinicId = user.manager[0].clinic.id;
  } else if (user.role === UserRole.ADMIN && (filters as any).clinicId) {
    clinicId = (filters as any).clinicId;
  } else if (user.role !== UserRole.ADMIN) {
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found for this user");
  }

  // 1️⃣ Build Prisma WHERE conditions
  const andConditions: Prisma.UserWhereInput[] = [
    { role: UserRole.DOCTOR },
  ];

  if (clinicId) {
    andConditions.push({
      OR: [
        { doctor: { clinicId } },
        { doctor: { doctorClinics: { some: { clinicId, isActive: true } } } },
      ],
    });
  }

  if (consultFee) {
    andConditions.push({
      doctor: {
        consultFee: { lte: Number(consultFee) },
      },
    });
  }

  if (specialty) {
    andConditions.push({
      doctor: {
        speciality: {
          contains: specialty,
          mode: "insensitive",
        },
      },
    });
  }

  if (search) {
    andConditions.push({
      OR: [
        {
          fullName: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          doctor: {
            speciality: {
              contains: search,
              mode: "insensitive",
            },
          },
        },
      ],
    });
  }

  const whereConditions: Prisma.UserWhereInput = {
    AND: andConditions,
  };

  // 2️⃣ Fetch doctors
  const doctors = await prisma.user.findMany({
    where: whereConditions,
    include: {
      doctor: {
        select: {
          id: true,
          consultFee: true,
          speciality: true,
          experience: true,
          about: true,
          biography: true,
          qualifications: true,
          licenseNumber: true,
          clinic: true,
        },
      },
      ratingsReceived: {
        select: { rating: true },
      },
    },
  });

  // 🌍 UTC HANDLING: Always use UTC for today's date to ensure consistent
  // calculations regardless of server timezone
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // 3️⃣ Calculate rating & weighted score & counts
  const doctorsWithRating = await Promise.all(
    doctors.map(async (doc) => {
      const ratings = doc.ratingsReceived.map((r) => r.rating);
      const reviewCount = ratings.length;
      const averageRating = reviewCount
        ? ratings.reduce((a, b) => a + b, 0) / reviewCount
        : 0;
      const weightedRating = averageRating * Math.log(1 + reviewCount);

      const [totalConsult, upcomingConsult] = await Promise.all([
        prisma.bookingAppointment.count({
          where: { doctorId: doc.doctor?.id },
        }),
        prisma.bookingAppointment.count({
          where: {
            doctorId: doc.doctor?.id,
            consultDate: { gte: today },
            status: { not: BookingStatus.CANCELLED },
          },
        }),
      ]);

      return {
        id: doc.id,
        doctorId: doc.doctor?.id,
        name: doc.fullName,
        country: doc.country,
        city: doc.city,
        specialty: doc.doctor?.speciality,
        experience: doc.doctor?.experience,
        fee: doc.doctor?.consultFee,
        profileImage: doc.profileImage,
        clinic: doc.doctor?.clinic?.clinicName,
        rating: Number(averageRating.toFixed(1)),
        reviewCount,
        weightedRating: Number(weightedRating.toFixed(1)),
        totalConsult,
        upcomingConsult,
        about: doc.doctor?.about,
        biography: doc.doctor?.biography,
        qualifications: doc.doctor?.qualifications,
        phoneNumber: doc.phoneNumber,
        email: doc.email,
        licenseNumber: doc.doctor?.licenseNumber,
      };
    }),
  );

  // 4️⃣ Filter by minimum rating
  const filteredDoctors = rating
    ? doctorsWithRating.filter((d) => d.rating >= Number(rating))
    : doctorsWithRating;

  // 5️⃣ Sort by popularity (weighted score)
  const sortedDoctors = filteredDoctors.sort(
    (a, b) => b.weightedRating - a.weightedRating,
  );

  // 6️⃣ Pagination
  const paginatedDoctors = sortedDoctors.slice(skip, skip + limit);

  return {
    meta: {
      page,
      limit,
      total: filteredDoctors.length,
    },
    data: paginatedDoctors,
  };
};

const removeDoctorFromClinic = async (doctorId: string, clinicId: string) => {
  const doctor = await prisma.doctor.findUnique({
    where: {
      id: doctorId,
    },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  // if (doctor.clinicId !== clinicId) {
  //   throw new ApiError(
  //     httpStatus.BAD_REQUEST,
  //     "Doctor is not associated with this clinic",
  //   );
  // }
  await prisma.doctor.update({
    where: {
      id: doctorId,
    },
    data: {
      clinicId: null,
    },
  });
};

const getDoctorAppointments = async (
  doctorId: string,
  clinicId: string,
  filters: any,
  options: IPaginationOptions,
) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);

  const { searchTerm, status } = filters;

  // 1️⃣ Fetch Clinic and Doctor (with full info and ratings) in parallel
  const [clinicRecord, doctorData] = await Promise.all([
    getClinicByUserId(clinicId),
    prisma.doctor.findUnique({
      where: { id: doctorId },
      include: {
        clinic: true,
        user: {
          select: {
            fullName: true,
            country: true,
            city: true,
            profileImage: true,
            ratingsReceived: {
              select: { rating: true },
            },
          },
        },
        workingDays: {
          select: {
            day: true,
            slots: {
              select: {
                startTime: true,
                endTime: true,
                capacity: true,
                isActive: true,
              },
            },
          },
        },
      },
    }),
  ]);

  if (!clinicRecord)
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");
  if (!doctorData) throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");

  const clinic = { clinic: clinicRecord };

  // 🌍 UTC HANDLING: Always use UTC for today's date to ensure consistent
  // calculations regardless of server timezone
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // 2️⃣ Calculate rating, consult counts
  const ratings = doctorData.user.ratingsReceived.map((r) => r.rating);
  const reviewCount = ratings.length;
  const averageRating = reviewCount
    ? ratings.reduce((a, b) => a + b, 0) / reviewCount
    : 0;
  const weightedRating = averageRating * Math.log(1 + reviewCount);

  const [totalConsult, upcomingConsult] = await Promise.all([
    prisma.bookingAppointment.count({
      where: { doctorId: doctorData.id },
    }),
    prisma.bookingAppointment.count({
      where: {
        doctorId: doctorData.id,
        consultDate: { gte: today },
        status: { not: BookingStatus.CANCELLED },
      },
    }),
  ]);

  // 3️⃣ Build Prisma conditions
  const andConditions: Prisma.BookingAppointmentWhereInput[] = [
    { doctorId: doctorData.id },
    { clinicId: clinic.clinic.id },
  ];

  if (status) {
    andConditions.push({ status });
  }

  if (searchTerm) {
    andConditions.push({
      OR: [
        {
          patient: {
            user: {
              fullName: { contains: searchTerm, mode: "insensitive" },
            },
          },
        },
        {
          patient: {
            user: {
              phoneNumber: { contains: searchTerm, mode: "insensitive" },
            },
          },
        },
        {
          doctor: {
            user: {
              fullName: { contains: searchTerm, mode: "insensitive" },
            },
          },
        },
        {
          doctor: {
            user: {
              phoneNumber: { contains: searchTerm, mode: "insensitive" },
            },
          },
        },
      ],
    });
  }

  const whereConditions: Prisma.BookingAppointmentWhereInput = {
    AND: andConditions,
  };

  // 4️⃣ Fetch Appointments and Total Count in parallel
  const [result, total] = await Promise.all([
    prisma.bookingAppointment.findMany({
      where: whereConditions,
      select: {
        id: true,
        consultDate: true,
        status: true,
        startTime: true,
        endTime: true,
        serialNumber: true,
        patient: {
          select: {
            user: {
              select: {
                fullName: true,
                phoneNumber: true,
                profileImage: true,
                gender: true,
                dateOfBirth: true,
              },
            },
          },
        },
      },
      skip,
      take: limit,
      orderBy: {
        [sortBy]: sortOrder,
      },
    }),
    prisma.bookingAppointment.count({
      where: whereConditions,
    }),
  ]);

  return {
    meta: {
      page,
      limit,
      total,
    },
    doctor: {
      id: doctorData.userId,
      doctorId: doctorData.id,
      name: doctorData.user.fullName,
      country: doctorData.user.country,
      city: doctorData.user.city,
      specialty: doctorData.speciality,
      experience: doctorData.experience,
      fee: doctorData.consultFee,
      profileImage: doctorData.user.profileImage,
      clinic: doctorData.clinic?.clinicName,
      reviewCount,
      weightedRating: Number(weightedRating.toFixed(1)),
      totalConsult,
      upcomingConsult,
      about: doctorData.about,
      schedule: doctorData.workingDays,
    },
    data: result,
  };
};

const getClinics = async (filters: any, options: IPaginationOptions) => {
  const { page, limit, skip } = paginationHelpers.calculatePagination(options);

  const { searchTerm, adminVerified } = filters;

  const andConditions: Prisma.ClinicWhereInput[] = [];

  if (searchTerm) {
    andConditions.push({
      clinicName: {
        contains: searchTerm,
        mode: "insensitive",
      },
    });
  }

  if (adminVerified !== undefined) {
    andConditions.push({
      adminVerified: adminVerified === "true",
    });
  }

  const whereConditions: Prisma.ClinicWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const result = (await prisma.clinic.findMany({
    where: whereConditions,
    select: {
      id: true,
      logo: true,
      clinicName: true,
      adminVerified: true,
      createdAt: true,
      latitude: true,
      longitude: true,
      _count: {
        select: { specialists: true },
      },
      user: {
        select: {
          phoneNumber: true,
          platformSubscriptionActive: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
    skip,
    take: limit,
  })) as any[];

  const total = await prisma.clinic.count({
    where: whereConditions,
  });

  const processedData = result.map((clinic) => ({
    id: clinic.id,
    logo: clinic.logo,
    clinicName: clinic.clinicName,
    adminVerified: clinic.adminVerified,
    numberOfClinicSpecialist: clinic._count?.specialists || 0,
    createdAt: clinic.createdAt,
    contact: clinic.user?.phoneNumber,
    platformSubscriptionActive: clinic.user?.platformSubscriptionActive,
    latitude: clinic.latitude,
    longitude: clinic.longitude,
  }));

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: processedData,
  };
};

const addClinicManager = async (
  clinicId: string,
  managerName: string,
  managerPhone: string,
) => {
  return await prisma.$transaction(async (tx) => {
    // 1. Find or create the User with role MANAGER
    const user = await tx.user.upsert({
      where: { phoneNumber: managerPhone },
      update: {
        fullName: managerName,
        role: UserRole.MANAGER,
      },
      create: {
        fullName: managerName,
        phoneNumber: managerPhone,
        role: UserRole.MANAGER,
      },
    });

    // 2. Link User as Manager to the Clinic (Double check to prevent duplicates)
    await tx.manager.upsert({
      where: {
        userId: user.id,
      },
      update: {
        clinicId: clinicId,
      },
      create: {
        userId: user.id,
        clinicId: clinicId,
      },
    });

    return user;
  });
};

async function getClinicByUserId(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      clinic: true,
      manager: {
        include: {
          clinic: true,
        },
      },
    },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  if (user.clinic) return user.clinic;
  if (user.manager && user.manager.length > 0 && user.manager[0].clinic) {
    return user.manager[0].clinic;
  }

  // Graceful fallback for Platform Admin or accounts without an attached clinic record
  const defaultClinic = await prisma.clinic.findFirst();
  if (defaultClinic) return defaultClinic;

  throw new ApiError(httpStatus.NOT_FOUND, "Clinic profile not found for this user");
}

const getClinicJoinRequests = async (userId: string) => {
  const clinic = await getClinicByUserId(userId);

  const requests = await prisma.doctorClinicRequest.findMany({
    where: { clinicId: clinic.id },
    include: {
      doctor: {
        select: {
          id: true,
          userId: true,
          speciality: true,
          qualifications: true,
          experience: true,
          licenseNumber: true,
          consultFee: true,
          user: {
            select: {
              fullName: true,
              profileImage: true,
              phoneNumber: true,
              email: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return requests;
};

const respondJoinRequest = async (
  userId: string,
  requestId: string,
  payload: { status: "ACCEPTED" | "REJECTED"; note?: string }
) => {
  const clinic = await getClinicByUserId(userId);

  const request = await prisma.doctorClinicRequest.findFirst({
    where: { id: requestId, clinicId: clinic.id },
  });

  if (!request) {
    throw new ApiError(httpStatus.NOT_FOUND, "Join request not found");
  }

  if (payload.status === "ACCEPTED") {
    // 1️⃣ Validate Max 3 Clinics limit for doctor
    const activeCount = await prisma.doctorClinic.count({
      where: {
        doctorId: request.doctorId,
        isActive: true,
      },
    });

    if (activeCount >= 3) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Doctor has reached the maximum limit of 3 linked clinics"
      );
    }

    // 2️⃣ Create active link in DoctorClinic
    await prisma.doctorClinic.upsert({
      where: {
        doctorId_clinicId: {
          doctorId: request.doctorId,
          clinicId: clinic.id,
        },
      },
      create: {
        doctorId: request.doctorId,
        clinicId: clinic.id,
        isActive: true,
      },
      update: {
        isActive: true,
      },
    });

    // 3️⃣ Update primary clinicId on Doctor if null
    await prisma.doctor.updateMany({
      where: {
        id: request.doctorId,
        clinicId: null,
      },
      data: {
        clinicId: clinic.id,
        joinClinicDate: new Date(),
      },
    });
  }

  // Update request status
  const updatedRequest = await prisma.doctorClinicRequest.update({
    where: { id: requestId },
    data: {
      status: payload.status,
      note: payload.note,
    },
  });

  return updatedRequest;
};

// Section 5: Doctor Absence Caseload Preview
const getDoctorAbsenceCaseload = async (
  userId: string,
  userRole: string,
  doctorId: string,
  date: string
) => {
  const clinic = await getClinicByUserId(userId);
  const clinicId = clinic.id;

  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          phoneNumber: true,
          email: true,
          profileImage: true,
        },
      },
    },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  const searchDate = new Date(date);
  if (isNaN(searchDate.getTime())) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Invalid date format. Expected YYYY-MM-DD"
    );
  }
  const startOfDay = new Date(searchDate);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(searchDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const affectedBookings = await prisma.bookingAppointment.findMany({
    where: {
      clinicId,
      doctorId,
      consultDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
      status: {
        in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
      },
    },
    orderBy: [
      { startTime: "asc" },
      { serialNumber: "asc" },
    ],
    include: {
      patient: {
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              phoneNumber: true,
              email: true,
              profileImage: true,
            },
          },
        },
      },
      workingSlot: true,
    },
  });

  const pendingCount = affectedBookings.filter(
    (b) => b.status === BookingStatus.PENDING
  ).length;
  const confirmedCount = affectedBookings.filter(
    (b) => b.status === BookingStatus.CONFIRMED
  ).length;

  return {
    doctor: {
      id: doctor.id,
      name: doctor.user?.fullName,
      speciality: doctor.speciality,
    },
    date,
    summary: {
      totalAffected: affectedBookings.length,
      pendingCount,
      confirmedCount,
    },
    caseload: affectedBookings,
  };
};

// Section 5: Doctor Absence One-Action Execution
const executeDoctorAbsence = async (
  userId: string,
  userRole: string,
  payload: {
    doctorId: string;
    date: string;
    reason?: string;
  }
) => {
  const { doctorId, date, reason } = payload;

  const clinic = await getClinicByUserId(userId);
  const clinicId = clinic.id;
  const clinicUserId = clinic.userId;

  const doctor = await prisma.doctor.findUnique({
    where: { id: doctorId },
    include: {
      user: {
        select: {
          fullName: true,
        },
      },
    },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  const searchDate = new Date(date);
  if (isNaN(searchDate.getTime())) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Invalid date format. Expected YYYY-MM-DD"
    );
  }
  const startOfDay = new Date(searchDate);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(searchDate);
  endOfDay.setUTCHours(23, 59, 59, 999);

  const affectedBookings = await prisma.bookingAppointment.findMany({
    where: {
      clinicId,
      doctorId,
      consultDate: {
        gte: startOfDay,
        lte: endOfDay,
      },
      status: {
        in: [BookingStatus.PENDING, BookingStatus.CONFIRMED],
      },
    },
    orderBy: [
      { startTime: "asc" },
      { serialNumber: "asc" },
    ],
    include: {
      patient: {
        include: {
          user: true,
        },
      },
    },
  });

  const doctorName = doctor.user?.fullName || "Doctor";
  const absenceReason =
    reason?.trim() || `Doctor ${doctorName} is absent on ${date}`;

  let pendingRejected = 0;
  let confirmedCancelled = 0;
  const processedBookings: Array<{
    appointmentId: string;
    serialNumber: number;
    patientName: string;
    previousStatus: BookingStatus;
    newStatus: BookingStatus;
    success: boolean;
    error?: string;
  }> = [];

  for (const booking of affectedBookings) {
    try {
      if (booking.status === BookingStatus.PENDING) {
        await BookingService.rejectBooking(booking.id, absenceReason, "CLINIC");
        pendingRejected++;
        processedBookings.push({
          appointmentId: booking.id,
          serialNumber: booking.serialNumber,
          patientName: booking.patient?.user?.fullName || "Patient",
          previousStatus: BookingStatus.PENDING,
          newStatus: BookingStatus.REJECTED,
          success: true,
        });
      } else if (booking.status === BookingStatus.CONFIRMED) {
        await BookingService.cancelBooking(
          booking.id,
          clinicUserId,
          "CLINIC",
          absenceReason
        );
        confirmedCancelled++;
        processedBookings.push({
          appointmentId: booking.id,
          serialNumber: booking.serialNumber,
          patientName: booking.patient?.user?.fullName || "Patient",
          previousStatus: BookingStatus.CONFIRMED,
          newStatus: BookingStatus.CANCELLED,
          success: true,
        });
      }
    } catch (err: any) {
      console.error(
        `Failed to process booking ${booking.id} during doctor absence:`,
        err
      );
      processedBookings.push({
        appointmentId: booking.id,
        serialNumber: booking.serialNumber,
        patientName: booking.patient?.user?.fullName || "Patient",
        previousStatus: booking.status,
        newStatus: booking.status,
        success: false,
        error: err.message,
      });
    }
  }

  return {
    doctor: {
      id: doctor.id,
      name: doctorName,
    },
    date,
    reason: absenceReason,
    totalAffected: affectedBookings.length,
    pendingRejected,
    confirmedCancelled,
    processedBookings,
  };
};

const getClinicReconciliationReports = async (
  userId: string,
  filters: {
    clinicId?: string;
    doctorId?: string;
    specialty?: string;
    location?: string;
    period?: "daily" | "weekly" | "monthly" | "last_month" | "custom";
    startDate?: string;
    endDate?: string;
    status?: string;
    searchTerm?: string;
  },
  options: IPaginationOptions
) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { clinic: true, manager: { include: { clinic: true } } },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  let clinicId: string | null = null;
  if (user.clinic) {
    clinicId = user.clinic.id;
  } else if (user.manager && user.manager.length > 0 && user.manager[0]?.clinic) {
    clinicId = user.manager[0].clinic.id;
  } else if (user.role === UserRole.ADMIN && filters.clinicId && filters.clinicId.toLowerCase() !== "all") {
    clinicId = filters.clinicId;
  } else if (user.role !== UserRole.ADMIN) {
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic profile not found");
  }

  const andConditions: Prisma.BookingAppointmentWhereInput[] = [];

  if (clinicId) {
    andConditions.push({ clinicId });
  }

  // 1. Doctor filter
  if (filters.doctorId && filters.doctorId.toLowerCase() !== "all") {
    andConditions.push({ doctorId: filters.doctorId });
  }

  // 2. Specialty filter
  if (filters.specialty && filters.specialty.toLowerCase() !== "all") {
    andConditions.push({
      doctor: {
        speciality: {
          contains: filters.specialty,
          mode: "insensitive",
        },
      },
    });
  }

  // 3. Location filter
  if (filters.location && filters.location.toLowerCase() !== "all") {
    andConditions.push({
      clinic: {
        location: {
          contains: filters.location,
          mode: "insensitive",
        },
      },
    });
  }

  // 4. Date / Period filter
  let periodStart: Date | undefined;
  let periodEnd: Date | undefined;
  const now = new Date();

  if (filters.period === "daily") {
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

  // 5. Status filter
  if (filters.status && filters.status.toUpperCase() !== "ALL") {
    andConditions.push({
      status: filters.status.toUpperCase() as BookingStatus,
    });
  }

  // 6. Search term (patient name / phone)
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

  const [appointments, total, allMatching] = await Promise.all([
    prisma.bookingAppointment.findMany({
      where: whereConditions,
      include: {
        clinic: {
          select: {
            id: true,
            clinicName: true,
            location: true,
            logo: true,
          },
        },
        doctor: {
          select: {
            id: true,
            consultFee: true,
            user: {
              select: {
                fullName: true,
                phoneNumber: true,
                profileImage: true,
              },
            },
            speciality: true,
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
    }),
    prisma.bookingAppointment.count({ where: whereConditions }),
    prisma.bookingAppointment.findMany({
      where: whereConditions,
      select: {
        id: true,
        status: true,
        consultFee: true,
        serviceFeeAmount: true,
        totalAmount: true,
        clinicId: true,
        clinic: {
          select: {
            id: true,
            clinicName: true,
            location: true,
          },
        },
        doctorId: true,
        doctor: {
          select: {
            id: true,
            user: { select: { fullName: true } },
          },
        },
      },
    }),
  ]);

  let totalCompleted = 0;
  let totalConfirmed = 0;
  let totalCancelled = 0;
  let totalNoShow = 0;
  let totalPending = 0;
  let totalConsultFees = 0;
  let totalServiceFees = 0;

  const doctorSummaryMap = new Map<
    string,
    { doctorId: string; doctorName: string; totalBookings: number; completedBookings: number; totalConsultFee: number }
  >();

  const clinicSummaryMap = new Map<
    string,
    { clinicId: string; clinicName: string; location: string; totalBookings: number; completedBookings: number; totalConsultFee: number; totalServiceFee: number }
  >();

  for (const apt of allMatching) {
    if (apt.status === BookingStatus.COMPLETE) {
      totalCompleted++;
      totalConsultFees += apt.consultFee || 0;
      totalServiceFees += apt.serviceFeeAmount || 0;
    } else if (
      apt.status === BookingStatus.CONFIRMED ||
      apt.status === BookingStatus.INPROGRESS ||
      apt.status === BookingStatus.ARRIVED
    ) {
      totalConfirmed++;
    } else if (apt.status === BookingStatus.CANCELLED || apt.status === BookingStatus.REJECTED) {
      totalCancelled++;
    } else if (apt.status === BookingStatus.NOT_SHOW) {
      totalNoShow++;
    } else if (apt.status === BookingStatus.PENDING) {
      totalPending++;
    }

    if (apt.doctorId && apt.doctor?.user?.fullName) {
      const docName = apt.doctor.user.fullName;
      const existing = doctorSummaryMap.get(apt.doctorId) || {
        doctorId: apt.doctorId,
        doctorName: docName,
        totalBookings: 0,
        completedBookings: 0,
        totalConsultFee: 0,
      };
      existing.totalBookings++;
      if (apt.status === BookingStatus.COMPLETE) {
        existing.completedBookings++;
        existing.totalConsultFee += apt.consultFee || 0;
      }
      doctorSummaryMap.set(apt.doctorId, existing);
    }

    if (apt.clinicId && apt.clinic?.clinicName) {
      const cName = apt.clinic.clinicName;
      const cLoc = apt.clinic.location || "";
      const existing = clinicSummaryMap.get(apt.clinicId) || {
        clinicId: apt.clinicId,
        clinicName: cName,
        location: cLoc,
        totalBookings: 0,
        completedBookings: 0,
        totalConsultFee: 0,
        totalServiceFee: 0,
      };
      existing.totalBookings++;
      if (apt.status === BookingStatus.COMPLETE) {
        existing.completedBookings++;
        existing.totalConsultFee += apt.consultFee || 0;
        existing.totalServiceFee += apt.serviceFeeAmount || 0;
      }
      clinicSummaryMap.set(apt.clinicId, existing);
    }
  }

  return {
    meta: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    summary: {
      totalBookings: allMatching.length,
      totalCompleted,
      totalConfirmed,
      totalCancelled,
      totalNoShow,
      totalPending,
      totalConsultFees,
      totalServiceFees,
      netClinicReceivable: totalConsultFees,
    },
    doctorBreakdown: Array.from(doctorSummaryMap.values()),
    clinicBreakdown: Array.from(clinicSummaryMap.values()),
    data: appointments,
  };
};

const getClinicFinancialSummary = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { clinic: true, manager: { include: { clinic: true } } },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  let clinicId: string | null = null;
  let clinicUserId: string = userId;
  if (user.clinic) {
    clinicId = user.clinic.id;
    clinicUserId = user.id;
  } else if (user.manager && user.manager.length > 0 && user.manager[0]?.clinic) {
    clinicId = user.manager[0].clinic.id;
    clinicUserId = user.manager[0].clinic.userId;
  }

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

  const whereClinic: Prisma.BookingAppointmentWhereInput = clinicId
    ? { clinicId, status: BookingStatus.COMPLETE }
    : { status: BookingStatus.COMPLETE };

  const [currentMonthAppointments, completedAppointments] = await Promise.all([
    prisma.bookingAppointment.aggregate({
      where: {
        ...whereClinic,
        consultDate: { gte: monthStart },
      },
      _sum: {
        consultFee: true,
        serviceFeeAmount: true,
      },
      _count: {
        id: true,
      },
    }),
    prisma.bookingAppointment.count({
      where: whereClinic,
    }),
  ]);

  const recentTransactions = await prisma.topUp.findMany({
    where: clinicId ? { userId: clinicUserId } : {},
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return {
    walletBalance: user.wallet || 0,
    frozenWallet: user.frozenWallet || 0,
    totalEarnings: user.totalEarnings || currentMonthAppointments._sum?.consultFee || 0,
    currentEarnings: user.currentEarnings || currentMonthAppointments._sum?.consultFee || 0,
    currentMonthGross: currentMonthAppointments._sum?.consultFee || 0,
    currentMonthPlatformFees: currentMonthAppointments._sum?.serviceFeeAmount || 0,
    currentMonthCompletedCount: currentMonthAppointments._count?.id || 0,
    totalCompletedCount: completedAppointments,
    recentTransactions,
  };
};

export const ClinicService = {
  updateClinicProfile,
  getClinicProfile,
  createClinicSpecialist,
  getClinicSpecialists,
  createClinicInsurance,
  getClinicInsurances,
  createPhotoGallery,
  getPhotoGalleries,
  deletePhotoGallery,
  clearPhotoGalleries,
  updateBookingStatus,
  deleteClinicSpecialist,
  deleteClinicInsurance,
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
  addClinicManager,
  getManagerBookingHistory,
  getClinicJoinRequests,
  respondJoinRequest,
  getDoctorAbsenceCaseload,
  executeDoctorAbsence,
  getClinicReconciliationReports,
  getClinicFinancialSummary,
};
