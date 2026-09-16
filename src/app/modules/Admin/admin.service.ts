import { Prisma, TopUpType, UserRole, UserStatus } from "@prisma/client";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { IPaginationOptions } from "../../../interfaces/paginations";
import ApiError from "../../../errors/ApiErrors";
import httpStatus from "http-status";
import { Notification } from "../Notification/notification.service";
import { adminNotificationQueue } from "../../jobs";




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
      createdAt: true,
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
    fullName: user.fullName,
    gender: user.gender,
    dateOfBirth: user.dateOfBirth,
    country: user.country,
    city: user.city,
    address: user.address,
    profileImage: user.profileImage,
    email: user.email,
    phoneNumber: user.phoneNumber,
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
      clinic: {
        select: {
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

  // console.log(`Found ${total} clinics matching search criteria`);
  // if (result.length > 0) {
  //   console.log("First result sample:", {
  //     phoneNumber: result[0].phoneNumber,
  //     clinicName: result[0].clinic?.clinicName,
  //     managerPhone: result[0].clinic?.managerPhone
  //   });
  // }

  const processedData = result.map(user => ({
    id: user.id,
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
  }));

  return {
    meta: { page, limit, total },
    data: processedData
  };
};

const AdminClinicVerified = async (clinicId: string, adminVerified: boolean) => {

  const clinic = await prisma.user.findUnique({
    where: {
      id: clinicId
    }
  });

  if (!clinic) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Clinic not found');
  }

  const result = await prisma.clinic.update({
    where: {
      userId: clinicId
    },
    data: {
      adminVerified: adminVerified
    }
  });
  return result;
}

const bannedUser = async (userId: string, banned: boolean) => {
  const user = await prisma.user.update({
    where: {
      id: userId
    },
    data: {
      banned: banned
    }
  });
  return user;
}


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

export const AdminService = {
  getDoctors,
  getPatients,
  getClinics,
  AdminClinicVerified,
  AdminStats,
  bannedUser,
  getPatientPlatformSubscription,
  getClinicPlatformSubscription,
  SetServiceFree,
  updateWallet,
  createPatientNotification,
  createClinicNotification
};
