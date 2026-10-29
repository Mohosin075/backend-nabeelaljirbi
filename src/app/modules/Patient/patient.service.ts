import { Prisma, UserRole, BookingStatus, UserStatus, Country } from "@prisma/client";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { IPaginationOptions } from "../../../interfaces/paginations";
import { generateTokens } from "../Auth/auth.service";
import { BookingService } from "../Booking/booking.service";
import { money, percentageAmount } from "../../../utils/money";

const now = Date.now();

interface DoctorFilters {
  search?: string; // name or speciality
  rating?: number; // minimum avg rating
  consultFee?: number; // max fee
  city?: string;
  country?: string;
  speciality?: string;
  specialty?: string;
  specialistId?: string;
}

const getPatientProfile = async (userId: string) => {
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
      profileCompleted: true,
      platformSubscriptionActive: true,
      wallet: true,
      email: true,
      //
      referralCode: true,
      totalReferrals: true,
      totalEarnings: true,
      currentEarnings: true,
      patient: {
        select: {
          latitude: true,
          longitude: true,
        },
      },
      patientInsurances: {
        select: {
          id: true,
          insuranceDetails: true,
          image: true,
        },
      },
    },
  });

  const activeSubscription =
    await prisma.purchasePatientPlatformSubscription.findFirst({
      where: {
        userId: userId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");

  return { user, activeSubscription };
};

const updatePatientProfile = async (userId: string, payload: any) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  if (user.role !== UserRole.PATIENT) {
    throw new ApiError(httpStatus.FORBIDDEN, "Only patient accounts can update patient profiles");
  }

  const { accessToken } = generateTokens(user, UserRole.PATIENT);

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
      patient: {
        upsert: {
          create: {
            latitude:
              payload.latitude !== undefined
                ? parseFloat(payload.latitude)
                : undefined,
            longitude:
              payload.longitude !== undefined
                ? parseFloat(payload.longitude)
                : undefined,
          },
          update: {
            ...(payload.latitude !== undefined && {
              latitude: parseFloat(payload.latitude),
            }),
            ...(payload.longitude !== undefined && {
              longitude: parseFloat(payload.longitude),
            }),
          },
        },
      },
    },

    // 👇 RETURN ONLY REQUIRED FIELDS
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
      wallet: true,
      email: true,
      accessToken: true,
      patient: {
        select: {
          latitude: true,
          longitude: true,
        },
      },
    },
  });

  return updatedUser;
};

const getPopularDoctors = async (
  filters: DoctorFilters,
  options: IPaginationOptions,
) => {
  const { page, skip, limit } = paginationHelpers.calculatePagination(options);

  const { search, rating, consultFee, speciality, city, country } = filters;

  // console.log(search, rating, consultFee, speciality, city, country)

  // 1️⃣ Build Prisma WHERE conditions
  const andConditions: Prisma.UserWhereInput[] = [
    {
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      banned: false,
      doctor: {
        is: {
          adminVerified: true,
          doctorClinics: {
            some: {
              isActive: true,
              clinic: {
                is: {
                  adminVerified: true,
                  isVisible: true,
                  user: { is: { status: UserStatus.ACTIVE, banned: false } },
                },
              },
            },
          },
        },
      },
    },
  ];

  if (city) {
    andConditions.push({ city });
  }

  if (country) {
    andConditions.push({ country });
  }

  if (consultFee) {
    andConditions.push({
      doctor: {
        consultFee: { lte: Number(consultFee) },
      },
    });
  }

  if (speciality) {
    andConditions.push({
      doctor: {
        speciality: {
          contains: speciality,
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
        include: {
          clinic: { include: { user: true } },
          doctorClinics: {
            where: {
              isActive: true,
              clinic: {
                is: {
                  adminVerified: true,
                  isVisible: true,
                  user: { is: { status: UserStatus.ACTIVE, banned: false } },
                },
              },
            },
            include: { clinic: true },
          },
        },
      },
      ratingsReceived: {
        select: { rating: true },
      },
    },
  });

  // 3️⃣ Calculate rating & weighted score
  const doctorsWithRating = doctors.map((doc) => {
    const ratings = doc.ratingsReceived.map((r) => r.rating);
    const reviewCount = ratings.length;
    const averageRating = reviewCount
      ? ratings.reduce((a, b) => a + b, 0) / reviewCount
      : 0;

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
      clinic:
        doc.doctor?.clinic?.adminVerified &&
        doc.doctor.clinic.isVisible &&
        doc.doctor.clinic.user?.status === UserStatus.ACTIVE &&
        !doc.doctor.clinic.user?.banned
          ? doc.doctor.clinic.clinicName
          : doc.doctor?.doctorClinics[0]?.clinic.clinicName,
      badgeActive: doc.doctor?.badgeActive || false,
      rating: Number(averageRating.toFixed(1)),
      reviewCount,
      avgRating: averageRating * Math.log(1 + reviewCount),
    };
  });

  // 4️⃣ Filter by minimum rating
  const filteredDoctors = rating
    ? doctorsWithRating.filter((d) => d.rating >= Number(rating))
    : doctorsWithRating;

  // 5️⃣ Sort by popularity (weighted score)
  const sortedDoctors = filteredDoctors.sort(
    (a, b) => b.avgRating - a.avgRating,
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

// const getNearestClinics = async (
//   userId: string,
//   filters: DoctorFilters,
//   options: IPaginationOptions
// ) => {
//   const { page, limit, skip } = paginationHelpers.calculatePagination(options);
//   const { search, city, country } = filters;

//   // 1️⃣ Get User Location
//   const user = await prisma.user.findUnique({
//     where: { id: userId },
//     select: {
//       patient: {
//         select: {
//           latitude: true,
//           longitude: true,
//         },
//       },
//     },
//   });

//   const userLat = user?.patient?.latitude || 0;
//   const userLng = user?.patient?.longitude || 0;

//   // 2️⃣ Build Prisma WHERE conditions for Clinics
//   const andConditions: Prisma.UserWhereInput[] = [
//     { role: UserRole.CLINIC },
//   ];

//   if (city) {
//     andConditions.push({ city: { contains: city, mode: "insensitive" } });
//   }

//   if (country) {
//     andConditions.push({ country: { contains: country, mode: "insensitive" } });
//   }

//   if (search) {
//     andConditions.push({
//       OR: [
//         {
//           clinic: {
//             clinicName: {
//               contains: search,
//               mode: "insensitive",
//             },
//           },
//         },
//         {
//           city: {
//             contains: search,
//             mode: "insensitive",
//           },
//         },
//       ],
//     });
//   }

//   const whereConditions: Prisma.UserWhereInput = {
//     AND: andConditions,
//   };

//   // 3️⃣ Fetch all matching clinics (filtering applied DB-side)
//   const clinics = await prisma.user.findMany({
//     where: whereConditions,
//     include: {
//       clinic: {
//         include: {
//           specialists: true,
//           insurances: true,
//           galleries: true,
//         },
//       },
//     },
//   });

//   // 4️⃣ Calculate distance and add doctor count
//   const clinicsWithDetails = await Promise.all(
//     clinics.map(async (clinic) => {
//       const distance = calculateDistance(
//         userLat,
//         userLng,
//         clinic.clinic?.latitude || 0,
//         clinic.clinic?.longitude || 0
//       );
//       const doctorCount = await prisma.doctor.count({
//         where: { clinicId: clinic.clinic?.id },
//       });
//       return {
//         ...clinic,
//         distance,
//         doctorCount,
//       };
//     })
//   );

//   // 5️⃣ Sort by distance
//   clinicsWithDetails.sort((a, b) => a.distance - b.distance);

//   // 6️⃣ Pagination
//   const paginatedClinics = clinicsWithDetails.slice(skip, skip + limit);

//   return {
//     meta: {
//       page,
//       limit,
//       total: clinicsWithDetails.length,
//     },
//     data: paginatedClinics,
//   };
// };

// Helper function to calculate distance

const getNearestClinics = async (
  userId: string,
  filters: DoctorFilters,
  options: IPaginationOptions,
) => {
  const { page, limit, skip } = paginationHelpers.calculatePagination(options);

  const { search, city, country, specialty, speciality, specialistId } = filters;

  // 1️⃣ Get user location
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      patient: {
        select: {
          latitude: true,
          longitude: true,
        },
      },
    },
  });

  const userLat = user?.patient?.latitude ?? 0;
  const userLng = user?.patient?.longitude ?? 0;

  // 2️⃣ Build WHERE conditions
  // A clinic must be admin-verified, not banned, and not deleted
  const andConditions: Prisma.UserWhereInput[] = [
    {
      clinic: {
        is: {
          adminVerified: true,
          isVisible: true,
        },
      },
    },
    { banned: false },
    { status: UserStatus.ACTIVE },
  ];

  if (city && city.trim().toLowerCase() !== "all") {
    const trimmedCity = city.trim();
    andConditions.push({
      OR: [
        { city: { contains: trimmedCity, mode: "insensitive" } },
        { address: { contains: trimmedCity, mode: "insensitive" } },
        { clinic: { location: { contains: trimmedCity, mode: "insensitive" } } },
      ],
    });
  }

  if (country && country.trim().toLowerCase() !== "all") {
    const trimmedCountry = country.trim();
    andConditions.push({
      OR: [
        { country: { contains: trimmedCountry, mode: "insensitive" } },
        { clinic: { location: { contains: trimmedCountry, mode: "insensitive" } } },
      ],
    });
  }

  if (search && search.trim()) {
    const trimmedSearch = search.trim();
    andConditions.push({
      OR: [
        {
          clinic: {
            clinicName: {
              contains: trimmedSearch,
              mode: "insensitive",
            },
          },
        },
        {
          clinic: {
            location: {
              contains: trimmedSearch,
              mode: "insensitive",
            },
          },
        },
        {
          fullName: {
            contains: trimmedSearch,
            mode: "insensitive",
          },
        },
      ],
    });
  }

  const specialtyQuery = specialty || speciality;
  if (specialistId) {
    andConditions.push({
      clinic: {
        specialists: {
          some: {
            specialistId: specialistId,
          },
        },
      },
    });
  } else if (specialtyQuery && specialtyQuery.trim().toLowerCase() !== "all") {
    const trimmedSpecialty = specialtyQuery.trim();
    andConditions.push({
      clinic: {
        specialists: {
          some: {
            specialist: {
              name: {
                contains: trimmedSpecialty,
                mode: "insensitive",
              },
            },
          },
        },
      },
    });
  }

  // 3️⃣ Fetch clinic data
  const clinics = await prisma.user.findMany({
    where: { AND: andConditions },
    select: {
      id: true,
      city: true,
      country: true,
      platformSubscriptionActive: true,
      clinic: {
        select: {
          id: true,
          clinicName: true,
          logo: true,
          location: true,
          latitude: true,
          longitude: true,
          adminVerified: true,
          badgeActive: true,
          specialists: {
            select: {
              specialist: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });

  // 4️⃣ Calculate distance & specialist count
  const clinicsWithDistance = clinics
    .filter((c) => c.clinic)
    .map((c) => {
      const clinic = c.clinic!;
      const specialties = clinic.specialists
        ?.map((s) => s.specialist?.name)
        .filter(Boolean) as string[];

      return {
        clinicUserId: c.id,
        clinicId: clinic.id,
        clinicName: clinic.clinicName,
        logo: clinic.logo,
        specialistCount: clinic.specialists.length,
        specialties: specialties || [],
        adminVerified: clinic.adminVerified,
        badgeActive: clinic.badgeActive || false,
        platformSubscriptionActive: c.platformSubscriptionActive,
        city: c.city || clinic.location || "",
        country: c.country || "",
        location: clinic.location || "",
        latitude: clinic.latitude || 0,
        longitude: clinic.longitude || 0,
        distance: calculateDistance(
          userLat,
          userLng,
          clinic.latitude || 0,
          clinic.longitude || 0,
        ),
      };
    });

  // 5️⃣ Sort by nearest
  clinicsWithDistance.sort((a, b) => a.distance - b.distance);

  // 6️⃣ Pagination
  const paginatedData = clinicsWithDistance.slice(skip, skip + limit);

  return {
    meta: {
      page,
      limit,
      total: clinicsWithDistance.length,
    },
    data: paginatedData,
  };
};

const calculateDistance = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) => {
  const R = 6371; // Radius of the Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const getClinicDetailsById = async (clinicUserId: string) => {
  const clinicUser = await prisma.user.findFirst({
    where: {
      OR: [
        { id: clinicUserId },
        { clinic: { id: clinicUserId } },
      ],
      status: UserStatus.ACTIVE,
      banned: false,
      clinic: {
        is: { adminVerified: true, isVisible: true },
      },
    },
    select: {
      id: true,
      phoneNumber: true,
      fullName: true,
      country: true,
      city: true,
      address: true,
      profileImage: true,
      platformSubscriptionActive: true,
      clinic: {
        select: {
          id: true,
          clinicName: true,
          about: true,
          logo: true,
          contactPhone: true,
          location: true,
          latitude: true,
          longitude: true,
          views: true,
          adminVerified: true,
          badgeActive: true,
          verificationStatus: true,
          specialists: {
            select: {
              id: true,
              specialist: { select: { name: true, image: true } },
            },
          },
          insurances: {
            select: {
              insurance: {
                select: {
                  id: true,
                  name: true,
                  image: true,
                }
              }
            }
          },
          galleries: true,
          createdAt: true,
        },
      },
    },
  });

  if (!clinicUser || !clinicUser.clinic) {
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");
  }

  const doctorCount = await prisma.doctorClinic.count({
    where: {
      clinicId: clinicUser.clinic.id,
      isActive: true,
      doctor: {
        adminVerified: true,
        user: { is: { status: UserStatus.ACTIVE, banned: false } },
      },
    },
  });

  await prisma.clinic.update({
    where: {
      id: clinicUser.clinic.id,
    },
    data: {
      views: {
        increment: 1,
      },
    },
  });

  return {
    clinicId: clinicUser.clinic.id,
    clinicName: clinicUser.clinic.clinicName,
    about: clinicUser.clinic.about,
    logo: clinicUser.clinic.logo,
    phoneNumber: clinicUser.phoneNumber,
    adminVerified: clinicUser.clinic.adminVerified,
    badgeActive: clinicUser.clinic.badgeActive || false,
    verificationStatus: clinicUser.clinic.verificationStatus || "NOT_SUBMITTED",
    platformSubscriptionActive: clinicUser.platformSubscriptionActive,
    address: clinicUser.address,
    location: clinicUser.clinic.location,
    country: clinicUser.country,
    latitude: clinicUser.clinic.latitude,
    longitude: clinicUser.clinic.longitude,
    specialistCount: clinicUser.clinic.specialists.length,
    doctorCount,
    insurances: clinicUser.clinic.insurances,
    galleries: clinicUser.clinic.galleries,
    createdAt: clinicUser.clinic.createdAt,
    specialists: clinicUser.clinic.specialists,
    views: clinicUser.clinic.views,
  };
};

// const getClinicDoctors = async (
//   clinicUserId: string,
//   filters: DoctorFilters,
//   options: IPaginationOptions
// ) => {
//   const { page, skip, limit } = paginationHelpers.calculatePagination(options);
//   const { search, rating, consultFee, speciality, city, country } = filters;

//   // 1️⃣ Get Clinic ID from User ID
//   const clinicUser = await prisma.user.findUnique({
//     where: { id: clinicUserId, role: UserRole.CLINIC },
//     include: { clinic: true },
//   });

//   if (!clinicUser || !clinicUser.clinic) {
//     throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");
//   }

//   const clinicId = clinicUser.clinic.id;

//   // 2️⃣ Build Prisma WHERE conditions
//   const andConditions: Prisma.UserWhereInput[] = [
//     { role: UserRole.DOCTOR },
//     { doctor: { clinicId } },
//   ];

//   if (consultFee) {
//     andConditions.push({ doctor: { consultFee: { lte: Number(consultFee) } } });
//   }

//   if (speciality) {
//     andConditions.push({
//       doctor: { speciality: { contains: speciality, mode: "insensitive" } },
//     });
//   }

//   if (search) {
//     andConditions.push({
//       OR: [
//         { fullName: { contains: search, mode: "insensitive" } },
//         { doctor: { speciality: { contains: search, mode: "insensitive" } } },
//       ],
//     });
//   }

//   console.log("city",city)
//   console.log("country",country)

//   if (city) {
//     andConditions.push({ city });
//   }

//   if (country) {
//     andConditions.push({ country });
//   }

//   const whereConditions: Prisma.UserWhereInput = { AND: andConditions };

//   // 3️⃣ Fetch doctors
//   const doctors = await prisma.user.findMany({
//     where: whereConditions,
//     include: {
//       doctor: {
//         include: {
//           clinic: {
//             // include: {
//             //   galleries: {
//             //     select: {
//             //       image: true,
//             //     },
//             //   },
//             // },
//           },
//           // workingDays: {
//           //   select: {
//           //     day: true,
//           //     slots: {
//           //       select: {
//           //         startTime: true,
//           //         endTime: true,
//           //         capacity: true,
//           //         isActive: true,
//           //       }
//           //     }
//           //   }
//           // }
//         },
//       },
//       ratingsReceived: { select: { rating: true } },
//     },
//   });

//   // 4️⃣ Calculate average rating
//   const doctorsWithRating = doctors.map((doc) => {
//     const ratings = doc.ratingsReceived.map((r) => r.rating);
//     const reviewCount = ratings.length;
//     const averageRating = reviewCount
//       ? ratings.reduce((a, b) => a + b, 0) / reviewCount
//       : 0;

//     return {
//       id: doc.id,
//       name: doc.fullName,
//       country: doc.country,
//       city: doc.city,
//       specialty: doc.doctor?.speciality,
//       experience: doc.doctor?.experience,
//       consultFee: doc.doctor?.consultFee,
//       profileImage: doc.profileImage,

//       clinicName: doc.doctor?.clinic?.clinicName,
//       clinicLogo: doc.doctor?.clinic?.logo,
//       // clinicPhoto: doc.doctor?.clinic?.galleries,
//       rating: Number(averageRating.toFixed(1)), // include in response
//       reviewCount,
//       // schedule: doc.doctor?.workingDays,
//       // about: doc.doctor?.about,
//       clinicId: doc.doctor?.clinic?.userId,
//       doctorId: doc.doctor?.id,
//     };
//   });

//   // 5️⃣ Filter by minimum rating
//   const filteredDoctors = rating
//     ? doctorsWithRating.filter((d) => d.rating >= Number(rating))
//     : doctorsWithRating;

//   // 6️⃣ Sort by average rating high → low
//   const sortedDoctors = filteredDoctors.sort((a, b) => b.rating - a.rating);

//   // 7️⃣ Pagination
//   const paginatedDoctors = sortedDoctors.slice(skip, skip + limit);

//   return {
//     meta: {
//       page,
//       limit,
//       total: filteredDoctors.length,
//     },
//     data: paginatedDoctors,
//   };
// };

const getClinicDoctors = async (
  clinicUserId: string,
  filters: DoctorFilters,
  options: IPaginationOptions,
) => {
  const { page, skip, limit } = paginationHelpers.calculatePagination(options);
  const { search, rating, consultFee, speciality, city, country } = filters;

  // 1️⃣ Get Clinic ID from User ID or Clinic ID
  const clinicUser = await prisma.user.findFirst({
    where: {
      OR: [
        { id: clinicUserId },
        { clinic: { id: clinicUserId } },
      ],
      status: UserStatus.ACTIVE,
      banned: false,
      clinic: { is: { adminVerified: true, isVisible: true } },
    },
    include: { clinic: true },
  });

  if (!clinicUser || !clinicUser.clinic) {
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");
  }

  const selectedClinic = clinicUser.clinic;
  const clinicId = selectedClinic.id;

  // 2️⃣ Build Prisma WHERE conditions
  const andConditions: Prisma.UserWhereInput[] = [
    { role: UserRole.DOCTOR },
      { status: UserStatus.ACTIVE },
    { banned: false },
    { doctor: { is: { adminVerified: true } } },
    // A legacy primary-clinic pointer is not proof of clinic approval.
    // Public affiliation must come from the approved active relationship.
    { doctor: { doctorClinics: { some: { clinicId, isActive: true } } } },
  ];

  if (consultFee) {
    andConditions.push({ doctor: { consultFee: { lte: Number(consultFee) } } });
  }

  if (speciality) {
    andConditions.push({
      doctor: { speciality: { contains: speciality, mode: "insensitive" } },
    });
  }

  if (search) {
    andConditions.push({
      OR: [
        { fullName: { contains: search, mode: "insensitive" } },
        { doctor: { speciality: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  if (city) {
    andConditions.push({ city });
  }

  if (country) {
    andConditions.push({ country });
  }

  const whereConditions: Prisma.UserWhereInput = { AND: andConditions };

  // 3️⃣ Fetch doctors
  const doctors = await prisma.user.findMany({
    where: whereConditions,
    include: {
      doctor: {
        include: {
          clinic: {},
        },
      },
      ratingsReceived: { select: { rating: true } },
    },
  });

  // 4️⃣ Calculate average rating
  const doctorsWithRating = doctors.map((doc) => {
    const ratings = doc.ratingsReceived.map((r) => r.rating);
    const reviewCount = ratings.length;
    const averageRating = reviewCount
      ? ratings.reduce((a, b) => a + b, 0) / reviewCount
      : 0;

    const roundedRating = Math.floor(averageRating);

    return {
      id: doc.id,
      name: doc.fullName,
      country: doc.country,
      city: doc.city,
      specialty: doc.doctor?.speciality,
      experience: doc.doctor?.experience,
      consultFee: doc.doctor?.consultFee,
      profileImage: doc.profileImage,

      clinicName: selectedClinic.clinicName,
      clinicLogo: selectedClinic.logo,
      clinicLat: selectedClinic.latitude,
      clinicLng: selectedClinic.longitude,
      rating: roundedRating,
      reviewCount,
      views: doc.doctor?.clinic?.views,
      // Return the clinic currently being browsed, not the doctor's legacy
      // primary-clinic pointer, so the next details/booking request stays scoped.
      clinicId,
      doctorId: doc.doctor?.id,
      badgeActive: doc.doctor?.badgeActive || false,
    };
  });

  // 5️⃣ Ceiling-style filter (exclude 0 in filtering)
  const ceilingDoctors = rating
    ? doctorsWithRating.filter(
      (d) => d.rating <= Number(rating) && d.rating > 0,
    )
    : doctorsWithRating.filter((d) => d.rating > 0);

  // 6️⃣ Add unrated doctors at the end
  const unratedDoctors = doctorsWithRating.filter((d) => d.rating === 0);
  const finalDoctors = [...ceilingDoctors, ...unratedDoctors];

  // 7️⃣ Sort by rating high → low (unrated naturally at the end)
  const sortedDoctors = finalDoctors.sort((a, b) => b.rating - a.rating);

  // 8️⃣ Pagination
  const paginatedDoctors = sortedDoctors.slice(skip, skip + limit);

  return {
    meta: {
      page,
      limit,
      total: finalDoctors.length,
    },
    data: paginatedDoctors,
  };
};

const getDoctor = async (doctorId: string, requestedClinicId?: string) => {
  // 1️⃣ Fetch doctor user
  const doctorUser = await prisma.user.findFirst({
    where: {
      role: UserRole.DOCTOR,
      status: UserStatus.ACTIVE,
      banned: false,
      doctor: {
        id: doctorId,
        adminVerified: true,
      },
    },
    include: {
      doctor: {
        include: {
          clinic: {
            include: {
              galleries: {
                select: { image: true },
              },
              user: true,
            },
          },
          doctorClinics: {
            where: {
              isActive: true,
              clinic: {
                is: {
                  adminVerified: true,
                  isVisible: true,
                  user: { is: { status: UserStatus.ACTIVE, banned: false } },
                },
              },
            },
            include: {
              clinic: {
                include: {
                  galleries: {
                    select: { image: true },
                  },
                  user: true,
                },
              },
            },
          },
          workingDays: {
            where: { isActive: true },
            select: {
              id: true,
              day: true,
              clinicId: true,
              slots: {
                where: { isActive: true },
                select: {
                  id: true,
                  startTime: true,
                  endTime: true,
                  capacity: true,
                  isActive: true,
                },
              },
            },
          },
        },
      },
      ratingsReceived: {
        select: { rating: true },
      },
    },
  });

  if (!doctorUser || !doctorUser.doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  // 2️⃣ Calculate rating
  const ratings = doctorUser.ratingsReceived.map((r) => r.rating);
  const reviewCount = ratings.length;
  const averageRating = reviewCount
    ? ratings.reduce((a, b) => a + b, 0) / reviewCount
    : 0;

  const primaryClinic = doctorUser.doctor.clinic;
  const availableClinicLinks = doctorUser.doctor.doctorClinics;
  if (availableClinicLinks.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "Doctor has no active, public clinic affiliation for Phase 1 bookings",
    );
  }
  const selectedClinicLink = requestedClinicId
    ? availableClinicLinks.find(
        (link) =>
          link.clinicId === requestedClinicId ||
          link.clinic.userId === requestedClinicId,
      )
    : availableClinicLinks.find((link) => link.clinicId === primaryClinic?.id) ??
      availableClinicLinks[0];

  if (requestedClinicId && !selectedClinicLink) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "Doctor is not actively affiliated with this clinic",
    );
  }

  // A booking must use an explicitly approved active DoctorClinic link.
  // The legacy Doctor.clinicId pointer is not a source of booking affiliation.
  const publicClinic = selectedClinicLink?.clinic;
  const country = publicClinic?.user.country?.trim().toUpperCase();
  const fixedFee = country && Object.values(Country).includes(country as Country)
    ? await prisma.patientServiceFee.findUnique({ where: { country: country as Country } }) : null;


  const scheduleForClinic = (clinicId: string) => doctorUser.doctor!.workingDays.filter(day =>
    day.clinicId === clinicId || (!day.clinicId && !doctorUser.doctor!.workingDays.some(specific => specific.clinicId === clinicId && specific.day === day.day)));
  // Shape only approved, visible affiliations and their effective schedules.
  return {
    id: doctorUser.id,
    name: doctorUser.fullName,
    badgeActive: doctorUser.doctor.badgeActive || false,
    verificationStatus: doctorUser.doctor.verificationStatus || "NOT_SUBMITTED",
    country: doctorUser.country,
    city: doctorUser.city,
    specialty: doctorUser.doctor.speciality,
    experience: doctorUser.doctor.experience,
    consultFee: doctorUser.doctor.consultFee,
    biography: doctorUser.doctor.biography,
    qualifications: doctorUser.doctor.qualifications,
    profileImage: doctorUser.profileImage,

    clinicName: publicClinic?.clinicName,
    clinicLogo: publicClinic?.logo,
    clinicCountry: publicClinic?.user.country,
    clinicServiceFeePercentage: publicClinic?.serviceFeePercentage ?? 0,
    clinicCollectionMode: publicClinic?.collectionMode ?? "MODE_A",
    fixedPatientServiceFee: fixedFee ? money(fixedFee.amount) : null,
    patientServiceFeeAmount: publicClinic?.collectionMode === "MODE_B"
      ? percentageAmount(doctorUser.doctor.consultFee || 0, publicClinic.serviceFeePercentage)
      : fixedFee ? money(fixedFee.amount) : null,
    clinicPhoto: publicClinic?.galleries ?? [],
    views: publicClinic?.views,

    doctorClinics: doctorUser.doctor.doctorClinics.map((dc) => ({
      id: dc.clinic.id,
      userId: dc.clinic.userId,
      clinicName: dc.clinic.clinicName,
      logo: dc.clinic.logo,
      location: dc.clinic.location,
      contactPhone: dc.clinic.contactPhone,
      galleries: dc.clinic.galleries,
      country: dc.clinic.user.country,
      schedule: scheduleForClinic(dc.clinicId),
    })),

    rating: Number(averageRating.toFixed(1)),
    reviewCount,

    schedule: publicClinic ? scheduleForClinic(publicClinic.id) : [],
    about: doctorUser.doctor.about,

    clinicId:
      publicClinic?.id,
    doctorId: doctorUser.doctor.id,
  };
};

const bookingAppointment = async (
  userId: string,
  clinicId: string,
  doctorId: string,
  workingSlotId: string,
  consultDate: string,
) => {
  return BookingService.createBooking(userId, {
    clinicId,
    doctorId,
    workingSlotId,
    consultDate,
    bookedFor: "SELF",
  });
};

const getPatientBookingSettings = async () => {
  const settings = await prisma.platformBookingSetting.findFirst({
    select: {
      advanceBookingDays: true,
      cancellationCutoffHours: true,
    },
  });

  return {
    advanceBookingDays: settings?.advanceBookingDays ?? 14,
    cancellationCutoffHours: settings?.cancellationCutoffHours ?? 12,
  };
};

const cancelAppointment = async (userId: string, bookingId: string) => {
  return await BookingService.cancelBooking(bookingId, userId, "PATIENT");
};

const getAppointmentHistory = async (
  userId: string,
  options: IPaginationOptions,
) => {
  const { page, limit, skip, sortBy, sortOrder } =
    paginationHelpers.calculatePagination(options);

  // Fetch appointments
  const result = await prisma.bookingAppointment.findMany({
    where: {
      patient: {
        userId: userId,
      },
    },
    select: {
      id: true,
      serialNumber: true,
      consultDate: true,
      status: true,
      startTime: true,
      endTime: true,
      approximateEstimatedTime: true,
      bookedFor: true,
      familyMemberName: true,
      familyMemberRelation: true,
      cancellationReason: true,
      rejectionReason: true,
      noShowReason: true,
      doctor: {
        select: {
          speciality: true,
          user: {
            select: {
              fullName: true,
              profileImage: true,
              address: true,
            },
          },
        },
      },
      doctorRatings: {
        select: {
          rating: true,
        },
      },
      clinic: {
        select: {
          clinicName: true,
          location: true,
          contactPhone: true,
          logo: true,
          views: true,
        },
      },
    },
    skip,
    take: limit,
    orderBy: {
      [sortBy]: sortOrder,
    },
  });

  const mappedResult = result.map((appt) => {
    return {
      ...appt,
    };
  });

  const total = await prisma.bookingAppointment.count({
    where: {
      patient: {
        userId: userId,
      },
    },
  });

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: mappedResult,
  };
};

const createPatientInsurance = async (
  userId: string,
  payload: {
    insuranceDetails: string;
    image: string;
  },
) => {
  const patient = await prisma.user.findUnique({ where: { id: userId } });
  if (!patient) throw new ApiError(httpStatus.NOT_FOUND, "Patient not found");

  return await prisma.patientInsurance.create({
    data: {
      patientId: patient.id,
      insuranceDetails: payload.insuranceDetails,
      image: payload.image,
    },
  });
};

const updatePatientInsurance = async (
  userId: string,
  insuranceId: string,
  payload: {
    insuranceDetails?: string;
    image?: string;
  },
) => {
  const isExist = await prisma.patientInsurance.findFirst({
    where: {
      id: insuranceId,
      patientId: userId,
    },
  });

  if (!isExist) {
    throw new ApiError(httpStatus.NOT_FOUND, "Insurance not found");
  }

  return await prisma.patientInsurance.update({
    where: {
      id: insuranceId,
    },
    data: payload,
  });
};

const deletePatientInsurance = async (userId: string, insuranceId: string) => {
  const isExist = await prisma.patientInsurance.findFirst({
    where: {
      id: insuranceId,
      patientId: userId,
    },
  });

  if (!isExist) {
    throw new ApiError(httpStatus.NOT_FOUND, "Insurance not found");
  }

  return await prisma.patientInsurance.delete({
    where: {
      id: insuranceId,
    },
  });
};

const getPatientInsurance = async (userId: string) => {
  return await prisma.patientInsurance.findMany({
    where: {
      patientId: userId,
    },
  });
};

export const PatientService = {
  updatePatientProfile,
  getPatientProfile,
  getPopularDoctors,
  getNearestClinics,
  getClinicDetailsById,
  getClinicDoctors,
  getDoctor,
  bookingAppointment,
  getPatientBookingSettings,
  cancelAppointment,
  getAppointmentHistory,
  createPatientInsurance,
  updatePatientInsurance,
  deletePatientInsurance,
  getPatientInsurance,
};
