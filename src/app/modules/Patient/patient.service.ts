import { Prisma, UserRole, BookingStatus, TopUpType, Country } from "@prisma/client";
import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import { paginationHelpers } from "../../../utils/paginationHelper";
import prisma from "../../../shared/prisma";
import { IPaginationOptions } from "../../../interfaces/paginations";
import { Notification } from "../Notification/notification.service";
import { generateTokens } from "../Auth/auth.service";
import { BookingSchedulerService } from "../../jobs/services/bookingScheduler.service";

const now = Date.now();

interface DoctorFilters {
  search?: string; // name or speciality
  rating?: number; // minimum avg rating
  consultFee?: number; // max fee
  city?: string;
  country?: string;
  speciality?: string;
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
      role: UserRole.PATIENT,
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
  const andConditions: Prisma.UserWhereInput[] = [{ role: UserRole.DOCTOR }];

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
          clinic: true,
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
      clinic: doc.doctor?.clinic?.clinicName,
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

  const { search, city, country } = filters;

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
  const andConditions: Prisma.UserWhereInput[] = [
    { role: UserRole.CLINIC },
    {
      clinic: {
        is: {
          adminVerified: true,
        },
      },
    },
  ];

  if (city) {
    andConditions.push({
      city: { contains: city, mode: "insensitive" },
    });
  }

  if (country) {
    andConditions.push({
      country: { contains: country, mode: "insensitive" },
    });
  }

  if (search) {
    andConditions.push({
      clinic: {
        clinicName: {
          contains: search,
          mode: "insensitive",
        },
      },
    });
  }

  // 3️⃣ Fetch only required clinic data
  const clinics = await prisma.user.findMany({
    where: { AND: andConditions },
    select: {
      id: true,
      platformSubscriptionActive: true,
      clinic: {
        select: {
          id: true,
          clinicName: true,
          logo: true,
          latitude: true,
          longitude: true,
          adminVerified: true,
          specialists: {
            select: { id: true },
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
      return {
        clinicUserId: c.id,
        clinicId: clinic.id,
        clinicName: clinic.clinicName,
        logo: clinic.logo,
        specialistCount: clinic.specialists.length,
        adminVerified: clinic.adminVerified,
        platformSubscriptionActive: c.platformSubscriptionActive,
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
  const clinicUser = await prisma.user.findUnique({
    where: {
      id: clinicUserId,
      role: UserRole.CLINIC,
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

  const doctorCount = await prisma.doctor.count({
    where: {
      clinicId: clinicUser.clinic.id,
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

  // 1️⃣ Get Clinic ID from User ID
  const clinicUser = await prisma.user.findUnique({
    where: { id: clinicUserId, role: UserRole.CLINIC },
    include: { clinic: true },
  });

  if (!clinicUser || !clinicUser.clinic) {
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");
  }

  const clinicId = clinicUser.clinic.id;

  // 2️⃣ Build Prisma WHERE conditions
  const andConditions: Prisma.UserWhereInput[] = [
    { role: UserRole.DOCTOR },
    { doctor: { clinicId } },
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

      clinicName: doc.doctor?.clinic?.clinicName,
      clinicLogo: doc.doctor?.clinic?.logo,
      clinicLat: doc.doctor?.clinic?.latitude,
      clinicLng: doc.doctor?.clinic?.longitude,
      rating: roundedRating,
      reviewCount,
      views: doc.doctor?.clinic?.views,
      clinicId: doc.doctor?.clinic?.userId,
      doctorId: doc.doctor?.id,
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

const getDoctor = async (doctorId: string) => {
  // 1️⃣ Fetch doctor user
  const doctorUser = await prisma.user.findFirst({
    where: {
      role: UserRole.DOCTOR,
      doctor: {
        id: doctorId,
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
          workingDays: {
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

  // 3️⃣ Shape response
  return {
    id: doctorUser.id,
    name: doctorUser.fullName,
    country: doctorUser.country,
    city: doctorUser.city,
    specialty: doctorUser.doctor.speciality,
    experience: doctorUser.doctor.experience,
    consultFee: doctorUser.doctor.consultFee,
    biography: doctorUser.doctor.biography,
    profileImage: doctorUser.profileImage,

    clinicName: doctorUser.doctor.clinic?.clinicName,
    clinicLogo: doctorUser.doctor.clinic?.logo,
    clinicCountry: doctorUser.doctor.clinic?.user.country,
    clinicPhoto: doctorUser.doctor.clinic?.galleries ?? [],
    views: doctorUser.doctor.clinic?.views,

    rating: Number(averageRating.toFixed(1)),
    reviewCount,

    schedule: doctorUser.doctor.workingDays,
    about: doctorUser.doctor.about,

    clinicId: doctorUser.doctor.clinic?.userId,
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
  const adminUser = await prisma.user.findUnique({
    where: { phoneNumber: `${process.env.ADMIN_PHONE_NUMBER}` },
  });

  if (!adminUser) {
    throw new ApiError(httpStatus.NOT_FOUND, "Admin not found");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      patient: true,
    },
  });

  if (!user || !user.patient) {
    throw new ApiError(httpStatus.NOT_FOUND, "Patient not found");
  }



  const patientId = user.patient.id;

  const doctor = await prisma.doctor.findUnique({
    where: {
      id: doctorId,
    },
    include: {
      user: true,
    },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  if (!doctor.consultFee) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor consult fee not found");
  }

  // if (!user.platformSubscriptionActive) {
  //   // throw new ApiError(httpStatus.BAD_REQUEST, "Insufficient balance");
  //   return "Platform subscription is not active";
  // }


  const clinic = await prisma.user.findUnique({
    where: {
      id: clinicId,
    },
    include: {
      clinic: true,
    },
  });

  if (!clinic || !clinic.clinic) {
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");
  }

  if (!clinic.country) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Clinic country is not set yet");
  }

  const patientServiceFee = await prisma.patientServiceFee.findUnique({
    where: {
      country: clinic.country.toUpperCase() as Country,
    },
  });

  if (!patientServiceFee) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      `Patient service fee not set for country: ${user.country}`
    );
  }

  if (user.wallet < patientServiceFee.amount) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Insufficient balance");
  }

  // clinic insufficient balance check
  // if (clinic.wallet < clinic.serviceFree) {
  //   throw new ApiError(httpStatus.BAD_REQUEST, "Insufficient clinic balance");
  // }

  const clinicEntity = clinic.clinic;

  console.log("--->", doctor.clinicId, clinicEntity.id);
  // console.log("--->",clinic);

  // 1️⃣ Validate Working Slot & Get details
  const workingSlot = await prisma.workingSlot.findUnique({
    where: { id: workingSlotId },
    include: {
      workingDay: {
        include: {
          doctor: {
            include: {
              clinic: true,
            },
          },
        },
      },
    },
  });

  if (!workingSlot) {
    throw new ApiError(httpStatus.NOT_FOUND, "Working slot not found");
  }

  if (!workingSlot.isActive) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Working slot is not enabled");
  }

  // 2️⃣ Validate Date Matches Day
  const inputDate = new Date(consultDate);
  // const days = [
  //   "SUNDAY",
  //   "MONDAY",
  //   "TUESDAY",
  //   "WEDNESDAY",
  //   "THURSDAY",
  //   "FRIDAY",
  //   "SATURDAY",
  // ];
  // const dayName = days[inputDate.getUTCDay()];

  // if (dayName !== workingSlot.workingDay.day) {
  //   throw new ApiError(
  //     httpStatus.BAD_REQUEST,
  //     `Consult date ${consultDate} does not match the working day ${workingSlot.workingDay.day}`
  //   );
  // }

  // Normalize consultDate to include the slot's start time for consistency
  // workingSlot.startTime = "08:00.000Z"
  // 🌍 UTC HANDLING: Always use setUTCHours() to ensure times are interpreted in UTC,
  // preventing timezone-related issues on VPS servers with different local timezones
  const timePart = workingSlot.startTime.split(".")[0]; // "08:00"
  const [hours, minutes] = timePart.split(":").map(Number);

  if (isNaN(hours) || isNaN(minutes)) {
    throw new Error("Invalid workingSlot.startTime format");
  }

  // Apply to inputDate using UTC
  inputDate.setUTCHours(hours, minutes, 0, 0);

  if (inputDate.getTime() < Date.now()) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Cannot book an appointment for a past time slot");
  }

  // 3️⃣ Check Capacity
  const existingAppointmentsCount = await prisma.bookingAppointment.count({
    where: {
      // workingSlotId,
      doctorId,
      clinicId: clinic.clinic.id,
      consultDate: {
        equals: inputDate,
      },
      status: {
        not: BookingStatus.CANCELLED,
      },
    },
  });

  if (existingAppointmentsCount >= workingSlot.capacity) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Slot is fully booked");
  }

  // const slotDoctorId = workingSlot.workingDay.doctorId;
  // const slotClinicId = workingSlot.workingDay.doctor.clinicId;

  // if (doctorId !== slotDoctorId) {
  //     throw new ApiError(httpStatus.BAD_REQUEST, "Doctor ID does not match the working slot");
  // }

  // 4️⃣ Create Booking
  // Serial numbers are shared by every doctor and slot in the clinic for one
  // calendar day. consultDate includes the slot start time, so use a UTC day
  // range instead of exact timestamp equality.
  const serialDayStart = new Date(inputDate);
  serialDayStart.setUTCHours(0, 0, 0, 0);

  const serialDayEnd = new Date(serialDayStart);
  serialDayEnd.setUTCDate(serialDayEnd.getUTCDate() + 1);

  const result = await prisma.$transaction(async (tx) => {
    // Find the clinic's latest serial for the requested calendar day.
    const lastBooking = await tx.bookingAppointment.findFirst({
      where: {
        clinicId: clinicEntity.id,
        consultDate: {
          gte: serialDayStart,
          lt: serialDayEnd,
        },
      },
      orderBy: {
        serialNumber: "desc",
      },
    });

    const nextSerialNumber = lastBooking ? lastBooking.serialNumber + 1 : 1;

    const booking = await tx.bookingAppointment.create({
      data: {
        patientId: patientId,
        doctorId: doctorId,
        clinicId: clinicEntity.id,
        // workingSlotId: workingSlotId,
        consultDate: inputDate,
        status: BookingStatus.PENDING,
        startTime: workingSlot.startTime,
        endTime: workingSlot.endTime,
        serialNumber: nextSerialNumber,
        clinicServiceFee: 0,
        patientServiceFee: patientServiceFee.amount,
      },
    });

    // Decrement patient service wallet
    await tx.user.update({
      where: { id: user.id },
      data: {
        wallet: {
          decrement: patientServiceFee.amount,
        },
      },
    });

    // Admin wallet
    await tx.user.update({
      where: { id: adminUser.id },
      data: {
        wallet: {
          increment: patientServiceFee.amount,
        },
      },
    });

    // Crete top up history
    await tx.topUp.create({
      data: {
        userId: user.id,
        amount: patientServiceFee.amount,
        appointmentId: booking.id,
        type: TopUpType.BOOKING,
      },
    });

    return booking;
  });

  // Schedule PENDING_TIMEOUT job 30 minutes after slot endTime if clinic ignores the booking
  try {
    await BookingSchedulerService.schedulePendingBookingTimeout({
      appointmentId: result.id,
      patientId: result.patientId,
      patientUserId: user.id,
      clinicUserId: clinic.id,          // User.id of the clinic user
      adminUserId: adminUser.id,
      patientServiceFee: patientServiceFee.amount,
      consultDate: result.consultDate,
      endTime: result.endTime!,
    });
    console.log(`⏳ Scheduled PENDING_TIMEOUT for appointment ${result.id}`);
  } catch (err) {
    console.error(`⚠️ Failed to schedule pending timeout for ${result.id}:`, err);
    // Non-fatal — booking was already created
  }

  // Send notification to clinic (outside transaction to avoid foreign key constraint error)
  await Notification.ClinicNotification(
    result.id,
    clinicEntity.id,
    "New Appointment",
    clinic?.fcmToken || "",
  );

  return result;
};

const cancelAppointment = async (userId: string, bookingId: string) => {
  const adminUser = await prisma.user.findUnique({
    where: { phoneNumber: `${process.env.ADMIN_PHONE_NUMBER}` },
  });

  if (!adminUser) {
    throw new ApiError(httpStatus.NOT_FOUND, "Admin not found");
  }

  const appointment = await prisma.bookingAppointment.findFirst({
    where: {
      id: bookingId,
      patient: {
        userId: userId,
      },
    },
  });

  if (!appointment) {
    throw new ApiError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: appointment.clinicId },
  });

  const doctor = await prisma.doctor.findUnique({
    where: { id: appointment.doctorId },
  });

  if (!clinic) {
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");
  }

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  if (appointment.status === BookingStatus.CANCELLED) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Appointment is already cancelled",
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const cancelledAppointment = await tx.bookingAppointment.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED },
    });

    const consultTime = new Date(appointment.consultDate).getTime();
    const nowTime = Date.now();

    if (consultTime > nowTime + 12 * 60 * 60 * 1000) {
      // ── Cancelled ≥12h before appointment ─────────────────────────────────
      // Full refund: patient gets patientServiceFee back, clinic gets clinicServiceFee back.

      // Patient wallet refund
      await tx.user.update({
        where: { id: userId },
        data: { wallet: { increment: appointment.patientServiceFee } },
      });

      // Clinic wallet refund
      await tx.user.update({
        where: { id: clinic.userId },
        data: { wallet: { increment: appointment.clinicServiceFee } },
      });

      // Admin wallet decrement (pays back both)
      await tx.user.update({
        where: { id: adminUser.id },
        data: {
          wallet: {
            decrement: appointment.patientServiceFee + appointment.clinicServiceFee,
          },
        },
      });

      // TopUp records
      await tx.topUp.create({
        data: {
          userId: userId,
          amount: appointment.patientServiceFee,
          appointmentId: cancelledAppointment.id,
          type: TopUpType.CANCEL,
        },
      });
      await tx.topUp.create({
        data: {
          userId: clinic.userId,
          amount: appointment.clinicServiceFee,
          appointmentId: cancelledAppointment.id,
          type: TopUpType.CANCEL,
        },
      });
      await tx.topUp.create({
        data: {
          userId: adminUser.id,
          amount: appointment.patientServiceFee + appointment.clinicServiceFee,
          appointmentId: cancelledAppointment.id,
          type: TopUpType.CANCEL,
        },
      });
    } else {
      // ── Cancelled <12h before appointment ─────────────────────────────────
      // No refund to patient. Only refund clinic's service fee (if confirmed).

      if (appointment.clinicServiceFee > 0) {
        // Clinic wallet refund
        await tx.user.update({
          where: { id: clinic.userId },
          data: { wallet: { increment: appointment.clinicServiceFee } },
        });

        // Admin wallet decrement (only clinic fee)
        await tx.user.update({
          where: { id: adminUser.id },
          data: { wallet: { decrement: appointment.clinicServiceFee } },
        });

        // TopUp records for clinic refund
        await tx.topUp.create({
          data: {
            userId: clinic.userId,
            amount: appointment.clinicServiceFee,
            appointmentId: cancelledAppointment.id,
            type: TopUpType.CANCEL,
          },
        });
        await tx.topUp.create({
          data: {
            userId: adminUser.id,
            amount: appointment.clinicServiceFee,
            appointmentId: cancelledAppointment.id,
            type: TopUpType.CANCEL,
          },
        });
      }
    }

    return cancelledAppointment;
  });

  // Cancel the pending-timeout BullMQ job (clinic no longer needs to respond)
  try {
    await BookingSchedulerService.cancelPendingBookingTimeout(bookingId);
  } catch (error) {
    console.error("Failed to cancel pending booking timeout:", error);
  }

  // Cancel scheduled reminder notifications
  try {
    await BookingSchedulerService.cancelBookingNotifications(bookingId);
  } catch (error) {
    console.error("Failed to cancel booking reminder notifications:", error);
  }

  return result;
};

const acceptAppointment = async (userId: string, bookingId: string) => {
  // This might be used if a patient needs to confirm a tentative slot or similar workflow
  const appointment = await prisma.bookingAppointment.findFirst({
    where: {
      id: bookingId,
      patient: {
        userId: userId,
      },
    },
  });

  if (!appointment) {
    throw new ApiError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  if (appointment.status === BookingStatus.CONFIRMED) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Appointment is already confirmed",
    );
  }

  const result = await prisma.bookingAppointment.update({
    where: {
      id: bookingId,
    },
    data: {
      status: BookingStatus.CONFIRMED,
    },
  });

  return result;
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
  cancelAppointment,
  acceptAppointment,
  getAppointmentHistory,
  createPatientInsurance,
  updatePatientInsurance,
  deletePatientInsurance,
  getPatientInsurance,
};
