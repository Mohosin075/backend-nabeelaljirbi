import { Prisma, UserRole, BookingStatus, TopUpType } from "@prisma/client";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { IPaginationOptions } from "../../../interfaces/paginations";
import { generateTokens } from "../Auth/auth.service";
import { BookingSchedulerService } from "../../jobs/services/bookingScheduler.service";
import { Notification } from "../Notification/notification.service";

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
  const clinic = await prisma.clinic.findUnique({ where: { userId } });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

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
  const clinic = await prisma.clinic.findUnique({ where: { userId } });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

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
  const clinic = await prisma.clinic.findUnique({ where: { userId } });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

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
  const clinic = await prisma.clinic.findUnique({ where: { userId } });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

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
  const clinic = await prisma.clinic.findUnique({ where: { userId } });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

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
  const clinic = await prisma.clinic.findUnique({ where: { userId } });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

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
  const clinic = await prisma.clinic.findUnique({ where: { userId } });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

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
  const clinic = await prisma.clinic.findUnique({ where: { userId } });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

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
  const clinic = await prisma.clinic.findUnique({ where: { userId } });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

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
  const clinic = await prisma.clinic.findUnique({ where: { userId } });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

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
) => {
  const booking = await prisma.bookingAppointment.findUnique({
    where: { id: bookingId },
  });
  if (!booking || booking.clinicId !== userId) {
    throw new ApiError(httpStatus.NOT_FOUND, "Booking not found");
  }

  const updatedBooking = await prisma.bookingAppointment.update({
    where: { id: bookingId },
    data: { status: status as any },
  });

  // Create patient notification
  await prisma.patientNotification.create({
    data: {
      patientId: updatedBooking.patientId,
      bookingAppointmentId: updatedBooking.id,
      notificationType: `APPOINTMENT_${status}`,
      title: `Appointment ${status.charAt(0) + status.slice(1).toLowerCase()}`,
      description: `Your appointment status has been updated to ${status}.`,
    },
  });

  return updatedBooking;
};

const getBookingHistory = async (
  userId: string,
  filters: any,
  options: IPaginationOptions,
) => {
  const clinic = await prisma.clinic.findUnique({ where: { userId } });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

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
      // workingSlot: {
      //     select: {
      //         startTime: true,
      //         endTime: true
      //     }
      // }
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
  const userWithManager = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      manager: {
        include: {
          clinic: true,
        },
      },
    },
  });

  const manager = userWithManager?.manager[0];
  if (!manager || !manager.clinic) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "Clinic not found for this manager",
    );
  }

  const clinicId = manager.clinicId;

  const { limit, page, skip } = paginationHelpers.calculatePagination(options);
  const { searchTerm, ...filterData } = filters;

  const andConditions: Prisma.BookingAppointmentWhereInput[] = [];

  andConditions.push({ clinicId });

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
      // workingSlot: {
      //     select: {
      //         startTime: true,
      //         endTime: true
      //     }
      // }
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
  const userWithManager = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      manager: {
        include: {
          clinic: true,
        },
      },
    },
  });

  if (!userWithManager)
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

  const clinic = userWithManager.manager[0].clinic;

  // 🌍 UTC HANDLING: Always use UTC for date boundaries to ensure consistent
  // statistics calculation regardless of server timezone
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(today.getUTCDate() + 1);

  const [
    totalAppointment,
    todayAppointment,
    pendingAppointment,
    completedAppointment,
    confirmedAppointment,
    cancelledAppointment,
  ] = await Promise.all([
    // Total
    prisma.bookingAppointment.count({
      where: { clinicId: clinic.id },
    }),
    // Today
    prisma.bookingAppointment.count({
      where: {
        clinicId: clinic.id,
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
        clinicId: clinic.id,
        status: BookingStatus.PENDING,
      },
    }),
    // Completed
    prisma.bookingAppointment.count({
      where: {
        clinicId: clinic.id,
        status: {
         in: [
           BookingStatus.COMPLETE,
           BookingStatus.NOT_SHOW,
        ],
       },
      },
    }),
    // Confirmed
    prisma.bookingAppointment.count({
      where: {
        clinicId: clinic.id,
        status: BookingStatus.CONFIRMED,
      },
    }),
    // Cancelled
    prisma.bookingAppointment.count({
      where: {
        clinicId: clinic.id,
        status: BookingStatus.CANCELLED,
      },
    }),
  ]);

  return {
    totalAppointment,
    todayAppointment,
    pendingAppointment,
    completedAppointment,
    confirmedAppointment,
    cancelledAppointment,
  };
};

const updateAppointmentStatus = async (
  userId: string,
  bookingId: string,
  status: BookingStatus,
) => {
  const appointment = await prisma.bookingAppointment.findUnique({
    where: { id: bookingId },
    include: {
      patient: {
        select: {
          id: true,
          user: true,
        },
      },
      doctor: {
        select: {
          user: {
            select: {
              fullName: true,
            },
          },
        },
      },
      clinic: {
        select: {
          clinicName: true,
        },
      },
    },
  });
  if (!appointment) {
    throw new ApiError(httpStatus.NOT_FOUND, "Booking not found");
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: appointment.clinicId },
    select: {
      userId: true,
      user: {
        select: {
          wallet: true,
          serviceFree: true,
        },
      },
    },
  });

  if (!clinic) {
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");
  }

  const adminUser = await prisma.user.findUnique({
    where: { phoneNumber: `${process.env.ADMIN_PHONE_NUMBER}` },
  });

  if (!adminUser) {
    throw new ApiError(httpStatus.NOT_FOUND, "Admin not found");
  }

  const patient = await prisma.patient.findUnique({
    where: { id: appointment.patientId },
    select: {
      user: true,
    },
  });

  if (!patient) {
    throw new ApiError(httpStatus.NOT_FOUND, "Patient not found");
  }

  if (status === BookingStatus.CANCELLED) {
    if (appointment.status === BookingStatus.CANCELLED) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Appointment is already cancelled",
      );
    }

    if (appointment.status === BookingStatus.COMPLETE) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Appointment is already completed",
      );
    }

    const updateBooking = await prisma.$transaction(async (tx) => {
      // Patient wallet increment
      await tx.user.update({
        where: { id: patient.user.id },
        data: {
          wallet: {
            increment: appointment.patientServiceFee,
          },
        },
      });

      // Clinic wallet increment
      await tx.user.update({
        where: { id: clinic.userId },
        data: {
          wallet: {
            increment: appointment.clinicServiceFee,
          },
        },
      });

      // Admin wallet decrement
      await tx.user.update({
        where: { id: adminUser.id },
        data: {
          wallet: {
            decrement:
              appointment.clinicServiceFee + appointment.patientServiceFee,
          },
        },
      });


      // if Clinic pay
      if (clinic.user.serviceFree > 0) {
        // Clinic wallet increment
        await tx.user.update({
          where: { id: clinic.userId },
          data: {
            wallet: {
              increment: appointment.clinicServiceFee,
            },
          },
        });

        // Clinic refund record
        await tx.topUp.create({
          data: {
            userId: clinic.userId,
            type: TopUpType.REFUND,
            amount: appointment.clinicServiceFee,
            appointmentId: bookingId,
          },
        });

        // Admin wallet decrement
        await tx.user.update({
          where: { id: adminUser.id },
          data: {
            wallet: {
              decrement:
                appointment.clinicServiceFee,
            },
          },
        });
      }



      // Update Booking
      const updateBooking = await tx.bookingAppointment.update({
        where: { id: bookingId },
        data: {
          status: status,
        },
      });
      return updateBooking;
    });


    // Cancel pending-timeout job (clinic has now responded — either CONFIRMED or CANCELLED)
    try {
      await BookingSchedulerService.cancelPendingBookingTimeout(bookingId);
      console.log(`✅ Cancelled PENDING_TIMEOUT for appointment ${bookingId}`);
    } catch (error) {
      console.error(`⚠️ Error cancelling PENDING_TIMEOUT for ${bookingId}:`, error);
    }

    // Cancel scheduled reminder notifications (Redis + BullMQ)
    try {
      await BookingSchedulerService.cancelBookingNotifications(bookingId);
      console.log(`✅ Cancelled reminder notifications for appointment ${bookingId}`);
    } catch (error) {
      console.error(`⚠️ Error cancelling reminder notifications for appointment ${bookingId}:`, error);
      // Don't throw error - cancellation is successful even if notification cleanup fails
    }

    // Patient notification
    await Notification.PatientNotification(
      updateBooking.id,
      updateBooking.patientId,
      'APPOINTMENT_CANCELLED',
      'Appointment Cancelled',
      `Your appointment with Dr. ${appointment.doctor?.user?.fullName || 'the doctor'} has been cancelled.`,
      patient.user.fcmToken as string,
    );

    return updateBooking;
  }

  if (status === BookingStatus.CONFIRMED) {
    if (appointment.status === BookingStatus.CONFIRMED) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Appointment is already confirmed",
      );
    }

    if (appointment.status === BookingStatus.COMPLETE) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Appointment is already completed",
      );
    }

    if (clinic.user.wallet < clinic.user.serviceFree) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Insufficient wallet balance");
    }

    const updateBooking = await prisma.$transaction(async (tx) => {
      // Clinic wallet decrement
      await tx.user.update({
        where: { id: clinic.userId },
        data: {
          wallet: {
            decrement: clinic.user.serviceFree,
          },
        },
      });

      // Admin wallet increment
      await tx.user.update({
        where: { id: adminUser.id },
        data: {
          wallet: {
            increment: clinic.user.serviceFree,
          },
        },
      });

      //  clinic service free
      await tx.topUp.create({
        data: {
          userId: clinic.userId,
          amount: clinic.user.serviceFree,
          appointmentId: bookingId,
          type: TopUpType.BOOKING,
        },
      });

      // Admin service free
      await tx.topUp.create({
        data: {
          userId: adminUser.id,
          amount: clinic.user.serviceFree,
          appointmentId: bookingId,
          type: TopUpType.BOOKING,
        },
      });

      return await tx.bookingAppointment.update({
        where: { id: bookingId },
        data: {
          status: status,
          clinicServiceFee: clinic.user.serviceFree,
        },
      });
    });

    // Schedule CONFIRMED_TIMEOUT job — fires 30 min after the doctor's slot endTime.
    // If clinic does not update visit status by then, appointment auto-closes
    // and admin retains all fees.
    try {
      const clinicForTimeout = await prisma.clinic.findUnique({
        where: { userId: userId },
        select: { id: true },
      });
      const adminForTimeout = await prisma.user.findUnique({
        where: { phoneNumber: `${process.env.ADMIN_PHONE_NUMBER}` },
        select: { id: true },
      });

      if (clinicForTimeout && adminForTimeout) {
        await BookingSchedulerService.scheduleConfirmedBookingTimeout({
          appointmentId: updateBooking.id,
          patientId: updateBooking.patientId,
          clinicId: clinicForTimeout.id,
          clinicUserId: clinic.userId,
          adminUserId: adminForTimeout.id,
          patientServiceFee: updateBooking.patientServiceFee,
          clinicServiceFee: updateBooking.clinicServiceFee,
          consultDate: updateBooking.consultDate,
          endTime: updateBooking.endTime!,
        });
        console.log(`⏳ Scheduled CONFIRMED_TIMEOUT for appointment ${bookingId}`);
      }
    } catch (error) {
      console.error(`⚠️ Error scheduling CONFIRMED_TIMEOUT for ${bookingId}:`, error);
      // Non-fatal — confirmation already succeeded
    }

    // Cancel the PENDING_TIMEOUT job (clinic has now confirmed)
    try {
      await BookingSchedulerService.cancelPendingBookingTimeout(bookingId);
      console.log(`✅ Cancelled PENDING_TIMEOUT for appointment ${bookingId}`);
    } catch (error) {
      console.error(`⚠️ Error cancelling PENDING_TIMEOUT for ${bookingId}:`, error);
    }

    // Schedule reminder notifications (Redis + BullMQ) for 24h and 3h before appointment
    try {
      await BookingSchedulerService.scheduleBookingNotifications({
        appointmentId: updateBooking.id,
        patientId: updateBooking.patientId,
        doctorId: updateBooking.doctorId,
        clinicId: updateBooking.clinicId,
        consultDate: updateBooking.consultDate,
        startTime: updateBooking.startTime!,
        endTime: updateBooking.endTime!,
        status: updateBooking.status,
      });
      console.log(`✅ Scheduled reminder notifications for appointment ${bookingId}`);
    } catch (error) {
      console.error(`⚠️ Error scheduling reminder notifications for appointment ${bookingId}:`, error);
      // Don't throw error - confirmation is successful even if notification scheduling fails
    }

    // Patient notification
    await Notification.PatientNotification(
      updateBooking.id,
      updateBooking.patientId,
      'APPOINTMENT_CONFIRMED',
      'Appointment Confirmed',
      `Your appointment with Dr. ${appointment.doctor?.user?.fullName || 'the doctor'} at ${appointment.clinic?.clinicName || 'the clinic'} has been confirmed for ${new Date(updateBooking.consultDate).toLocaleDateString()} at ${updateBooking.startTime}.`,
      patient.user.fcmToken as string,
    );

    return updateBooking;
  }

  const updatedBooking = await prisma.bookingAppointment.update({
    where: { id: bookingId },
    data: { status: status },
  });

  // Cancel CONFIRMED_TIMEOUT job — clinic has now manually updated the status
  try {
    await BookingSchedulerService.cancelConfirmedBookingTimeout(bookingId);
    console.log(`✅ Cancelled CONFIRMED_TIMEOUT for appointment ${bookingId} (status updated to ${status})`);
  } catch (error) {
    console.error(`⚠️ Error cancelling CONFIRMED_TIMEOUT for ${bookingId}:`, error);
  }

  // Patient notification for other status changes
  await Notification.PatientNotification(
    updatedBooking.id,
    updatedBooking.patientId,
    `APPOINTMENT_${status}`,
    `Appointment ${status.charAt(0) + status.slice(1).toLowerCase()}`,
    `Your appointment status has been updated to ${status}.`,
    patient.user.fcmToken as string,
  );

  return updatedBooking;
};

const managerUpdateAppointmentStatus = async (
  userId: string,
  bookingId: string,
  status: BookingStatus,
) => {
  const userWithManager = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      manager: true,
    },
  });

  const manager = userWithManager?.manager[0];
  if (!manager || !manager.clinicId) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "You are not authorized as a clinic manager",
    );
  }

  const appointment = await prisma.bookingAppointment.findUnique({
    where: { id: bookingId },
    include: {
      patient: {
        select: {
          id: true,
          user: true,
        },
      },
      doctor: {
        select: {
          user: {
            select: {
              fullName: true,
            },
          },
        },
      },
      clinic: {
        select: {
          clinicName: true,
        },
      },
    },
  });
  if (!appointment) {
    throw new ApiError(httpStatus.NOT_FOUND, "Booking not found");
  }

  if (appointment.clinicId !== manager.clinicId) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "This booking does not belong to your clinic",
    );
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: appointment.clinicId },
    select: {
      userId: true,
      user: {
        select: {
          wallet: true,
          serviceFree: true,
        },
      },
    },
  });

  if (!clinic) {
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");
  }

  const adminUser = await prisma.user.findUnique({
    where: { phoneNumber: `${process.env.ADMIN_PHONE_NUMBER}` },
  });

  if (!adminUser) {
    throw new ApiError(httpStatus.NOT_FOUND, "Admin not found");
  }

  const patient = await prisma.patient.findUnique({
    where: { id: appointment.patientId },
    select: {
      user: true,
    },
  });

  if (!patient) {
    throw new ApiError(httpStatus.NOT_FOUND, "Patient not found");
  }

  if (status === BookingStatus.CANCELLED) {
    if (appointment.status === BookingStatus.CANCELLED) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Appointment is already cancelled",
      );
    }

    if (appointment.status === BookingStatus.COMPLETE) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Appointment is already completed",
      );
    }

    const updateBooking = await prisma.$transaction(async (tx) => {
      // Patient wallet increment
      await tx.user.update({
        where: { id: patient.user.id },
        data: {
          wallet: {
            increment: appointment.patientServiceFee,
          },
        },
      });

      // Clinic wallet increment
      await tx.user.update({
        where: { id: clinic.userId },
        data: {
          wallet: {
            increment: appointment.clinicServiceFee,
          },
        },
      });

      // Admin wallet decrement
      await tx.user.update({
        where: { id: adminUser.id },
        data: {
          wallet: {
            decrement:
              appointment.clinicServiceFee + appointment.patientServiceFee,
          },
        },
      });


      // if Clinic pay
      if (clinic.user.serviceFree > 0) {
        // Clinic wallet increment
        await tx.user.update({
          where: { id: clinic.userId },
          data: {
            wallet: {
              increment: appointment.clinicServiceFee,
            },
          },
        });

        // Clinic refund record
        await tx.topUp.create({
          data: {
            userId: clinic.userId,
            type: TopUpType.REFUND,
            amount: appointment.clinicServiceFee,
            appointmentId: bookingId,
          },
        });

        // Admin wallet decrement
        await tx.user.update({
          where: { id: adminUser.id },
          data: {
            wallet: {
              decrement:
                appointment.clinicServiceFee,
            },
          },
        });
      }

      // Update Booking
      const updateBooking = await tx.bookingAppointment.update({
        where: { id: bookingId },
        data: {
          status: status,
        },
      });
      return updateBooking;
    });

    // Cancel pending-timeout job (clinic has now responded — either CONFIRMED or CANCELLED)
    try {
      await BookingSchedulerService.cancelPendingBookingTimeout(bookingId);
      console.log(`✅ Cancelled PENDING_TIMEOUT for appointment ${bookingId}`);
    } catch (error) {
      console.error(`⚠️ Error cancelling PENDING_TIMEOUT for ${bookingId}:`, error);
    }

    // Cancel scheduled reminder notifications (Redis + BullMQ)
    try {
      await BookingSchedulerService.cancelBookingNotifications(bookingId);
      console.log(`✅ Cancelled reminder notifications for appointment ${bookingId}`);
    } catch (error) {
      console.error(`⚠️ Error cancelling reminder notifications for appointment ${bookingId}:`, error);
      // Don't throw error - cancellation is successful even if notification cleanup fails
    }

    // Patient notification
    await Notification.PatientNotification(
      updateBooking.id,
      updateBooking.patientId,
      'APPOINTMENT_CANCELLED',
      'Appointment Cancelled',
      `Your appointment with Dr. ${appointment.doctor?.user?.fullName || 'the doctor'} has been cancelled.`,
      patient.user.fcmToken as string,
    );

    return updateBooking;
  }

  if (status === BookingStatus.CONFIRMED) {
    if (appointment.status === BookingStatus.CONFIRMED) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Appointment is already confirmed",
      );
    }

    if (appointment.status === BookingStatus.COMPLETE) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Appointment is already completed",
      );
    }

    if (clinic.user.wallet < clinic.user.serviceFree) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Insufficient wallet balance");
    }

    const updateBooking = await prisma.$transaction(async (tx) => {
      // Clinic wallet decrement
      await tx.user.update({
        where: { id: clinic.userId },
        data: {
          wallet: {
            decrement: clinic.user.serviceFree,
          },
        },
      });

      // Admin wallet increment
      await tx.user.update({
        where: { id: adminUser.id },
        data: {
          wallet: {
            increment: clinic.user.serviceFree,
          },
        },
      });

      //  clinic service free
      await tx.topUp.create({
        data: {
          userId: clinic.userId,
          amount: clinic.user.serviceFree,
          appointmentId: bookingId,
          type: TopUpType.BOOKING,
        },
      });

      // Admin service free
      await tx.topUp.create({
        data: {
          userId: adminUser.id,
          amount: clinic.user.serviceFree,
          appointmentId: bookingId,
          type: TopUpType.BOOKING,
        },
      });

      return await tx.bookingAppointment.update({
        where: { id: bookingId },
        data: {
          status: status,
          clinicServiceFee: clinic.user.serviceFree,
        },
      });
    });

    // Schedule CONFIRMED_TIMEOUT job — fires 30 min after the doctor's slot endTime.
    // If clinic does not update visit status by then, appointment auto-closes
    // and admin retains all fees.
    try {
      const clinicForTimeout = await prisma.clinic.findUnique({
        where: { userId: clinic.userId },
        select: { id: true },
      });
      const adminForTimeout = await prisma.user.findUnique({
        where: { phoneNumber: `${process.env.ADMIN_PHONE_NUMBER}` },
        select: { id: true },
      });

      if (clinicForTimeout && adminForTimeout) {
        await BookingSchedulerService.scheduleConfirmedBookingTimeout({
          appointmentId: updateBooking.id,
          patientId: updateBooking.patientId,
          clinicId: clinicForTimeout.id,
          clinicUserId: clinic.userId,
          adminUserId: adminForTimeout.id,
          patientServiceFee: updateBooking.patientServiceFee,
          clinicServiceFee: updateBooking.clinicServiceFee,
          consultDate: updateBooking.consultDate,
          endTime: updateBooking.endTime!,
        });
        console.log(`⏳ Scheduled CONFIRMED_TIMEOUT for appointment ${bookingId}`);
      }
    } catch (error) {
      console.error(`⚠️ Error scheduling CONFIRMED_TIMEOUT for ${bookingId}:`, error);
      // Non-fatal — confirmation already succeeded
    }

    // Cancel the PENDING_TIMEOUT job (clinic has now confirmed)
    try {
      await BookingSchedulerService.cancelPendingBookingTimeout(bookingId);
      console.log(`✅ Cancelled PENDING_TIMEOUT for appointment ${bookingId}`);
    } catch (error) {
      console.error(`⚠️ Error cancelling PENDING_TIMEOUT for ${bookingId}:`, error);
    }

    // Schedule reminder notifications (Redis + BullMQ) for 24h and 3h before appointment
    try {
      await BookingSchedulerService.scheduleBookingNotifications({
        appointmentId: updateBooking.id,
        patientId: updateBooking.patientId,
        doctorId: updateBooking.doctorId,
        clinicId: updateBooking.clinicId,
        consultDate: updateBooking.consultDate,
        startTime: updateBooking.startTime!,
        endTime: updateBooking.endTime!,
        status: updateBooking.status,
      });
      console.log(`✅ Scheduled reminder notifications for appointment ${bookingId}`);
    } catch (error) {
      console.error(`⚠️ Error scheduling reminder notifications for appointment ${bookingId}:`, error);
      // Don't throw error - confirmation is successful even if notification scheduling fails
    }

    // Patient notification
    await Notification.PatientNotification(
      updateBooking.id,
      updateBooking.patientId,
      'APPOINTMENT_CONFIRMED',
      'Appointment Confirmed',
      `Your appointment with Dr. ${appointment.doctor?.user?.fullName || 'the doctor'} at ${appointment.clinic?.clinicName || 'the clinic'} has been confirmed for ${new Date(updateBooking.consultDate).toLocaleDateString()} at ${updateBooking.startTime}.`,
      patient.user.fcmToken as string,
    );

    return updateBooking;
  }

  const updatedBooking = await prisma.bookingAppointment.update({
    where: { id: bookingId },
    data: { status: status },
  });

  // Cancel CONFIRMED_TIMEOUT job — clinic has now manually updated the status
  try {
    await BookingSchedulerService.cancelConfirmedBookingTimeout(bookingId);
    console.log(`✅ Cancelled CONFIRMED_TIMEOUT for appointment ${bookingId} (status updated to ${status})`);
  } catch (error) {
    console.error(`⚠️ Error cancelling CONFIRMED_TIMEOUT for ${bookingId}:`, error);
  }

  // Patient notification for other status changes
  await Notification.PatientNotification(
    updatedBooking.id,
    updatedBooking.patientId,
    `APPOINTMENT_${status}`,
    `Appointment ${status.charAt(0) + status.slice(1).toLowerCase()}`,
    `Your appointment status has been updated to ${status}.`,
    patient.user.fcmToken as string,
  );

  return updatedBooking;
};

const getClinicStats = async (userId: string) => {
  const clinic = await prisma.clinic.findUnique({ where: { userId } });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

  // 🌍 UTC HANDLING: Always use UTC for date boundaries to ensure consistent
  // statistics calculation regardless of server timezone
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(today.getUTCDate() + 1);

  const [todayAppointment, pendingAppointment, doctorCount] = await Promise.all(
    [
      // Today
      prisma.bookingAppointment.count({
        where: {
          clinicId: clinic.id,
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
          clinicId: clinic.id,
          status: BookingStatus.PENDING,
          // consultDate: {
          //   gte: today,
          //   lt: tomorrow,
          // },
        },
      }),

      // doctor
      prisma.doctor.count({
        where: {
          clinicId: clinic.id,
        },
      }),
    ],
  );

  return {
    todayAppointment,
    pendingAppointment,
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

  const clinic = await prisma.clinic.findUnique({ where: { userId } });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

  // 1️⃣ Build Prisma WHERE conditions
  const andConditions: Prisma.UserWhereInput[] = [
    { role: UserRole.DOCTOR },
    { doctor: { clinicId: clinic.id } },
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
          clinic: true,
          // workingDays: {
          //   select: {
          //     day: true,
          //     slots: {
          //       select: {
          //         startTime: true,
          //         endTime: true,
          //         capacity: true,
          //         isActive: true,
          //       },
          //     },
          //   },
          // },
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
        // schedule: doc.doctor?.workingDays,
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

  const manager = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      manager: {
        include: {
          clinic: true,
        },
      },
    },
  });
  if (!manager) throw new ApiError(httpStatus.NOT_FOUND, "Manager not found");

  const clinicId = manager.manager[0].clinic.id;

  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId } });
  if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

  // 1️⃣ Build Prisma WHERE conditions
  const andConditions: Prisma.UserWhereInput[] = [
    { role: UserRole.DOCTOR },
    { doctor: { clinicId: clinic.id } },
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
          clinic: true,
          // workingDays: {
          //   select: {
          //     day: true,
          //     slots: {
          //       select: {
          //         startTime: true,
          //         endTime: true,
          //         capacity: true,
          //         isActive: true,
          //       },
          //     },
          //   },
          // },
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
        // schedule: doc.doctor?.workingDays,
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
  const [clinic, doctorData] = await Promise.all([
    prisma.user.findUnique({
      where: { id: clinicId, role: UserRole.CLINIC },
      include: { clinic: true },
    }),
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

  if (!clinic || !clinic.clinic)
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");
  if (!doctorData) throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");

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
};
