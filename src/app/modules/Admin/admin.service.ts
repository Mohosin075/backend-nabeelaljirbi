import { AdminTier, Prisma, TopUpType, UserRole, UserStatus, BookingStatus } from "@prisma/client";
import bcrypt from "bcrypt";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { IPaginationOptions } from "../../../interfaces/paginations";
import ApiError from "../../../errors/ApiErrors";
import httpStatus from "http-status";
import { Notification } from "../Notification/notification.service";
import { adminNotificationQueue } from "../../jobs";
import { BookingSchedulerService } from "../../jobs/services/bookingScheduler.service";
import { broadcastBookingUpdate } from "../../../helpars/socket/socketHandler";
import { BookingService } from "../Booking/booking.service";
import { createAuditLog } from "../../utils/auditLogger";




const AdminStats = async () => {
  const [
    patientCount,
    doctorCount,
    clinicCount,
    pendingClinicVerifications,
    pendingDoctorVerifications,
    pendingSettlements,
    openComplaints,
    totalBookings,
    pendingBookings,
    confirmedBookings,
    completedBookings,
  ] = await Promise.all([
    prisma.user.count({ where: { role: UserRole.PATIENT } }),
    prisma.user.count({ where: { role: UserRole.DOCTOR } }),
    prisma.user.count({ where: { role: UserRole.CLINIC } }),
    prisma.clinic.count({ where: { verificationStatus: "PENDING" } }),
    prisma.doctor.count({ where: { verificationStatus: "PENDING" } }),
    prisma.settlement.count({ where: { status: "PENDING" } }),
    prisma.complaint.count({ where: { status: { in: ["PENDING", "UNDER_INVESTIGATION"] } } }),
    prisma.bookingAppointment.count(),
    prisma.bookingAppointment.count({ where: { status: BookingStatus.PENDING } }),
    prisma.bookingAppointment.count({ where: { status: BookingStatus.CONFIRMED } }),
    prisma.bookingAppointment.count({ where: { status: BookingStatus.COMPLETE } }),
  ]);

  return {
    patientCount,
    doctorCount,
    clinicCount,
    pendingVerifications: pendingClinicVerifications + pendingDoctorVerifications,
    pendingSettlements,
    openComplaints,
    totalBookings,
    pendingBookings,
    confirmedBookings,
    completedBookings,
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

const updateWallet = async (userId: string, amount: number, currentAdmin?: any) => {
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

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: amount >= 0 ? "WALLET_TOP_UP" : "WALLET_DEDUCT",
    targetType: "WALLET",
    targetId: userId,
    details: {
      userId,
      amount,
      userRole: user.role,
      userFullName: user.fullName || user.phoneNumber,
    },
  });

  return result;
};

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
          badgeActive: true,
          isVisible: true,
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
    badgeActive: user.clinic?.badgeActive || false,
    isVisible: user.clinic?.isVisible !== false,
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

const AdminClinicVerified = async (clinicId: string, adminVerified: boolean, currentAdmin?: any) => {
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

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: adminVerified ? "CLINIC_VERIFIED" : "CLINIC_UNVERIFIED",
    targetType: "CLINIC",
    targetId: existingClinic.id,
    details: { clinicName: existingClinic.clinicName, adminVerified },
  });

  return result;
};

const suspendUserWithRefund = async (targetId: string, suspended: boolean, reason?: string, currentAdmin?: any) => {
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

    await createAuditLog({
      adminId: currentAdmin?.id,
      adminName: currentAdmin?.fullName,
      adminTier: currentAdmin?.adminTier,
      action: `${user.role || 'USER'}_ACTIVATED`,
      targetType: user.role || 'USER',
      targetId: targetId,
      details: { userId: user.id, fullName: user.fullName, role: user.role, reason },
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
      const providerName = doctorId
        ? `Dr. ${apt.doctor?.user?.fullName || ''}`
        : `${apt.clinic?.clinicName || 'Clinic'}`;

      try {
        await BookingService.cancelBooking(
          apt.id,
          adminUser?.id,
          "ADMIN",
          `Cancelled due to provider suspension (${providerName})`
        );
        cancelledCount++;
      } catch (err) {
        console.error(
          `Failed to cancel booking ${apt.id} during suspension:`,
          err
        );
      }
    }
  }

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: `${user.role || 'USER'}_SUSPENDED`,
    targetType: user.role || 'USER',
    targetId: targetId,
    details: {
      userId: user.id,
      fullName: user.fullName,
      role: user.role,
      cancelledAppointmentsCount: cancelledCount,
      reason,
    },
  });

  return {
    user: updatedUser,
    cancelledAppointmentsCount: cancelledCount,
    totalRefundedAmount: totalRefunded,
    message: `${user.role || 'User'} suspended successfully. ${cancelledCount} future appointments were automatically cancelled with 100% refunds issued to patients.`,
  };
};

const bannedUser = async (userId: string, banned: boolean, reason?: string, currentAdmin?: any) => {
  return await suspendUserWithRefund(userId, banned, reason, currentAdmin);
};

const suspendDoctor = async (doctorId: string, suspended: boolean, reason?: string, currentAdmin?: any) => {
  return await suspendUserWithRefund(doctorId, suspended, reason, currentAdmin);
};

const suspendClinic = async (clinicId: string, suspended: boolean, reason?: string, currentAdmin?: any) => {
  return await suspendUserWithRefund(clinicId, suspended, reason, currentAdmin);
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

const SetServiceFree = async (userId: string, serviceFree: number, currentAdmin?: any) => {
  let clinicUserId: string | undefined;

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (targetUser) {
    clinicUserId = targetUser.id;
  } else {
    const clinic = await prisma.clinic.findUnique({
      where: { id: userId },
      select: { userId: true },
    });
    if (clinic) {
      clinicUserId = clinic.userId;
    }
  }

  if (!clinicUserId) {
    throw new ApiError(httpStatus.NOT_FOUND, "User or Clinic not found");
  }

  const feeValue = Number(serviceFree) || 0;

  const clinic = await prisma.$transaction(async (tx) => {
    if (feeValue > 0) {
      await tx.clinic.update({
        where: { userId: clinicUserId },
        data: {
          trial: false,
          serviceFeePercentage: feeValue,
        },
      });
    } else {
      await tx.clinic.update({
        where: { userId: clinicUserId },
        data: {
          trial: true,
          serviceFeePercentage: 0,
        },
      });
    }

    const result = await tx.user.update({
      where: { id: clinicUserId },
      data: {
        serviceFree: feeValue,
      },
    });

    return result;
  });

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "SET_CLINIC_SERVICE_FEE",
    targetType: "CLINIC",
    targetId: clinicUserId,
    details: { serviceFeePercentage: feeValue },
  });

  return clinic;
};

// patient notification from admin
const createPatientNotification = async (payload: { userId: string[], title: string, description: string }, currentAdmin?: any) => {
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

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "BROADCAST_PATIENT_NOTIFICATION",
    targetType: "NOTIFICATION",
    details: { recipientCount: userId.length, title },
  });

  return { success: true, message: `Queued ${userId.length} notifications to be sent.` };
};

// Clinic notification from admin
const createClinicNotification = async (payload: { userId: string[], title: string, description: string }, currentAdmin?: any) => {
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

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "BROADCAST_CLINIC_NOTIFICATION",
    targetType: "NOTIFICATION",
    details: { recipientCount: userId.length, title },
  });

  return { success: true, message: `Queued ${userId.length} notifications to be sent.` };
};

// Section 5: Admin Manual Override
const overrideAppointmentStatus = async (
  appointmentId: string,
  newStatus: BookingStatus,
  reason?: string,
  currentAdmin?: any
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

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "BOOKING_STATUS_OVERRIDE",
    targetType: "BOOKING",
    targetId: appointmentId,
    details: {
      oldStatus: appointment.status,
      newStatus,
      reason: reasonText,
      serialNumber: appointment.serialNumber,
      clinicId: appointment.clinicId,
      doctorId: appointment.doctorId,
    },
  });

  return result;
};

// ================= SECTION 9: MAIN ADMIN CONTROL CENTER =================

// 1. Clinic Visibility Control
const updateClinicVisibility = async (clinicId: string, isVisible: boolean, adminUser?: any) => {
  const existingClinic = await prisma.clinic.findFirst({
    where: {
      OR: [{ id: clinicId }, { userId: clinicId }],
    },
  });

  if (!existingClinic) {
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");
  }

  const result = await prisma.clinic.update({
    where: { id: existingClinic.id },
    data: { isVisible },
  });

  await createAuditLog({
    adminId: adminUser?.id,
    adminName: adminUser?.fullName,
    adminTier: adminUser?.adminTier,
    action: isVisible ? "CLINIC_VISIBILITY_ENABLED" : "CLINIC_VISIBILITY_DISABLED",
    targetType: "CLINIC",
    targetId: existingClinic.id,
    details: { clinicName: existingClinic.clinicName, isVisible },
  });

  return result;
};

// 2. Admin Staff (5 Tiers) Management
const getAdminStaff = async (filters: any, options: IPaginationOptions) => {
  const { limit, page, skip, sortBy, sortOrder } = paginationHelpers.calculatePagination(options);
  const { searchTerm, adminTier, status } = filters;

  const andConditions: Prisma.UserWhereInput[] = [{ role: UserRole.ADMIN }];

  if (searchTerm) {
    andConditions.push({
      OR: [
        { fullName: { contains: searchTerm, mode: "insensitive" } },
        { email: { contains: searchTerm, mode: "insensitive" } },
        { phoneNumber: { contains: searchTerm, mode: "insensitive" } },
      ],
    });
  }

  if (adminTier) {
    andConditions.push({ adminTier: adminTier as AdminTier });
  }

  if (status) {
    andConditions.push({ status: status as UserStatus });
  }

  const whereConditions: Prisma.UserWhereInput = andConditions.length > 0 ? { AND: andConditions } : {};

  const [total, result] = await Promise.all([
    prisma.user.count({ where: whereConditions }),
    prisma.user.findMany({
      where: whereConditions,
      skip,
      take: limit,
      orderBy: sortBy && sortOrder ? { [sortBy]: sortOrder } : { createdAt: "desc" },
      select: {
        id: true,
        fullName: true,
        email: true,
        phoneNumber: true,
        role: true,
        adminTier: true,
        status: true,
        profileImage: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  return {
    meta: { page, limit, total },
    data: result,
  };
};

const createAdminStaff = async (payload: any, currentAdmin?: any) => {
  const { fullName, email, phoneNumber, password, adminTier } = payload;

  if (!phoneNumber || !password) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Phone number and password are required");
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { phoneNumber },
        ...(email ? [{ email }] : []),
      ],
    },
  });

  if (existingUser) {
    throw new ApiError(httpStatus.CONFLICT, "User with this phone number or email already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const newUser = await prisma.user.create({
    data: {
      fullName: fullName || "Admin Staff",
      phoneNumber,
      email: email || null,
      password: hashedPassword,
      role: UserRole.ADMIN,
      adminTier: (adminTier || AdminTier.OPERATIONS) as AdminTier,
      status: UserStatus.ACTIVE,
      profileCompleted: true,
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      phoneNumber: true,
      role: true,
      adminTier: true,
      status: true,
      createdAt: true,
    },
  });

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "CREATE_ADMIN_STAFF",
    targetType: "USER",
    targetId: newUser.id,
    details: { fullName: newUser.fullName, phoneNumber: newUser.phoneNumber, adminTier: newUser.adminTier },
  });

  return newUser;
};

const updateAdminStaffTier = async (staffId: string, adminTier: AdminTier, currentAdmin?: any) => {
  const staff = await prisma.user.findUnique({
    where: { id: staffId },
  });

  if (!staff || staff.role !== UserRole.ADMIN) {
    throw new ApiError(httpStatus.NOT_FOUND, "Admin staff not found");
  }

  const updatedStaff = await prisma.user.update({
    where: { id: staffId },
    data: { adminTier },
    select: {
      id: true,
      fullName: true,
      email: true,
      phoneNumber: true,
      role: true,
      adminTier: true,
      status: true,
      updatedAt: true,
    },
  });

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "UPDATE_ADMIN_TIER",
    targetType: "USER",
    targetId: staffId,
    details: { oldTier: staff.adminTier, newTier: adminTier },
  });

  return updatedStaff;
};

const toggleAdminStaffStatus = async (staffId: string, status: UserStatus, currentAdmin?: any) => {
  const staff = await prisma.user.findUnique({
    where: { id: staffId },
  });

  if (!staff || staff.role !== UserRole.ADMIN) {
    throw new ApiError(httpStatus.NOT_FOUND, "Admin staff not found");
  }

  if (currentAdmin?.id === staffId && status !== UserStatus.ACTIVE) {
    throw new ApiError(httpStatus.BAD_REQUEST, "You cannot suspend your own administrative account");
  }

  const updatedStaff = await prisma.user.update({
    where: { id: staffId },
    data: { status },
    select: {
      id: true,
      fullName: true,
      email: true,
      phoneNumber: true,
      role: true,
      adminTier: true,
      status: true,
      updatedAt: true,
    },
  });

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: status === UserStatus.ACTIVE ? "ACTIVATE_ADMIN_STAFF" : "SUSPEND_ADMIN_STAFF",
    targetType: "USER",
    targetId: staffId,
    details: { status },
  });

  return updatedStaff;
};

// 3. Administrative Audit Logs
const getAuditLogs = async (filters: any, options: IPaginationOptions) => {
  const { limit, page, skip, sortBy, sortOrder } = paginationHelpers.calculatePagination(options);
  const { searchTerm, action, targetType, adminId, startDate, endDate } = filters;

  const andConditions: Prisma.AdminAuditLogWhereInput[] = [];

  if (searchTerm) {
    andConditions.push({
      OR: [
        { action: { contains: searchTerm, mode: "insensitive" } },
        { adminName: { contains: searchTerm, mode: "insensitive" } },
        { targetType: { contains: searchTerm, mode: "insensitive" } },
        { targetId: { contains: searchTerm, mode: "insensitive" } },
      ],
    });
  }

  if (action) {
    andConditions.push({ action });
  }

  if (targetType) {
    andConditions.push({ targetType });
  }

  if (adminId) {
    andConditions.push({ adminId });
  }

  if (startDate || endDate) {
    andConditions.push({
      createdAt: {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate) } : {}),
      },
    });
  }

  const whereConditions: Prisma.AdminAuditLogWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const [total, result] = await Promise.all([
    prisma.adminAuditLog.count({ where: whereConditions }),
    prisma.adminAuditLog.findMany({
      where: whereConditions,
      skip,
      take: limit,
      orderBy: sortBy && sortOrder ? { [sortBy]: sortOrder } : { createdAt: "desc" },
      include: {
        admin: {
          select: {
            id: true,
            fullName: true,
            phoneNumber: true,
            email: true,
            adminTier: true,
          },
        },
      },
    }),
  ]);

  return {
    meta: { page, limit, total },
    data: result,
  };
};

// 4. Platform Booking Settings
const getBookingSettings = async () => {
  let settings = await prisma.platformBookingSetting.findFirst();
  if (!settings) {
    settings = await prisma.platformBookingSetting.create({
      data: {
        id: "default-platform-settings",
        advanceBookingDays: 14,
        cancellationCutoffHours: 12,
        reminder24hEnabled: true,
        reminder3hEnabled: true,
        neglectedResolutionHours: 12,
        autoRejectTimeoutMinutes: 30,
      },
    });
  }
  return settings;
};

const updateBookingSettings = async (payload: any, currentAdmin?: any) => {
  const current = await getBookingSettings();
  const updated = await prisma.platformBookingSetting.update({
    where: { id: current.id },
    data: {
      advanceBookingDays: payload.advanceBookingDays !== undefined ? Number(payload.advanceBookingDays) : current.advanceBookingDays,
      cancellationCutoffHours: payload.cancellationCutoffHours !== undefined ? Number(payload.cancellationCutoffHours) : current.cancellationCutoffHours,
      reminder24hEnabled: payload.reminder24hEnabled !== undefined ? Boolean(payload.reminder24hEnabled) : current.reminder24hEnabled,
      reminder3hEnabled: payload.reminder3hEnabled !== undefined ? Boolean(payload.reminder3hEnabled) : current.reminder3hEnabled,
      neglectedResolutionHours: payload.neglectedResolutionHours !== undefined ? Number(payload.neglectedResolutionHours) : current.neglectedResolutionHours,
      autoRejectTimeoutMinutes: payload.autoRejectTimeoutMinutes !== undefined ? Number(payload.autoRejectTimeoutMinutes) : current.autoRejectTimeoutMinutes,
    },
  });

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: "UPDATE_BOOKING_SETTINGS",
    targetType: "SETTINGS",
    targetId: updated.id,
    details: { before: current, after: updated },
  });

  return updated;
};

// 5. Platform Financials & Wallet Ledger Overview
const getPlatformFinancialOverview = async () => {
  const [
    totalUsers,
    totalPatients,
    totalDoctors,
    totalClinics,
    walletsSum,
    patientFees,
    adminTransactions,
    settlementsGroup,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: UserRole.PATIENT } }),
    prisma.user.count({ where: { role: UserRole.DOCTOR } }),
    prisma.user.count({ where: { role: UserRole.CLINIC } }),
    prisma.user.aggregate({
      _sum: {
        wallet: true,
        frozenWallet: true,
      },
    }),
    prisma.patientServiceFee.findMany(),
    prisma.adminTransaction.aggregate({
      _sum: {
        patientServiceFee: true,
        clinicServiceFee: true,
        totalAmount: true,
      },
    }),
    prisma.settlement.groupBy({
      by: ["status"],
      _sum: { amount: true },
      _count: { id: true },
    }),
  ]);

  return {
    totalUsers,
    totalPatients,
    totalDoctors,
    totalClinics,
    wallets: {
      totalActiveWallet: walletsSum._sum.wallet || 0,
      totalFrozenWallet: walletsSum._sum.frozenWallet || 0,
    },
    capturedFees: {
      patientServiceFee: adminTransactions._sum.patientServiceFee || 0,
      clinicServiceFee: adminTransactions._sum.clinicServiceFee || 0,
      totalAmount: adminTransactions._sum.totalAmount || 0,
    },
    countryPatientFees: patientFees,
    settlementsSummary: settlementsGroup,
  };
};

// Section 10: Dedicated Traceable Financial Ledger (10 Fields & 7 Distinct Categories)
const getFinancialLedger = async (filters: any, options: IPaginationOptions) => {
  const { limit, page, skip } = paginationHelpers.calculatePagination(options);
  const { searchTerm, category, type, startDate, endDate } = filters;

  const targetCategory = (category || type || "ALL").toUpperCase();

  const dateFilter: any = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) {
    const end = new Date(endDate);
    if (typeof endDate === "string" && !endDate.includes("T")) {
      end.setHours(23, 59, 59, 999);
    }
    dateFilter.lte = end;
  }
  const hasDateFilter = Object.keys(dateFilter).length > 0;

  const [topUps, adminTransactions, settlements, auditLogs, bookings] = await Promise.all([
    prisma.topUp.findMany({
      where: hasDateFilter ? { createdAt: dateFilter } : undefined,
      include: {
        user: true,
        prepaidCard: true,
        appointment: {
          include: {
            clinic: true,
            doctor: { include: { user: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.adminTransaction.findMany({
      where: hasDateFilter ? { createdAt: dateFilter } : undefined,
      include: {
        user: true,
        clinic: true,
        appointment: {
          include: {
            clinic: true,
            doctor: { include: { user: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.settlement.findMany({
      where: hasDateFilter ? { createdAt: dateFilter } : undefined,
      include: {
        clinic: true,
        doctor: { include: { user: true } },
        processedBy: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.adminAuditLog.findMany({
      where: {
        action: "WALLET_BALANCE_UPDATED",
        ...(hasDateFilter ? { createdAt: dateFilter } : {}),
      },
      include: { admin: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.bookingAppointment.findMany({
      where: {
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETE, BookingStatus.NOT_SHOW] },
        OR: [
          { serviceFeeAmount: { gt: 0 } },
          { patientServiceFee: { gt: 0 } },
          { clinicServiceFee: { gt: 0 } },
        ],
        ...(hasDateFilter ? { createdAt: dateFilter } : {}),
      },
      include: {
        clinic: true,
        doctor: { include: { user: true } },
        patient: { include: { user: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const allEntries: any[] = [];

  // 1. TopUps mapping
  topUps.forEach((t) => {
    let cat = "WALLET_TRANSACTION";
    if (t.type === "REFERALL") cat = "REFERRAL";
    else if (t.type === "REFUND" || t.type === "CANCEL") cat = "REFUND";
    else if (t.type === "PENALTY") cat = "ADJUSTMENT";
    else if (t.cardNumber || t.type === "RECHARGE") cat = "PREPAID_CARD";
    else if (t.type === "BOOKING") cat = "WALLET_TRANSACTION";

    allEntries.push({
      id: t.id,
      transactionId: `TX-${t.id.slice(-8).toUpperCase()}`,
      bookingId: t.appointmentId || null,
      bookingNumber: t.appointment?.serialNumber || null,
      userName: t.user?.fullName || t.user?.phoneNumber || "User",
      userPhone: t.user?.phoneNumber || "—",
      userRole: t.user?.role || "PATIENT",
      clinicName: t.appointment?.clinic?.clinicName || null,
      doctorName: t.appointment?.doctor?.user?.fullName || null,
      amount: t.amount,
      type: cat,
      status: "COMPLETED",
      date: t.createdAt.toISOString(),
      reference: t.cardNumber
        ? `Card #${t.cardNumber}`
        : t.appointment
        ? `Booking #${t.appointment.serialNumber}`
        : `Wallet ${t.type}`,
    });
  });

  // 2. AdminTransactions mapping (Service Fee)
  adminTransactions.forEach((a) => {
    allEntries.push({
      id: a.id,
      transactionId: `FEE-${a.id.slice(-8).toUpperCase()}`,
      bookingId: a.appointmentId || null,
      bookingNumber: a.appointment?.serialNumber || null,
      userName: a.user?.fullName || a.user?.phoneNumber || "Patient",
      userPhone: a.user?.phoneNumber || "—",
      userRole: a.user?.role || "PATIENT",
      clinicName: a.clinic?.fullName || a.appointment?.clinic?.clinicName || null,
      doctorName: a.appointment?.doctor?.user?.fullName || null,
      amount: a.patientServiceFee + a.clinicServiceFee,
      type: "SERVICE_FEE",
      status: "COMPLETED",
      date: a.createdAt.toISOString(),
      reference: `Platform Fee (Patient: ${a.patientServiceFee} LYD, Clinic: ${a.clinicServiceFee} LYD)`,
    });
  });

  // 3. Settlements mapping (Clinic Payables)
  settlements.forEach((s) => {
    allEntries.push({
      id: s.id,
      transactionId: s.settlementNumber || `SET-${s.id.slice(-8).toUpperCase()}`,
      bookingId: null,
      bookingNumber: null,
      userName: s.clinic?.clinicName || "Clinic",
      userPhone: s.clinic?.managerPhone || "—",
      userRole: s.partyType || "CLINIC",
      clinicName: s.clinic?.clinicName || null,
      doctorName: s.doctor?.user?.fullName || null,
      amount: s.amount,
      type: "CLINIC_PAYABLE",
      status: s.status,
      date: s.createdAt.toISOString(),
      reference: s.reference || s.receiptUrl || "Settlement Payout",
    });
  });

  // 4. AuditLogs mapping (Adjustments)
  auditLogs.forEach((l) => {
    const details = l.details as any;
    const diff = details?.diff ?? details?.amount ?? 0;
    allEntries.push({
      id: l.id,
      transactionId: `ADJ-${l.id.slice(-8).toUpperCase()}`,
      bookingId: null,
      bookingNumber: null,
      userName: details?.targetUserId
        ? `User (${String(details.targetUserId).slice(-6)})`
        : "User",
      userPhone: "—",
      userRole: "ADJUSTMENT",
      clinicName: null,
      doctorName: null,
      amount: Math.abs(diff),
      type: "ADJUSTMENT",
      status: "COMPLETED",
      date: l.createdAt.toISOString(),
      reference: `Admin ${l.adminName || "Admin"} adjusted: ${diff > 0 ? "+" : ""}${diff} LYD`,
    });
  });

  // 5. Bookings Platform Revenue (avoid duplicating AdminTransactions)
  const existingApptIds = new Set(adminTransactions.map((a) => a.appointmentId));
  bookings.forEach((b) => {
    if (!existingApptIds.has(b.id)) {
      allEntries.push({
        id: `rev-${b.id}`,
        transactionId: `REV-${b.id.slice(-8).toUpperCase()}`,
        bookingId: b.id,
        bookingNumber: b.serialNumber,
        userName: b.patient?.user?.fullName || b.patient?.user?.phoneNumber || "Patient",
        userPhone: b.patient?.user?.phoneNumber || "—",
        userRole: "PATIENT",
        clinicName: b.clinic?.clinicName || null,
        doctorName: b.doctor?.user?.fullName || null,
        amount: b.serviceFeeAmount || (b.patientServiceFee + b.clinicServiceFee) || 0,
        type: "PLATFORM_REVENUE",
        status: "COMPLETED",
        date: b.createdAt.toISOString(),
        reference: `Platform Fee from Booking #${b.serialNumber}`,
      });
    }
  });

  // Sort by date descending
  allEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Filter by category
  let filtered = allEntries;
  if (targetCategory && targetCategory !== "ALL") {
    filtered = filtered.filter((item) => item.type === targetCategory);
  }

  // Filter by searchTerm
  if (searchTerm && searchTerm.trim()) {
    const q = searchTerm.toLowerCase().trim();
    filtered = filtered.filter(
      (item) =>
        (item.transactionId && item.transactionId.toLowerCase().includes(q)) ||
        (item.bookingId && item.bookingId.toLowerCase().includes(q)) ||
        (item.bookingNumber && String(item.bookingNumber).includes(q)) ||
        (item.userName && item.userName.toLowerCase().includes(q)) ||
        (item.userPhone && item.userPhone.toLowerCase().includes(q)) ||
        (item.clinicName && item.clinicName.toLowerCase().includes(q)) ||
        (item.doctorName && item.doctorName.toLowerCase().includes(q)) ||
        (item.reference && item.reference.toLowerCase().includes(q)) ||
        (item.type && item.type.toLowerCase().includes(q))
    );
  }

  const summary = {
    PLATFORM_REVENUE: allEntries
      .filter((e) => e.type === "PLATFORM_REVENUE")
      .reduce((sum, e) => sum + e.amount, 0),
    SERVICE_FEE: allEntries
      .filter((e) => e.type === "SERVICE_FEE")
      .reduce((sum, e) => sum + e.amount, 0),
    WALLET_TRANSACTION: allEntries
      .filter((e) => e.type === "WALLET_TRANSACTION")
      .reduce((sum, e) => sum + e.amount, 0),
    REFUND: allEntries
      .filter((e) => e.type === "REFUND")
      .reduce((sum, e) => sum + e.amount, 0),
    PREPAID_CARD: allEntries
      .filter((e) => e.type === "PREPAID_CARD")
      .reduce((sum, e) => sum + e.amount, 0),
    ADJUSTMENT: allEntries
      .filter((e) => e.type === "ADJUSTMENT")
      .reduce((sum, e) => sum + e.amount, 0),
    CLINIC_PAYABLE: allEntries
      .filter((e) => e.type === "CLINIC_PAYABLE")
      .reduce((sum, e) => sum + e.amount, 0),
    REFERRAL: allEntries
      .filter((e) => e.type === "REFERRAL")
      .reduce((sum, e) => sum + e.amount, 0),
    totalCount: allEntries.length,
  };

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const paginatedData = filtered.slice(skip, skip + limit);

  return {
    meta: {
      page,
      limit,
      total,
      totalPages,
    },
    summary,
    data: paginatedData,
  };
};

// 6. Settlements Management
const getSettlements = async (filters: any, options: IPaginationOptions) => {
  const { limit, page, skip, sortBy, sortOrder } = paginationHelpers.calculatePagination(options);
  const { searchTerm, status, partyType, clinicId, doctorId } = filters;

  const andConditions: Prisma.SettlementWhereInput[] = [];

  if (searchTerm) {
    andConditions.push({
      OR: [
        { settlementNumber: { contains: searchTerm, mode: "insensitive" } },
        { reference: { contains: searchTerm, mode: "insensitive" } },
        { notes: { contains: searchTerm, mode: "insensitive" } },
        { clinic: { clinicName: { contains: searchTerm, mode: "insensitive" } } },
      ],
    });
  }

  if (status) {
    andConditions.push({ status });
  }

  if (partyType) {
    andConditions.push({ partyType });
  }

  if (clinicId) {
    andConditions.push({ clinicId });
  }

  if (doctorId) {
    andConditions.push({ doctorId });
  }

  const whereConditions: Prisma.SettlementWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const [total, result] = await Promise.all([
    prisma.settlement.count({ where: whereConditions }),
    prisma.settlement.findMany({
      where: whereConditions,
      skip,
      take: limit,
      orderBy: sortBy && sortOrder ? { [sortBy]: sortOrder } : { createdAt: "desc" },
      include: {
        clinic: {
          select: {
            id: true,
            clinicName: true,
            logo: true,
            contactPhone: true,
            user: {
              select: {
                id: true,
                fullName: true,
                phoneNumber: true,
                wallet: true,
              },
            },
          },
        },
        doctor: {
          select: {
            id: true,
            user: {
              select: {
                id: true,
                fullName: true,
                phoneNumber: true,
                wallet: true,
              },
            },
          },
        },
        processedBy: {
          select: {
            id: true,
            fullName: true,
            phoneNumber: true,
            adminTier: true,
          },
        },
      },
    }),
  ]);

  return {
    meta: { page, limit, total },
    data: result,
  };
};

const createSettlement = async (payload: any, currentParty?: any) => {
  const { partyType, clinicId, doctorId, amount, notes } = payload;

  if (!amount || Number(amount) <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Valid settlement amount is required");
  }

  const settlementNumber = `SET-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const newSettlement = await prisma.settlement.create({
    data: {
      settlementNumber,
      partyType: partyType || (clinicId ? "CLINIC" : "DOCTOR"),
      clinicId: clinicId || null,
      doctorId: doctorId || null,
      amount: Number(amount),
      status: "PENDING",
      notes: notes || null,
    },
    include: {
      clinic: true,
      doctor: true,
    },
  });

  return newSettlement;
};

const updateSettlementStatus = async (settlementId: string, payload: any, currentAdmin?: any) => {
  const { status, reference, receiptUrl, notes } = payload;

  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
    include: { clinic: { include: { user: true } } },
  });

  if (!settlement) {
    throw new ApiError(httpStatus.NOT_FOUND, "Settlement record not found");
  }

  const updateData: any = {
    status,
    notes: notes !== undefined ? notes : settlement.notes,
    reference: reference !== undefined ? reference : settlement.reference,
    receiptUrl: receiptUrl !== undefined ? receiptUrl : settlement.receiptUrl,
    processedByAdminId: currentAdmin?.id,
  };

  if (status === "APPROVED" && !settlement.processedAt) {
    updateData.processedAt = new Date();
  }

  if (status === "COMPLETED") {
    updateData.completedAt = new Date();
    if (!settlement.processedAt) {
      updateData.processedAt = new Date();
    }
  }

  const result = await prisma.settlement.update({
    where: { id: settlementId },
    data: updateData,
    include: {
      clinic: true,
      doctor: true,
      processedBy: true,
    },
  });

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: `SETTLEMENT_${status}`,
    targetType: "SETTLEMENT",
    targetId: settlementId,
    details: {
      settlementNumber: settlement.settlementNumber,
      amount: settlement.amount,
      oldStatus: settlement.status,
      newStatus: status,
      reference,
    },
  });

  return result;
};

// 7. Complaints & Dispute Handling
const getComplaints = async (filters: any, options: IPaginationOptions) => {
  const { limit, page, skip, sortBy, sortOrder } = paginationHelpers.calculatePagination(options);
  const { searchTerm, status, targetType } = filters;

  const andConditions: Prisma.ComplaintWhereInput[] = [];

  if (searchTerm) {
    andConditions.push({
      OR: [
        { complaintNumber: { contains: searchTerm, mode: "insensitive" } },
        { subject: { contains: searchTerm, mode: "insensitive" } },
        { description: { contains: searchTerm, mode: "insensitive" } },
        { complainant: { fullName: { contains: searchTerm, mode: "insensitive" } } },
      ],
    });
  }

  if (status) {
    andConditions.push({ status });
  }

  if (targetType) {
    andConditions.push({ targetType });
  }

  const whereConditions: Prisma.ComplaintWhereInput =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const [total, result] = await Promise.all([
    prisma.complaint.count({ where: whereConditions }),
    prisma.complaint.findMany({
      where: whereConditions,
      skip,
      take: limit,
      orderBy: sortBy && sortOrder ? { [sortBy]: sortOrder } : { createdAt: "desc" },
      include: {
        complainant: {
          select: {
            id: true,
            fullName: true,
            phoneNumber: true,
            role: true,
            email: true,
          },
        },
        resolvedBy: {
          select: {
            id: true,
            fullName: true,
            adminTier: true,
          },
        },
        booking: {
          select: {
            id: true,
            serialNumber: true,
            consultDate: true,
            status: true,
          },
        },
      },
    }),
  ]);

  return {
    meta: { page, limit, total },
    data: result,
  };
};

const getComplaintById = async (complaintId: string) => {
  const result = await prisma.complaint.findUnique({
    where: { id: complaintId },
    include: {
      complainant: {
        select: {
          id: true,
          fullName: true,
          phoneNumber: true,
          role: true,
          email: true,
        },
      },
      resolvedBy: {
        select: {
          id: true,
          fullName: true,
          adminTier: true,
        },
      },
      booking: true,
    },
  });

  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, "Complaint not found");
  }

  return result;
};

const createComplaint = async (payload: any, currentUser: any) => {
  const { targetType, targetId, bookingId, subject, description } = payload;

  if (!subject || !description) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Subject and description are required");
  }

  const complaintNumber = `CMP-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const result = await prisma.complaint.create({
    data: {
      complaintNumber,
      complainantId: currentUser.id,
      complainantRole: currentUser.role,
      targetType: targetType || "SYSTEM",
      targetId: targetId || null,
      bookingId: bookingId || null,
      subject,
      description,
      status: "PENDING",
    },
    include: {
      complainant: true,
    },
  });

  return result;
};

const resolveComplaint = async (complaintId: string, payload: any, currentAdmin?: any) => {
  const { status, adminNotes, resolution } = payload;

  const complaint = await prisma.complaint.findUnique({
    where: { id: complaintId },
  });

  if (!complaint) {
    throw new ApiError(httpStatus.NOT_FOUND, "Complaint not found");
  }

  const updateData: any = {
    status: status || "RESOLVED",
    adminNotes: adminNotes !== undefined ? adminNotes : complaint.adminNotes,
    resolution: resolution !== undefined ? resolution : complaint.resolution,
    resolvedByAdminId: currentAdmin?.id,
    resolvedAt: new Date(),
  };

  const result = await prisma.complaint.update({
    where: { id: complaintId },
    data: updateData,
    include: {
      complainant: true,
      resolvedBy: true,
    },
  });

  await createAuditLog({
    adminId: currentAdmin?.id,
    adminName: currentAdmin?.fullName,
    adminTier: currentAdmin?.adminTier,
    action: `COMPLAINT_${status || "RESOLVED"}`,
    targetType: "COMPLAINT",
    targetId: complaintId,
    details: {
      complaintNumber: complaint.complaintNumber,
      subject: complaint.subject,
      resolution,
      adminNotes,
    },
  });

  return result;
};

export const AdminService = {
  getDoctors,
  getPatients,
  getClinics,
  AdminClinicVerified,
  updateClinicVisibility,
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
  // Section 9 new methods:
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
