import { Prisma, TopUpType, UserRole, UserStatus, BookingStatus } from "@prisma/client";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { IPaginationOptions } from "../../../interfaces/paginations";
import ApiError from "../../../errors/ApiErrors";
import httpStatus from "http-status";
import { Notification } from "../Notification/notification.service";
import { adminNotificationQueue } from "../../jobs";
import { BookingSchedulerService } from "../../jobs/services/bookingScheduler.service";
import { broadcastBookingUpdate } from "../../../helpars/socket/socketHandler";




const AdminStats = async () => {
  const [patientCount, doctorCount, clinicCount] = await Promise.all([
    prisma.user.count({
      where: { role: UserRole.PATIENT },
    }),
    prisma.user.count({
      where: { role: UserRole.DOCTOR },
    }),
    prisma.user.count({
      where: { role: UserRole.CLINIC },
    }),
  ]);

  return {
    patientCount,
    doctorCount,
    clinicCount,
  };
};


const getDoctors = async (filters: any, options: IPaginationOptions) => {
  const { limit, page, skip, sortBy, sortOrder } = paginationHelpers.calculatePagination(options);
  const { searchTerm, speciality, clinicId } = filters;

  const andConditions: Prisma.UserWhereInput[] = [
    {
      OR: [
        { role: UserRole.DOCTOR },
        { doctor: { isNot: null } }
      ]
    },
    { status: { not: UserStatus.DELETED } }
  ];

  if (searchTerm) {
    andConditions.push({
      OR: [
        { fullName: { contains: searchTerm, mode: "insensitive" } },
        { email: { contains: searchTerm, mode: "insensitive" } },
        { phoneNumber: { contains: searchTerm, mode: "insensitive" } },
        {
          doctor: {
            speciality: { contains: searchTerm, mode: "insensitive" }
          }
        }
      ]
    });
  }

  if (speciality) {
    andConditions.push({
      doctor: {
        speciality: { contains: speciality, mode: 'insensitive' }
      }
    })
  }

  if (clinicId) {
    andConditions.push({
      doctor: {
        clinicId: clinicId
      }
    })
  }

  const whereConditions: Prisma.UserWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};

  const result = await prisma.user.findMany({
    where: whereConditions,
    skip,
    take: limit,
    orderBy: sortBy && sortOrder ? { [sortBy]: sortOrder } : { createdAt: 'desc' },
    select: {
      id: true,
      fullName: true,
      gender: true,
      dateOfBirth: true,
      country: true,
      city: true,
      address: true,
      profileImage: true,
      email: true,
      phoneNumber: true,
      status: true,
      banned: true,
      createdAt: true,
      doctor: {
        select: {
          id: true,
          about: true,
          speciality: true,
          experience: true,
          licenseNumber: true,
          consultFee: true,
          clinicId: true,
          joinClinicDate: true,
          biography: true,
          qualifications: true,
          clinic: {
            select: {
              clinicName: true,
              logo: true
            }
          }
        }
      }
    }
  });

  const total = await prisma.user.count({ where: whereConditions });

  const processedData = result.map(user => ({
    id: user.id,
    doctorId: user.doctor?.id,
    fullName: user.fullName,
    gender: user.gender,
    dateOfBirth: user.dateOfBirth,
    country: user.country,
    city: user.city,
    address: user.address,
    profileImage: user.profileImage,
    email: user.email,
    phoneNumber: user.phoneNumber,
    status: user.status,
    banned: user.banned,
    createdAt: user.createdAt,
    about: user.doctor?.about,
    speciality: user.doctor?.speciality,
    experience: user.doctor?.experience,
    licenseNumber: user.doctor?.licenseNumber,
    consultFee: user.doctor?.consultFee,
    clinicId: user.doctor?.clinicId,
    joinClinicDate: user.doctor?.joinClinicDate,
    clinicName: user.doctor?.clinic?.clinicName,
    clinicLogo: user.doctor?.clinic?.logo,
    biography: user.doctor?.biography,
    qualifications: user.doctor?.qualifications,
  }));

  return {
    meta: { page, limit, total },
    data: processedData
  };
};

const getPatients = async (filters: any, options: IPaginationOptions) => {
  const { limit, page, skip, sortBy, sortOrder } = paginationHelpers.calculatePagination(options);
  const { searchTerm } = filters;

  const andConditions: Prisma.UserWhereInput[] = [
    { role: UserRole.PATIENT },
    { status: { not: UserStatus.DELETED } }
  ];

  if (searchTerm) {
    andConditions.push({
      OR: [
        { fullName: { contains: searchTerm, mode: "insensitive" } },
        { email: { contains: searchTerm, mode: "insensitive" } },
        { phoneNumber: { contains: searchTerm, mode: "insensitive" } }
      ]
    });
  }

  const whereConditions: Prisma.UserWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};

  const result = await prisma.user.findMany({
    where: whereConditions,
    skip,
    take: limit,
    orderBy: sortBy && sortOrder ? { [sortBy]: sortOrder } : { createdAt: 'desc' },
    select: {
      id: true,
      fullName: true,
      gender: true,
      dateOfBirth: true,
      country: true,
      city: true,
      address: true,
      profileImage: true,
      email: true,
      phoneNumber: true,
      status: true,
      createdAt: true,
      wallet: true
    }
  });

  const total = await prisma.user.count({ where: whereConditions });

  return {
    meta: { page, limit, total },
    data: result
  };
};

const updateWallet = async (userId: string, amount: number) => {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  const result = await prisma.$transaction(async (tx) => {
    // Update user's wallet
    await tx.user.update({
      where: { id: userId },
      data: {
        wallet: {
          increment: amount
        }
      }
    });

    // Create top-up transaction record
    return await tx.topUp.create({
      data: {
        userId: userId,
        amount: amount,
        type: TopUpType.RECHARGE,
      }
    });
  });

  return result;
}

const getClinics = async (filters: any, options: IPaginationOptions) => {
  const { limit, page, skip, sortBy, sortOrder } = paginationHelpers.calculatePagination(options);
  let { searchTerm, adminVerified } = filters;

  const andConditions: Prisma.UserWhereInput[] = [
    {
      OR: [
        { role: UserRole.CLINIC },
        { clinic: { isNot: null } }
      ]
    },
    { status: { not: UserStatus.DELETED } }
  ];

  // Trim searchTerm to remove leading/trailing whitespace
  if (searchTerm) {
    searchTerm = searchTerm.trim();
  }

  // console.log("searchTerm:", searchTerm);

  if (searchTerm) {
    andConditions.push({
      OR: [
        { fullName: { contains: searchTerm, mode: "insensitive" } },
        { email: { contains: searchTerm, mode: "insensitive" } },
        { phoneNumber: { contains: searchTerm, mode: "insensitive" } },
        { city: { contains: searchTerm, mode: "insensitive" } },
        { country: { contains: searchTerm, mode: "insensitive" } },
        { address: { contains: searchTerm, mode: "insensitive" } },
        { gender: { contains: searchTerm, mode: "insensitive" } },
        { clinic: { clinicName: { contains: searchTerm, mode: "insensitive" } } },
        { clinic: { managerName: { contains: searchTerm, mode: "insensitive" } } },
        { clinic: { managerPhone: { contains: searchTerm, mode: "insensitive" } } },
        { clinic: { about: { contains: searchTerm, mode: "insensitive" } } },
        { clinic: { location: { contains: searchTerm, mode: "insensitive" } } },
        { clinic: { contactPhone: { contains: searchTerm, mode: "insensitive" } } }
      ]
    });
  }

  if (adminVerified !== undefined) {
    andConditions.push({
      clinic: {
        adminVerified: adminVerified === 'true'
      }
    })
  }

  const whereConditions: Prisma.UserWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};

  const result = await prisma.user.findMany({
    where: whereConditions,
    skip,
    take: limit,
    orderBy: sortBy && sortOrder ? { [sortBy]: sortOrder } : { createdAt: 'desc' },
    select: {
      id: true,
      country: true,
      city: true,
      address: true,
      email: true,
      phoneNumber: true,
      serviceFree: true,
      wallet: true,
      status: true,
      banned: true,
      clinic: {
        select: {
          id: true,
          managerName: true,
          managerPhone: true,
          logo: true,
          clinicName: true,
          about: true,
          contactPhone: true,
          adminVerified: true,
          trial: true
        }
      }
    }
  });

  const total = await prisma.user.count({ where: whereConditions });

  const processedData = result.map(user => ({
    id: user.id,
    clinicId: user.clinic?.id,
    country: user.country,
    city: user.city,
    address: user.address,
    email: user.email,
    phoneNumber: user.phoneNumber,
    managerName: user.clinic?.managerName,
    managerPhone: user.clinic?.managerPhone,
    logo: user.clinic?.logo,
    clinicName: user.clinic?.clinicName,
    about: user.clinic?.about,
    contactPhone: user.clinic?.contactPhone,
    adminVerified: user.clinic?.adminVerified,
    serviceFree: user.serviceFree,
    trial: user.clinic?.trial,
    wallet: user.wallet,
    status: user.status,
    banned: user.banned,
  }));

  return {
    meta: { page, limit, total },
    data: processedData
  };
};

const AdminClinicVerified = async (clinicId: string, adminVerified: boolean) => {
  const existingClinic = await prisma.clinic.findFirst({
    where: {
      OR: [
        { id: clinicId },
        { userId: clinicId },
      ],
    },
  });

  if (!existingClinic) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Clinic not found');
  }

  const result = await prisma.clinic.update({
    where: {
      id: existingClinic.id,
    },
    data: {
      adminVerified: adminVerified,
    },
  });
  return result;
};

const suspendUserWithRefund = async (targetId: string, suspended: boolean, reason?: string) => {
  // 1. Locate user, doctor, and clinic entities
  let user: any = await prisma.user.findUnique({
    where: { id: targetId },
    include: { doctor: true, clinic: true },
  });

  let doctorId: string | null = null;
  let clinicId: string | null = null;

  if (!user) {
    // Check if targetId is a Doctor.id
    const doc = await prisma.doctor.findUnique({
      where: { id: targetId },
      include: { user: true },
    });
    if (doc) {
      user = doc.user;
      doctorId = doc.id;
    } else {
      // Check if targetId is a Clinic.id
      const cln = await prisma.clinic.findUnique({
        where: { id: targetId },
        include: { user: true },
      });
      if (cln) {
        user = cln.user;
        clinicId = cln.id;
      }
    }
  } else {
    if (user.doctor) doctorId = user.doctor.id;
    if (user.clinic) clinicId = user.clinic.id;
  }

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "Target user, doctor, or clinic not found");
  }

  // 2. If unsuspend / reactivate:
  if (!suspended) {
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        banned: false,
        status: UserStatus.ACTIVE,
      },
    });

    return {
      user: updatedUser,
      cancelledAppointmentsCount: 0,
      totalRefundedAmount: 0,
      message: `${user.role || 'User'} has been activated successfully`,
    };
  }

  // 3. If suspend:
  // Step A: Update user status to SUSPENDED & banned: true
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      banned: true,
      status: UserStatus.SUSPENDED,
    },
  });

  // Step B: Find upcoming Confirmed & Pending appointments for this doctor or clinic
  let cancelledCount = 0;
  let totalRefunded = 0;

  if (doctorId || clinicId) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const whereFilter: Prisma.BookingAppointmentWhereInput = {
      consultDate: { gte: startOfToday },
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.PENDING] },
      ...(doctorId ? { doctorId } : {}),
      ...(clinicId ? { clinicId } : {}),
    };

    const futureAppointments = await prisma.bookingAppointment.findMany({
      where: whereFilter,
      include: {
        patient: {
          include: { user: true },
        },
        clinic: {
          include: { user: true },
        },
        doctor: {
          include: { user: true },
        },
      },
    });

    const adminUser = await prisma.user.findFirst({
      where: { role: UserRole.ADMIN },
    });

    for (const apt of futureAppointments) {
      const patientUserId = apt.patient?.userId;
      const patientFee = apt.patientServiceFee || 0;
      const dateStr = new Date(apt.consultDate).toLocaleDateString();
      const providerName = doctorId
        ? `Dr. ${apt.doctor?.user?.fullName || ''}`
        : `${apt.clinic?.clinicName || 'Clinic'}`;

      await prisma.$transaction(async (tx) => {
        // Update appointment status to CANCELLED and mark refunded
        await tx.bookingAppointment.update({
          where: { id: apt.id },
          data: {
            status: BookingStatus.CANCELLED,
            refundPatient: true,
            returnPatientBalance: true,
          },
        });

        // 100% Full Refund to Patient
        if (patientFee > 0 && patientUserId) {
          // Increment patient wallet
          await tx.user.update({
            where: { id: patientUserId },
            data: { wallet: { increment: patientFee } },
          });

          // Decrement admin wallet
          if (adminUser) {
            await tx.user.update({
              where: { id: adminUser.id },
              data: { wallet: { decrement: patientFee } },
            });

            // Admin refund record
            await tx.topUp.create({
              data: {
                userId: adminUser.id,
                amount: patientFee,
                appointmentId: apt.id,
                type: TopUpType.REFUND,
              },
            });
          }

          // Patient refund record
          await tx.topUp.create({
            data: {
              userId: patientUserId,
              amount: patientFee,
              appointmentId: apt.id,
              type: TopUpType.REFUND,
            },
          });

          totalRefunded += patientFee;
        }

        // Also refund clinic fee if clinic was charged and not the suspended entity
        if (apt.clinicServiceFee > 0 && apt.clinic?.userId) {
          await tx.user.update({
            where: { id: apt.clinic.userId },
            data: { wallet: { increment: apt.clinicServiceFee } },
          });

          if (adminUser) {
            await tx.user.update({
              where: { id: adminUser.id },
              data: { wallet: { decrement: apt.clinicServiceFee } },
            });
            await tx.topUp.create({
              data: {
                userId: adminUser.id,
                amount: apt.clinicServiceFee,
                appointmentId: apt.id,
                type: TopUpType.REFUND,
              },
            });
          }

          await tx.topUp.create({
            data: {
              userId: apt.clinic.userId,
              amount: apt.clinicServiceFee,
              appointmentId: apt.id,
              type: TopUpType.REFUND,
            },
          });
        }

        // Notify patient about cancellation and 100% full refund
        await tx.patientNotification.create({
          data: {
            patientId: apt.patientId,
            bookingAppointmentId: apt.id,
            notificationType: "APPOINTMENT_CANCELLED",
            title: "Appointment Cancelled & 100% Refunded",
            description: `Your appointment with ${providerName} on ${dateStr} has been cancelled due to provider suspension. A full 100% refund of ${patientFee} LYD has been credited to your wallet balance.`,
          },
        });
      });

      // Cancel reminder notifications & timeout jobs in BullMQ
      try {
        await BookingSchedulerService.cancelBookingNotifications(apt.id);
        await BookingSchedulerService.cancelPendingBookingTimeout(apt.id);
        await BookingSchedulerService.cancelConfirmedBookingTimeout(apt.id);
      } catch (err) {
        console.error(`Failed to cancel booking scheduler jobs for ${apt.id}:`, err);
      }

      cancelledCount++;
    }
  }

  return {
    user: updatedUser,
    cancelledAppointmentsCount: cancelledCount,
    totalRefundedAmount: totalRefunded,
    message: `${user.role || 'User'} suspended successfully. ${cancelledCount} future appointments were automatically cancelled with 100% refunds issued to patients.`,
  };
};

const bannedUser = async (userId: string, banned: boolean) => {
  return await suspendUserWithRefund(userId, banned);
};

const suspendDoctor = async (doctorId: string, suspended: boolean) => {
  return await suspendUserWithRefund(doctorId, suspended);
};

const suspendClinic = async (clinicId: string, suspended: boolean) => {
  return await suspendUserWithRefund(clinicId, suspended);
};


const getPatientPlatformSubscription = async (filters: any, options: IPaginationOptions) => {
  const { limit, page, skip, sortBy, sortOrder } = paginationHelpers.calculatePagination(options);
  let { searchTerm, banned } = filters;

  const andConditions: Prisma.PurchasePatientPlatformSubscriptionWhereInput[] = [];

  // Trim searchTerm to remove leading/trailing whitespace
  if (searchTerm) {
    searchTerm = searchTerm.trim();
  }

  if (searchTerm) {
    andConditions.push({
      user: {
        OR: [
          { phoneNumber: { contains: searchTerm, mode: "insensitive" } },
          { fullName: { contains: searchTerm, mode: "insensitive" } },
          { gender: { contains: searchTerm, mode: "insensitive" } },
          { country: { contains: searchTerm, mode: "insensitive" } },
          { city: { contains: searchTerm, mode: "insensitive" } },
          { address: { contains: searchTerm, mode: "insensitive" } },
          { email: { contains: searchTerm, mode: "insensitive" } }
        ]
      }
    });
  }

  // Filter by banned status
  if (banned !== undefined) {
    andConditions.push({
      user: {
        banned: banned === 'true'
      }
    });
  }

  const whereConditions: Prisma.PurchasePatientPlatformSubscriptionWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const result = await prisma.purchasePatientPlatformSubscription.findMany({
    where: whereConditions,
    skip,
    take: limit,
    orderBy: sortBy && sortOrder ? { [sortBy]: sortOrder } : { createdAt: 'desc' },
    select: {
      id: true,
      amount: true,
      card: true,
      usdAmount: true,
      active: true,
      subscriptionId: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          phoneNumber: true,
          fullName: true,
          gender: true,
          country: true,
          city: true,
          address: true,
          email: true,
          profileImage: true,
          banned: true
        }
      }
    }
  });

  const totalPatient = await prisma.user.count({
    where: {
      role: UserRole.PATIENT
    }
  });

  const totalSubscriver = await prisma.purchasePatientPlatformSubscription.count({ where: whereConditions });

  const totalUsdAmount = await prisma.purchasePatientPlatformSubscription.aggregate({
    where: whereConditions,
    _sum: {
      usdAmount: true
    }
  });

  const totalUsd = totalUsdAmount._sum.usdAmount ?? 0;


  const total = await prisma.purchasePatientPlatformSubscription.count({ where: whereConditions });


  return {
    meta: { page, limit, total },
    data: { totalPatient, totalSubscriver, totalUsd, result }
  };
};

const getClinicPlatformSubscription = async (filters: any, options: IPaginationOptions) => {
  const { limit, page, skip, sortBy, sortOrder } = paginationHelpers.calculatePagination(options);
  let { searchTerm, banned, adminVerified } = filters;

  const andConditions: Prisma.PurchaseClinicPlatformSubscriptionWhereInput[] = [];

  // Trim searchTerm to remove leading/trailing whitespace
  if (searchTerm) {
    searchTerm = searchTerm.trim();
  }

  if (searchTerm) {
    andConditions.push({
      user: {
        OR: [
          { phoneNumber: { contains: searchTerm, mode: "insensitive" } },
          { fullName: { contains: searchTerm, mode: "insensitive" } },
          { gender: { contains: searchTerm, mode: "insensitive" } },
          { country: { contains: searchTerm, mode: "insensitive" } },
          { city: { contains: searchTerm, mode: "insensitive" } },
          { address: { contains: searchTerm, mode: "insensitive" } },
          { email: { contains: searchTerm, mode: "insensitive" } },
          { clinic: { managerName: { contains: searchTerm, mode: "insensitive" } } },
          { clinic: { managerPhone: { contains: searchTerm, mode: "insensitive" } } },
          { clinic: { clinicName: { contains: searchTerm, mode: "insensitive" } } },
          { clinic: { about: { contains: searchTerm, mode: "insensitive" } } },
          { clinic: { contactPhone: { contains: searchTerm, mode: "insensitive" } } },
          { clinic: { location: { contains: searchTerm, mode: "insensitive" } } }
        ]
      }
    });
  }

  // Filter by banned status
  if (banned !== undefined) {
    andConditions.push({
      user: {
        banned: banned === 'true'
      }
    });
  }

  // Filter by adminVerified status
  if (adminVerified !== undefined) {
    andConditions.push({
      user: {
        clinic: {
          adminVerified: adminVerified === 'true'
        }
      }
    });
  }

  const whereConditions: Prisma.PurchaseClinicPlatformSubscriptionWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const result = await prisma.purchaseClinicPlatformSubscription.findMany({
    where: whereConditions,
    skip,
    take: limit,
    orderBy: sortBy && sortOrder ? { [sortBy]: sortOrder } : { createdAt: 'desc' },
    select: {
      id: true,
      amount: true,
      card: true,
      usdAmount: true,
      active: true,
      subscriptionId: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          phoneNumber: true,
          fullName: true,
          gender: true,
          country: true,
          city: true,
          address: true,
          email: true,
          profileImage: true,
          banned: true,
          clinic: {
            select: {
              managerName: true,
              managerPhone: true,
              logo: true,
              clinicName: true,
              about: true,
              contactPhone: true,
              location: true,
              adminVerified: true
            }
          }
        }
      }
    }
  });


  const total = await prisma.purchaseClinicPlatformSubscription.count({ where: whereConditions });


  const totalClinic = await prisma.user.count({
    where: {
      role: UserRole.CLINIC
    }
  });

  const totalSubscriver = await prisma.purchaseClinicPlatformSubscription.count({ where: whereConditions });

  const totalUsdAmount = await prisma.purchaseClinicPlatformSubscription.aggregate({
    where: whereConditions,
    _sum: {
      usdAmount: true
    }
  });

  const totalUsd = totalUsdAmount._sum.usdAmount ?? 0;

  return {
    meta: { page, limit, total },
    data: { totalClinic, totalSubscriver, totalUsd, result }
  };
}

const SetServiceFree = async (userId: string, serviceFree: number) => {

  const user = await prisma.user.findUnique({
    where: {
      id: userId
    }
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  const clinic = await prisma.$transaction(async (tx) => {
    if (serviceFree > 0) {
      await tx.clinic.update({
        where: {
          userId: userId
        },
        data: {
          trial: false
        }
      });
    } else {
      await tx.clinic.update({
        where: {
          userId: userId
        },
        data: {
          trial: true
        }
      });
    }

    const result = await tx.user.update({
      where: {
        id: userId
      },
      data: {
        serviceFree: serviceFree
      }
    });

    return result;
  })
  return clinic;
}

// patient notification from admin
const createPatientNotification = async (payload: { userId: string[], title: string, description: string }) => {
  const { userId, title, description } = payload;

  if (!Array.isArray(userId) || userId.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "userId must be a non-empty array");
  }

  await adminNotificationQueue.add('patient-notification', {
    userIds: userId,
    title,
    description,
    type: 'PATIENT'
  });

  return { success: true, message: `Queued ${userId.length} notifications to be sent.` };
};

// Clinic notification from admin
const createClinicNotification = async (payload: { userId: string[], title: string, description: string }) => {
  const { userId, title, description } = payload;

  if (!Array.isArray(userId) || userId.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "userId must be a non-empty array");
  }

  await adminNotificationQueue.add('clinic-notification', {
    userIds: userId,
    title,
    description,
    type: 'CLINIC'
  });

  return { success: true, message: `Queued ${userId.length} notifications to be sent.` };
};

// Section 5: Admin Manual Override
const overrideAppointmentStatus = async (
  appointmentId: string,
  newStatus: BookingStatus,
  reason?: string
) => {
  const appointment = await prisma.bookingAppointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { select: { id: true, userId: true, user: true } },
      clinic: { select: { id: true, userId: true, user: true } },
      doctor: { select: { id: true, userId: true, user: true } },
    },
  });

  if (!appointment) {
    throw new ApiError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  const reasonText = reason?.trim() || `Admin manual override to ${newStatus}`;

  const updateData: Prisma.BookingAppointmentUpdateInput = {
    status: newStatus,
  };

  if (newStatus === BookingStatus.CANCELLED) {
    updateData.cancelledBy = "ADMIN";
    updateData.cancellationReason = reasonText;
  } else if (newStatus === BookingStatus.REJECTED) {
    updateData.rejectionReason = reasonText;
  } else if (newStatus === BookingStatus.NOT_SHOW) {
    updateData.cancellationReason = reasonText;
    (updateData as any).noShowReason = reasonText;
  }

  const result = await prisma.bookingAppointment.update({
    where: { id: appointmentId },
    data: updateData,
  });

  // If moving to a terminal state, cancel scheduled notifications/timeouts
  const terminalStatuses: BookingStatus[] = [
    BookingStatus.COMPLETE,
    BookingStatus.CANCELLED,
    BookingStatus.REJECTED,
    BookingStatus.NOT_SHOW,
  ];
  if (terminalStatuses.includes(newStatus)) {
    try {
      await BookingSchedulerService.cancelBookingNotifications(appointmentId);
      await BookingSchedulerService.cancelConfirmedBookingTimeout(appointmentId);
    } catch (e) {
      // non-blocking
    }
  }

  // Notify patient
  if (appointment.patient?.user?.fcmToken) {
    await Notification.PatientNotification(
      result.id,
      result.patientId,
      `APPOINTMENT_${newStatus}`,
      "Appointment Status Updated by Admin",
      `Your appointment status has been updated to ${newStatus}. Note: ${reasonText}`,
      appointment.patient.user.fcmToken
    );
  }

  // Real-time synchronization
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
      reason: reasonText,
      serialNumber: appointment.serialNumber,
      consultDate: appointment.consultDate,
    });
  } catch (err) {
    console.error("WS broadcast error:", err);
  }

  return result;
};

export const AdminService = {
  getDoctors,
  getPatients,
  getClinics,
  AdminClinicVerified,
  AdminStats,
  bannedUser,
  suspendUserWithRefund,
  suspendDoctor,
  suspendClinic,
  getPatientPlatformSubscription,
  getClinicPlatformSubscription,
  SetServiceFree,
  updateWallet,
  createPatientNotification,
  createClinicNotification,
  overrideAppointmentStatus,
};
