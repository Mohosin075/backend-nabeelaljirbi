import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";

const createRating = async (
  userId: string,
  payload: {
    appointmentId: string;
    rating: number;
  }
) => {
  const { appointmentId, rating } = payload;

  const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
          patient: true
      }
  })

  if (!user || !user.patient) {
      throw new ApiError(httpStatus.NOT_FOUND, "Patient not found");
  }

  // Check if patient has booking with doctor
  const booking = await prisma.bookingAppointment.findUnique({
    where: {
      id: appointmentId,
    },
    include: {
        doctor: true
    }
  });

  if (!booking) {
    throw new ApiError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  if (booking.patientId !== user.patient.id) {
       throw new ApiError(httpStatus.FORBIDDEN, "You are not authorized to rate this appointment");
  }

  if (booking.status !== "COMPLETE") {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Cannot rate without completed appointment"
    );
  }

  // Check unique constraint manually for friendly message
  const existingRating = await prisma.doctorRating.findFirst({
      where: {
          appointmentId: appointmentId,
          patientId: userId
      }
  })

  if(existingRating) {
      throw new ApiError(httpStatus.BAD_REQUEST, "You have already rated this appointment");
  }

  return await prisma.doctorRating.create({
    data: {
      patientId: userId, // User ID
      doctorId: booking.doctor.userId, // Doctor User ID
      appointmentId: appointmentId,
      rating: rating,
    },
  });
};

const getRatingsForDoctor = async (doctorId: string) => {
  const ratings = await prisma.doctorRating.findMany({
    where: { doctorId },
    include: { patient: true },
  });

  const avgRating = ratings.length
    ? ratings.reduce((a, b) => a + b.rating, 0) / ratings.length
    : 0;

  return {
    averageRating: avgRating,
    ratings,
  };
};

export const RatingService = {
  createRating,
  getRatingsForDoctor,
};
