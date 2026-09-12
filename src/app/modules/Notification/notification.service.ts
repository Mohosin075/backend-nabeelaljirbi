import { Prisma } from "@prisma/client";
import admin from "../../../helpars/firebase/firebase";
import { IPaginationOptions } from "../../../interfaces/paginations";
import prisma from "../../../shared/prisma";
import { paginationHelpers } from "../../../utils/paginationHelper";

const DoctorNotification = async (
  appointmentId: string,
  doctorId: string,
  notificationType: string,
  fcmToken?: string
) => {
  console.log("Sending doctor notification...");

  await prisma.doctorNotification.create({
    data: {
      doctorId,
      notificationType,
      bookingAppointmentId: appointmentId,
    }
  })

  if (!fcmToken) {
    console.log("FCM token is null");
    return { success: false, message: "FCM token is null" };
  }


  const message = {
    notification: {
      title: `${notificationType}`,
      body: "",
    },
    data: {
      appointmentId,
      notificationType,
    },
    android: {
      notification: {
        channelId: "default_channel",
        sound: "notification_sound",
        priority: "high" as const,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "notification_sound.aiff",
          alert: {
            title: `${notificationType}`,
            body: `${notificationType}`,
          },
          category: "CALL_CATEGORY",
        },
      },
    },
    token: fcmToken,
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("FCM notification sent:", response);
    return { success: true, message: "Notification sent", response };
  } catch (error) {
    console.error("FCM send error:", error);
    return { success: false, message: "Notification failed", error };
  }
};


const ClinicNotification = async (
  appointmentId: string | null | undefined,
  clinicId: string,
  notificationType: string,
  title?: string,
  description?: string,
  fcmToken?: string
) => {
  console.log("Sending clinic notification...");

  await prisma.clinicNotification.create({
    data: {
      clinicId,
      notificationType,
      bookingAppointmentId: appointmentId || undefined,
      title,
      description,
    },
  });

  if (!fcmToken) {
    console.log("FCM token is null");
    return { success: false, message: "FCM token is null" };
  }

  const message: any = {
    notification: {
      title: title || `${notificationType}`,
      body: description || "",
    },
    data: {
      notificationType,
    },
    android: {
      notification: {
        channelId: "default_channel",
        sound: "notification_sound",
        priority: "high" as const,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "notification_sound.aiff",
          alert: {
            title: title || `${notificationType}`,
            body: description || `${notificationType}`,
          },
          category: "CALL_CATEGORY",
        },
      },
    },
    token: fcmToken,
  };

  // Only add appointmentId if it exists
  if (appointmentId) {
    message.data.appointmentId = appointmentId;
  }

  try {
    const response = await admin.messaging().send(message);
    console.log("FCM notification sent:", response);
    return { success: true, message: "Notification sent", response };
  } catch (error) {
    console.error("FCM send error:", error);
    return { success: false, message: "Notification failed", error };
  }
};


const PatientNotification = async (
  appointmentId: string | null | undefined,
  patientId: string,
  notificationType: string,
  title?: string,
  description?: string,
  fcmToken?: string,
) => {
  console.log('Sending patient notification...', patientId);

  await prisma.patientNotification.create({
    data: {
      patientId,
      notificationType,
      bookingAppointmentId: appointmentId || undefined,
      title,
      description,
    },
  });

  if (!fcmToken) {
    console.log('FCM token is null');
    return { success: false, message: 'FCM token is null' };
  }

  const message: any = {
    notification: {
      title: title || `${notificationType}`,
      body: description || '',
    },
    data: {
      notificationType,
    },
    android: {
      notification: {
        channelId: 'default_channel',
        sound: 'notification_sound',
        priority: 'high' as const,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'notification_sound.aiff',
          alert: {
            title: title || `${notificationType}`,
            body: description || `${notificationType}`,
          },
          category: 'CALL_CATEGORY',
        },
      },
    },
    token: fcmToken,
  };

  // Only add appointmentId if it exists
  if (appointmentId) {
    message.data.appointmentId = appointmentId;
  }

  try {
    const response = await admin.messaging().send(message);
    console.log('FCM notification sent:', response);
    return { success: true, message: 'Notification sent', response };
  } catch (error) {
    console.error('FCM send error:', error);
    return { success: false, message: 'Notification failed', error };
  }
};


const patientNotification = async (
  fcmToken: string,
  title: string,
  description: string
) => {
  console.log("Sending patient notification via Firebase...");

  if (!fcmToken) {
    console.log("FCM token is null");
    return { success: false, message: "FCM token is null" };
  }

  const message: any = {
    notification: {
      title: title,
      body: description,
    },
    data: {
      notificationType: "ADMIN_NOTIFICATION",
    },
    android: {
      notification: {
        channelId: "default_channel",
        sound: "notification_sound",
        priority: "high" as const,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "notification_sound.aiff",
          alert: {
            title: title,
            body: description,
          },
          category: "CALL_CATEGORY",
        },
      },
    },
    token: fcmToken,
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("FCM notification sent:", response);
    return { success: true, message: "Notification sent", response };
  } catch (error) {
    console.error("FCM send error:", error);
    return { success: false, message: "Notification failed", error };
  }
};

const clinicNotification = async (
  fcmToken: string,
  title: string,
  description: string
) => {
  console.log("Sending clinic notification via Firebase...");

  if (!fcmToken) {
    console.log("FCM token is null");
    return { success: false, message: "FCM token is null" };
  }

  const message: any = {
    notification: {
      title: title,
      body: description,
    },
    data: {
      notificationType: "ADMIN_NOTIFICATION",
    },
    android: {
      notification: {
        channelId: "default_channel",
        sound: "notification_sound",
        priority: "high" as const,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "notification_sound.aiff",
          alert: {
            title: title,
            body: description,
          },
          category: "CALL_CATEGORY",
        },
      },
    },
    token: fcmToken,
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("FCM notification sent:", response);
    return { success: true, message: "Notification sent", response };
  } catch (error) {
    console.error("FCM send error:", error);
    return { success: false, message: "Notification failed", error };
  }
};



const getDoctorNotification = async (
  doctorId: string,
  filters: { search?: string },
  options: IPaginationOptions
) => {
  const { page, limit, skip, sortBy, sortOrder } = paginationHelpers.calculatePagination(options);
  const { search } = filters;

  const user = await prisma.user.findUnique({
    where: {
      id: doctorId,
    },
    include: {
      doctor: true,
    },
  });

  const andConditions: Prisma.DoctorNotificationWhereInput[] = [
    { doctorId: user?.doctor?.id }
  ];

  if (search) {
    andConditions.push({
      bookingAppointment: {
        patient: {
          user: {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { phoneNumber: { contains: search, mode: "insensitive" } },
            ]
          }
        }
      }
    });
  }

  const whereConditions: Prisma.DoctorNotificationWhereInput = { AND: andConditions };

  const result = await prisma.doctorNotification.findMany({
    where: whereConditions,
    include: {
      bookingAppointment: {
        select: {
          consultDate: true,
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
                }
              }
            }
          }
        }
      }
    },
    skip,
    take: limit,
    orderBy: {
      [sortBy || 'createdAt']: sortOrder || 'desc'
    }
  });

  const total = await prisma.doctorNotification.count({
    where: whereConditions
  });

  return {
    meta: {
      page,
      limit,
      total
    },
    data: result
  };
};

const getClinicNotification = async (
  userId: string,
  filters: { search?: string },
  options: IPaginationOptions
) => {
  const { page, limit, skip, sortBy, sortOrder } = paginationHelpers.calculatePagination(options);
  const { search } = filters;

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    include: {
      clinic: true,
    },
  });

  const andConditions: Prisma.BookingAppointmentWhereInput[] = [
    { clinicId: user?.clinic?.id }
  ];

  if (search) {
    andConditions.push({
      patient: {
        user: {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { phoneNumber: { contains: search, mode: "insensitive" } },
          ]
        }
      }
    });
  }

  const whereConditions: Prisma.BookingAppointmentWhereInput = { AND: andConditions };

  const result = await prisma.bookingAppointment.findMany({
    where: whereConditions,
    select: {
      consultDate: true,
      startTime: true,
      endTime: true,
      serialNumber: true,
      status: true,
      patient: {
        select: {
          user: {
            select: {
              fullName: true,
              phoneNumber: true,
              profileImage: true,
            }
          }
        }
      },
      doctor: {
        select: {
          user: {
            select: {
              fullName: true,
              phoneNumber: true,
              profileImage: true,
            }
          }
        }
      }

    },
    skip,
    take: limit,
    orderBy: {
      [sortBy || 'createdAt']: sortOrder || 'desc'
    }
  });

  const total = await prisma.bookingAppointment.count({
    where: whereConditions
  });

  return {
    meta: {
      page,
      limit,
      total
    },
    data: result
  };
};

const getPatientNotification = async (
  userId: string,
  filters: { search?: string },
  options: IPaginationOptions
) => {
  const { page, limit, skip, sortBy, sortOrder } = paginationHelpers.calculatePagination(options);

  const userWithPatient = await prisma.user.findUnique({
    where: { id: userId },
    include: { patient: true }
  });


  console.log("Patient ID", userWithPatient?.patient?.id)


  const where: Prisma.PatientNotificationWhereInput = {
    patientId: userWithPatient?.patient?.id
  };

  const result = await prisma.patientNotification.findMany({
    where,
    include: {
      bookingAppointment: {
        include: {
          doctor: {
            include: {
              user: {
                select: {
                  fullName: true,
                  profileImage: true
                }
              }
            }
          },
          clinic: true
        }
      }
    },
    skip,
    take: limit,
    orderBy: {
      [sortBy || 'createdAt']: sortOrder || 'desc'
    }
  });

  const total = await prisma.patientNotification.count({ where });

  return {
    meta: {
      page,
      limit,
      total
    },
    data: result
  };
};

export const Notification = {
  DoctorNotification,
  ClinicNotification,
  PatientNotification,
  patientNotification,
  clinicNotification,
  getDoctorNotification,
  getClinicNotification,
  getPatientNotification
}