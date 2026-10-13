import { BookingStatus, Prisma } from "@prisma/client";
import admin from "../../../helpars/firebase/firebase";
import { IPaginationOptions } from "../../../interfaces/paginations";
import prisma from "../../../shared/prisma";
import { paginationHelpers } from "../../../utils/paginationHelper";
import { NotificationTemplateService } from "../NotificationTemplate/notificationTemplate.service";

const DoctorNotification = async (
  appointmentId: string,
  doctorId: string,
  notificationType: string,
  fcmToken?: string,
  lang: "ar" | "en" = "ar",
  variables: Record<string, any> = {}
) => {
  console.log("Sending doctor notification...");

  // Render template if available
  const rendered = await NotificationTemplateService.renderNotification(
    notificationType,
    lang,
    variables
  );

  const title = rendered.title || notificationType;
  const body = rendered.body || "";

  await prisma.doctorNotification.create({
    data: {
      doctorId,
      notificationType,
      bookingAppointmentId: appointmentId,
    },
  });

  if (!fcmToken) {
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      include: { user: true },
    });
    fcmToken = doctor?.user?.fcmToken || undefined;
  }

  if (!fcmToken) {
    console.log("FCM token is null");
    return { success: false, message: "FCM token is null" };
  }

  const message = {
    notification: {
      title,
      body,
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
            title,
            body: body || title,
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
  lang: "ar" | "en" = "ar",
  variables: Record<string, any> = {}
) => {
  console.log('Sending patient notification...', patientId);

  let finalTitle = title;
  let finalDescription = description;

  if (!finalTitle || !finalDescription) {
    const rendered = await NotificationTemplateService.renderNotification(
      notificationType,
      lang,
      variables
    );
    if (!finalTitle && rendered.title) finalTitle = rendered.title;
    if (!finalDescription && rendered.body) finalDescription = rendered.body;
  }

  await prisma.patientNotification.create({
    data: {
      patientId,
      notificationType,
      bookingAppointmentId: appointmentId || undefined,
      title: finalTitle,
      description: finalDescription,
    },
  });

  if (!fcmToken) {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      include: { user: true },
    });
    fcmToken = patient?.user?.fcmToken || undefined;
  }

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

  if (!user?.doctor?.id) {
    return {
      meta: {
        page,
        limit,
        total: 0,
      },
      data: [],
    };
  }

  const andConditions: Prisma.DoctorNotificationWhereInput[] = [
    { doctorId: user.doctor.id },
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
    where: { id: userId },
    include: {
      clinic: true,
      manager: {
        include: { clinic: true },
      },
    },
  });

  let clinicId: string | undefined;
  if (user?.clinic) {
    clinicId = user.clinic.id;
  } else if (user?.manager && user.manager.length > 0 && user.manager[0]?.clinic) {
    clinicId = user.manager[0].clinic.id;
  }

  if (!clinicId) {
    return {
      meta: {
        page,
        limit,
        total: 0,
      },
      data: [],
    };
  }

  const andConditions: Prisma.BookingAppointmentWhereInput[] = [
    { clinicId }
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
      id: true,
      consultDate: true,
      startTime: true,
      endTime: true,
      serialNumber: true,
      status: true,
      createdAt: true,
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

  const formattedData = result.map((item) => {
    const patientName = item.patient?.user?.fullName || "Patient";
    const doctorName = item.doctor?.user?.fullName || "Doctor";
    const dateStr = item.consultDate instanceof Date
      ? item.consultDate.toISOString().slice(0, 10)
      : String(item.consultDate);

    return {
      id: item.id,
      title: `Booking #${item.serialNumber} (${item.status})`,
      body: `${patientName} - Dr. ${doctorName} on ${dateStr} (${item.startTime} - ${item.endTime})`,
      isRead: item.status !== BookingStatus.PENDING,
      createdAt: item.createdAt,
      status: item.status,
      serialNumber: item.serialNumber,
      consultDate: item.consultDate,
      startTime: item.startTime,
      endTime: item.endTime,
      patient: item.patient,
      doctor: item.doctor,
    };
  });

  return {
    meta: {
      page,
      limit,
      total
    },
    data: formattedData
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


  if (!userWithPatient?.patient?.id) {
    return {
      meta: {
        page,
        limit,
        total: 0,
      },
      data: [],
    };
  }

  const where: Prisma.PatientNotificationWhereInput = {
    patientId: userWithPatient.patient.id,
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