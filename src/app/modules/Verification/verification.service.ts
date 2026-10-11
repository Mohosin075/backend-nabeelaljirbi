import prisma from "../../../shared/prisma";
import ApiError from "../../../errors/ApiErrors";
import httpStatus from "http-status";

interface VerificationDocumentItem {
  title: string;
  url: string;
  type?: string;
  uploadedAt?: string;
}

const submitDoctorVerification = async (
  userId: string,
  payload: { documents: VerificationDocumentItem[]; notes?: string }
) => {
  const doctor = await prisma.doctor.findUnique({
    where: { userId },
  });

  if (!doctor) {
    throw new ApiError(httpStatus.NOT_FOUND, "Doctor profile not found");
  }

  const updated = await prisma.doctor.update({
    where: { id: doctor.id },
    data: {
      verificationStatus: "PENDING",
      verificationDocuments: payload.documents as any,
      verificationNotes: payload.notes || null,
      verificationAdminNote: null,
      verificationSubmittedAt: new Date(),
      badgeActive: false, // Remains hidden until admin explicitly activates it
    },
  });

  return updated;
};

const submitClinicVerification = async (
  userId: string,
  payload: { documents: VerificationDocumentItem[]; notes?: string }
) => {
  // Find clinic directly or through manager
  let clinic = await prisma.clinic.findUnique({
    where: { userId },
  });

  if (!clinic) {
    const manager = await prisma.manager.findUnique({
      where: { userId },
      include: { clinic: true },
    });
    if (manager?.clinic) {
      clinic = manager.clinic;
    }
  }

  if (!clinic) {
    throw new ApiError(httpStatus.NOT_FOUND, "Clinic profile not found");
  }

  const updated = await prisma.clinic.update({
    where: { id: clinic.id },
    data: {
      verificationStatus: "PENDING",
      verificationDocuments: payload.documents as any,
      verificationNotes: payload.notes || null,
      verificationAdminNote: null,
      verificationSubmittedAt: new Date(),
      badgeActive: false, // Remains hidden until admin explicitly activates it
    },
  });

  return updated;
};

const getMyVerificationStatus = async (user: { id: string; role: string }) => {
  if (user.role === "DOCTOR") {
    const doctor = await prisma.doctor.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        verificationStatus: true,
        badgeActive: true,
        verificationDocuments: true,
        verificationNotes: true,
        verificationAdminNote: true,
        verificationSubmittedAt: true,
        verificationReviewedAt: true,
      },
    });

    if (!doctor) {
      throw new ApiError(httpStatus.NOT_FOUND, "Doctor profile not found");
    }

    return {
      entityType: "DOCTOR",
      ...doctor,
    };
  }

  if (user.role === "CLINIC" || user.role === "MANAGER") {
    let clinic = await prisma.clinic.findUnique({
      where: { userId: user.id },
      select: {
        id: true,
        clinicName: true,
        adminVerified: true,
        verificationStatus: true,
        badgeActive: true,
        verificationDocuments: true,
        verificationNotes: true,
        verificationAdminNote: true,
        verificationSubmittedAt: true,
        verificationReviewedAt: true,
      },
    });

    if (!clinic && user.role === "MANAGER") {
      const manager = await prisma.manager.findUnique({
        where: { userId: user.id },
        include: { clinic: true },
      });
      if (manager?.clinic) {
        clinic = {
          id: manager.clinic.id,
          clinicName: manager.clinic.clinicName,
          adminVerified: manager.clinic.adminVerified,
          verificationStatus: manager.clinic.verificationStatus,
          badgeActive: manager.clinic.badgeActive,
          verificationDocuments: manager.clinic.verificationDocuments,
          verificationNotes: manager.clinic.verificationNotes,
          verificationAdminNote: manager.clinic.verificationAdminNote,
          verificationSubmittedAt: manager.clinic.verificationSubmittedAt,
          verificationReviewedAt: manager.clinic.verificationReviewedAt,
        };
      }
    }

    if (!clinic) {
      throw new ApiError(httpStatus.NOT_FOUND, "Clinic profile not found");
    }

    return {
      entityType: "CLINIC",
      ...clinic,
    };
  }

  throw new ApiError(httpStatus.BAD_REQUEST, "Verification is only applicable for Doctors and Clinics");
};

const getAdminVerifications = async (query: {
  type?: "DOCTOR" | "CLINIC" | "ALL";
  status?: string;
  searchTerm?: string;
  badgeActive?: string;
  page?: number;
  limit?: number;
}) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 15;
  const type = query.type || "ALL";
  const status = query.status;
  const searchTerm = query.searchTerm?.trim() || "";
  const badgeActive = query.badgeActive !== undefined ? query.badgeActive === "true" : undefined;

  const results: any[] = [];

  // Fetch doctors if applicable
  if (type === "ALL" || type === "DOCTOR") {
    const doctorWhere: any = {};
    if (status && status !== "ALL") {
      doctorWhere.verificationStatus = status;
    }
    if (badgeActive !== undefined) {
      doctorWhere.badgeActive = badgeActive;
    }
    if (searchTerm) {
      doctorWhere.OR = [
        { user: { fullName: { contains: searchTerm, mode: "insensitive" } } },
        { user: { phoneNumber: { contains: searchTerm, mode: "insensitive" } } },
        { user: { email: { contains: searchTerm, mode: "insensitive" } } },
        { speciality: { contains: searchTerm, mode: "insensitive" } },
        { licenseNumber: { contains: searchTerm, mode: "insensitive" } },
      ];
    }

    const doctors = await prisma.doctor.findMany({
      where: doctorWhere,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
            profileImage: true,
          },
        },
      },
      orderBy: { verificationSubmittedAt: "desc" },
    });

    results.push(
      ...doctors.map((d: any) => ({
        id: d.id,
        entityType: "DOCTOR",
        name: d.user?.fullName || "Doctor",
        email: d.user?.email || null,
        phoneNumber: d.user?.phoneNumber || null,
        profileImage: d.user?.profileImage || null,
        speciality: d.speciality || null,
        licenseNumber: d.licenseNumber || null,
        status: d.verificationStatus,
        badgeActive: d.badgeActive,
        documents: d.verificationDocuments,
        notes: d.verificationNotes,
        adminNote: d.verificationAdminNote,
        submittedAt: d.verificationSubmittedAt,
        reviewedAt: d.verificationReviewedAt,
      }))
    );
  }

  // Fetch clinics if applicable
  if (type === "ALL" || type === "CLINIC") {
    const clinicWhere: any = {};
    if (status && status !== "ALL") {
      clinicWhere.verificationStatus = status;
    }
    if (badgeActive !== undefined) {
      clinicWhere.badgeActive = badgeActive;
    }
    if (searchTerm) {
      clinicWhere.OR = [
        { clinicName: { contains: searchTerm, mode: "insensitive" } },
        { contactPhone: { contains: searchTerm, mode: "insensitive" } },
        { managerName: { contains: searchTerm, mode: "insensitive" } },
        { user: { email: { contains: searchTerm, mode: "insensitive" } } },
      ];
    }

    const clinics = await prisma.clinic.findMany({
      where: clinicWhere,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phoneNumber: true,
          },
        },
      },
      orderBy: { verificationSubmittedAt: "desc" },
    });

    results.push(
      ...clinics.map((c: any) => ({
        id: c.id,
        entityType: "CLINIC",
        name: c.clinicName || "Clinic",
        email: c.user?.email || null,
        phoneNumber: c.contactPhone || c.user?.phoneNumber || null,
        profileImage: c.logo || null,
        managerName: c.managerName || null,
        location: c.location || null,
        status: c.verificationStatus,
        badgeActive: c.badgeActive,
        adminVerified: c.adminVerified,
        documents: c.verificationDocuments,
        notes: c.verificationNotes,
        adminNote: c.verificationAdminNote,
        submittedAt: c.verificationSubmittedAt,
        reviewedAt: c.verificationReviewedAt,
      }))
    );
  }

  // Sort combined results by submission date
  results.sort((a, b) => {
    const timeA = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
    const timeB = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
    return timeB - timeA;
  });

  const total = results.length;
  const paginated = results.slice((page - 1) * limit, page * limit);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage: Math.ceil(total / limit),
    },
    data: paginated,
  };
};

const reviewVerification = async (payload: {
  targetId: string;
  type: "DOCTOR" | "CLINIC";
  action: "APPROVED" | "REJECTED";
  adminNote?: string;
  badgeActive?: boolean;
}) => {
  const { targetId, type, action, adminNote, badgeActive } = payload;

  if (type === "DOCTOR") {
    const doctor = await prisma.doctor.findUnique({
      where: { id: targetId },
    });
    if (!doctor) throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");

    const updated = await prisma.doctor.update({
      where: { id: targetId },
      data: {
        verificationStatus: action,
        verificationAdminNote: adminNote || null,
        verificationReviewedAt: new Date(),
        badgeActive: action === "REJECTED" ? false : (badgeActive !== undefined ? badgeActive : doctor.badgeActive),
      },
    });

    return updated;
  } else {
    const clinic = await prisma.clinic.findUnique({
      where: { id: targetId },
    });
    if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

    const updated = await prisma.clinic.update({
      where: { id: targetId },
      data: {
        verificationStatus: action,
        verificationAdminNote: adminNote || null,
        verificationReviewedAt: new Date(),
        badgeActive: action === "REJECTED" ? false : (badgeActive !== undefined ? badgeActive : clinic.badgeActive),
      },
    });

    return updated;
  }
};

const toggleBadgeActivation = async (payload: {
  targetId: string;
  type: "DOCTOR" | "CLINIC";
  badgeActive: boolean;
}) => {
  const { targetId, type, badgeActive } = payload;

  if (type === "DOCTOR") {
    const doctor = await prisma.doctor.findUnique({
      where: { id: targetId },
    });
    if (!doctor) throw new ApiError(httpStatus.NOT_FOUND, "Doctor not found");

    const updated = await prisma.doctor.update({
      where: { id: targetId },
      data: { badgeActive },
    });
    return updated;
  } else {
    const clinic = await prisma.clinic.findUnique({
      where: { id: targetId },
    });
    if (!clinic) throw new ApiError(httpStatus.NOT_FOUND, "Clinic not found");

    const updated = await prisma.clinic.update({
      where: { id: targetId },
      data: { badgeActive },
    });
    return updated;
  }
};

export const VerificationService = {
  submitDoctorVerification,
  submitClinicVerification,
  getMyVerificationStatus,
  getAdminVerifications,
  reviewVerification,
  toggleBadgeActivation,
};
