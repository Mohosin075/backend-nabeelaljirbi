import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import { NotificationTemplate } from "@prisma/client";
import {
  ICreateNotificationTemplate,
  IUpdateNotificationTemplate,
} from "./notificationTemplate.interface";

export const DEFAULT_NOTIFICATION_TEMPLATES: Array<{
  eventKey: string;
  name: string;
  description: string;
  titleEn: string;
  bodyEn: string;
  titleAr: string;
  bodyAr: string;
  pushEnabled: boolean;
  inAppEnabled: boolean;
  whatsappEnabled: boolean;
  smsEnabled: boolean;
  variables: string[];
}> = [
  {
    eventKey: "BOOKING_REQUEST_SENT",
    name: "Booking Request Sent",
    description: "Shown when a patient submits a booking request (pending clinic review)",
    titleEn: "Booking Request Sent",
    bodyEn: "Your appointment request for Dr. {{doctorName}} at {{clinicName}} on {{date}} has been sent to the clinic.",
    titleAr: "تم إرسال طلب الحجز",
    bodyAr: "تم إرسال طلب موعدك مع د. {{doctorName}} في عيادة {{clinicName}} بتاريخ {{date}} إلى العيادة بنجاح.",
    pushEnabled: true,
    inAppEnabled: true,
    whatsappEnabled: true,
    smsEnabled: false,
    variables: ["doctorName", "clinicName", "date", "patientName"],
  },
  {
    eventKey: "BOOKING_CONFIRMED",
    name: "Booking Confirmed",
    description: "Sent when clinic confirms the booking with queue number and estimated time",
    titleEn: "Appointment Confirmed",
    bodyEn: "Your appointment with Dr. {{doctorName}} is confirmed. Queue #{{queueNumber}}. Clinic: {{clinicName}}, {{clinicAddress}}. Estimated time: {{estimatedTime}}.",
    titleAr: "تم تأكيد الموعد",
    bodyAr: "تم تأكيد موعدك مع د. {{doctorName}}. رقم الانتظار #{{queueNumber}}. عيادة: {{clinicName}}، {{clinicAddress}}. الوقت التقريبي: {{estimatedTime}}.",
    pushEnabled: true,
    inAppEnabled: true,
    whatsappEnabled: true,
    smsEnabled: false,
    variables: ["doctorName", "clinicName", "clinicAddress", "queueNumber", "estimatedTime", "date", "patientName"],
  },
  {
    eventKey: "BOOKING_REJECTED",
    name: "Booking Rejected",
    description: "Sent when clinic rejects a booking request (service fee refunded in full)",
    titleEn: "Booking Request Declined",
    bodyEn: "Your booking request with Dr. {{doctorName}} was declined. Reason: {{reason}}. Service fee refunded in full.",
    titleAr: "تم رفض طلب الحجز",
    bodyAr: "تم رفض طلب الحجز مع د. {{doctorName}}. السبب: {{reason}}. تم استرداد رسوم الخدمة بالكامل.",
    pushEnabled: true,
    inAppEnabled: true,
    whatsappEnabled: true,
    smsEnabled: false,
    variables: ["doctorName", "clinicName", "reason", "patientName"],
  },
  {
    eventKey: "BOOKING_CANCELLED",
    name: "Booking Cancelled",
    description: "Sent when an appointment is cancelled by either party",
    titleEn: "Appointment Cancelled",
    bodyEn: "Your appointment with Dr. {{doctorName}} on {{date}} has been cancelled. {{refundNotice}}",
    titleAr: "تم إلغاء الموعد",
    bodyAr: "تم إلغاء موعدك مع د. {{doctorName}} بتاريخ {{date}}. {{refundNotice}}",
    pushEnabled: true,
    inAppEnabled: true,
    whatsappEnabled: true,
    smsEnabled: false,
    variables: ["doctorName", "clinicName", "date", "refundNotice", "cancelledBy", "patientName"],
  },
  {
    eventKey: "REMINDER_24H",
    name: "24-Hour Reminder",
    description: "Fires exactly 24 hours before the appointment period starts",
    titleEn: "Upcoming Appointment Reminder (24 Hours)",
    bodyEn: "Reminder: You have an appointment tomorrow with Dr. {{doctorName}} at {{clinicName}} at {{time}}. Queue #{{queueNumber}}.",
    titleAr: "تذكير بالموعد (خلال 24 ساعة)",
    bodyAr: "تذكير: لديك موعد غداً مع د. {{doctorName}} في عيادة {{clinicName}} في تمام الساعة {{time}}. رقم الانتظار #{{queueNumber}}.",
    pushEnabled: true,
    inAppEnabled: true,
    whatsappEnabled: true,
    smsEnabled: false,
    variables: ["doctorName", "clinicName", "date", "time", "queueNumber", "patientName"],
  },
  {
    eventKey: "REMINDER_3H",
    name: "3-Hour Reminder",
    description: "Fires exactly 3 hours before the appointment period starts",
    titleEn: "Appointment Starting Soon (3 Hours)",
    bodyEn: "Reminder: Your appointment with Dr. {{doctorName}} at {{clinicName}} is in 3 hours at {{time}}. Queue #{{queueNumber}}.",
    titleAr: "موعدك قريب (خلال 3 ساعات)",
    bodyAr: "تذكير: موعدك مع د. {{doctorName}} في عيادة {{clinicName}} بعد 3 ساعات في تمام {{time}}. رقم الانتظار #{{queueNumber}}.",
    pushEnabled: true,
    inAppEnabled: true,
    whatsappEnabled: true,
    smsEnabled: false,
    variables: ["doctorName", "clinicName", "date", "time", "queueNumber", "patientName"],
  },
  {
    eventKey: "DOCTOR_ABSENCE",
    name: "Doctor Absence Notice",
    description: "Sent to all affected patients when doctor absence is recorded for a date",
    titleEn: "Doctor Absence Notice",
    bodyEn: "Dr. {{doctorName}} is unavailable on {{date}}. Your booking has been cancelled and refunded in full. Reason: {{reason}}.",
    titleAr: "إشعار غياب الطبيب",
    bodyAr: "د. {{doctorName}} غير متاح في تاريخ {{date}}. تم إلغاء حجزك واسترداد المبلغ بالكامل. السبب: {{reason}}.",
    pushEnabled: true,
    inAppEnabled: true,
    whatsappEnabled: true,
    smsEnabled: false,
    variables: ["doctorName", "clinicName", "date", "reason", "patientName"],
  },
  {
    eventKey: "BOOKING_ARRIVED",
    name: "Patient Arrived",
    description: "Sent when clinic confirms the patient has arrived at clinic",
    titleEn: "Arrival Recorded",
    bodyEn: "Your arrival at {{clinicName}} for Dr. {{doctorName}} has been recorded. Current queue #{{queueNumber}}.",
    titleAr: "تم تسجيل الوصول",
    bodyAr: "تم تسجيل وصولك إلى عيادة {{clinicName}} لمقابلة د. {{doctorName}}. دورك في قائمة الانتظار #{{queueNumber}}.",
    pushEnabled: true,
    inAppEnabled: true,
    whatsappEnabled: false,
    smsEnabled: false,
    variables: ["doctorName", "clinicName", "queueNumber", "patientName"],
  },
  {
    eventKey: "BOOKING_COMPLETED",
    name: "Appointment Completed",
    description: "Sent when doctor consultation is completed; unlocks rating and review",
    titleEn: "Appointment Completed",
    bodyEn: "Thank you for visiting Dr. {{doctorName}} at {{clinicName}}. You can now leave a rating and review.",
    titleAr: "اكتمل الموعد",
    bodyAr: "شكراً لزيارتك د. {{doctorName}} في عيادة {{clinicName}}. يمكنك الآن تقييم الخدمة وكتابة مراجعة.",
    pushEnabled: true,
    inAppEnabled: true,
    whatsappEnabled: false,
    smsEnabled: false,
    variables: ["doctorName", "clinicName", "patientName"],
  },
  {
    eventKey: "BOOKING_NO_SHOW",
    name: "Appointment No Show",
    description: "Sent when patient does not attend the appointment",
    titleEn: "Appointment Marked as No-Show",
    bodyEn: "Your appointment with Dr. {{doctorName}} on {{date}} was marked as no-show. Reason: {{reason}}.",
    titleAr: "تم تسجيل عدم الحضور",
    bodyAr: "تم تسجيل عدم حضورك للموعد مع د. {{doctorName}} بتاريخ {{date}}. السبب: {{reason}}.",
    pushEnabled: true,
    inAppEnabled: true,
    whatsappEnabled: true,
    smsEnabled: false,
    variables: ["doctorName", "clinicName", "date", "reason", "patientName"],
  },
  {
    eventKey: "BOOKING_NEGLECTED",
    name: "Appointment Neglected Auto-Settlement",
    description: "Auto-settles 12 hours after period end if unaddressed by clinic",
    titleEn: "Appointment Auto-Settled",
    bodyEn: "Your appointment with Dr. {{doctorName}} on {{date}} was auto-settled by the system. Consultation fee has been refunded to your wallet.",
    titleAr: "تمت تسوية الموعد تلقائياً",
    bodyAr: "تمت تسوية موعدك مع د. {{doctorName}} بتاريخ {{date}} تلقائياً بواسطة النظام. تم استرداد قيمة الكشف إلى محفظتك.",
    pushEnabled: true,
    inAppEnabled: true,
    whatsappEnabled: true,
    smsEnabled: false,
    variables: ["doctorName", "clinicName", "date", "patientName"],
  },
  {
    eventKey: "OTP_VERIFICATION",
    name: "OTP Verification Code",
    description: "Sent to verify phone number during login or authentication",
    titleEn: "Verification Code",
    bodyEn: "Your Salama verification code is {{otpCode}}. Valid for 5 minutes. Do not share this code.",
    titleAr: "رمز التحقق",
    bodyAr: "رمز التحقق الخاص بك في تطبيق سلامة هو {{otpCode}}. صالح لمدة 5 دقائق. لا تشارك هذا الرمز مع أي شخص.",
    pushEnabled: false,
    inAppEnabled: false,
    whatsappEnabled: true,
    smsEnabled: false,
    variables: ["otpCode"],
  },
];

const seedDefaultTemplates = async () => {
  for (const tpl of DEFAULT_NOTIFICATION_TEMPLATES) {
    const existing = await prisma.notificationTemplate.findUnique({
      where: { eventKey: tpl.eventKey },
    });
    if (!existing) {
      await prisma.notificationTemplate.create({
        data: tpl,
      });
    }
  }
};

const getAllTemplates = async (): Promise<NotificationTemplate[]> => {
  // Auto-seed if empty
  const count = await prisma.notificationTemplate.count();
  if (count === 0) {
    await seedDefaultTemplates();
  }
  return prisma.notificationTemplate.findMany({
    orderBy: { createdAt: "asc" },
  });
};

const getTemplateById = async (id: string): Promise<NotificationTemplate | null> => {
  const result = await prisma.notificationTemplate.findUnique({
    where: { id },
  });
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, "Notification template not found");
  }
  return result;
};

const getTemplateByEventKey = async (
  eventKey: string
): Promise<NotificationTemplate | null> => {
  let template = await prisma.notificationTemplate.findUnique({
    where: { eventKey },
  });

  if (!template) {
    // If not in DB, check fallback defaults and create
    const defaultTpl = DEFAULT_NOTIFICATION_TEMPLATES.find(
      (t) => t.eventKey === eventKey
    );
    if (defaultTpl) {
      template = await prisma.notificationTemplate.create({
        data: defaultTpl,
      });
    }
  }

  return template;
};

const createTemplate = async (
  data: ICreateNotificationTemplate
): Promise<NotificationTemplate> => {
  const existing = await prisma.notificationTemplate.findUnique({
    where: { eventKey: data.eventKey },
  });

  if (existing) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `Template for event '${data.eventKey}' already exists`
    );
  }

  return prisma.notificationTemplate.create({
    data: {
      eventKey: data.eventKey,
      name: data.name,
      description: data.description,
      titleEn: data.titleEn,
      bodyEn: data.bodyEn,
      titleAr: data.titleAr,
      bodyAr: data.bodyAr,
      pushEnabled: data.pushEnabled ?? true,
      inAppEnabled: data.inAppEnabled ?? true,
      whatsappEnabled: data.whatsappEnabled ?? true,
      smsEnabled: data.smsEnabled ?? false,
      variables: data.variables ?? [],
      isActive: data.isActive ?? true,
    },
  });
};

const updateTemplate = async (
  id: string,
  payload: IUpdateNotificationTemplate
): Promise<NotificationTemplate> => {
  const existing = await prisma.notificationTemplate.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new ApiError(httpStatus.NOT_FOUND, "Notification template not found");
  }

  return prisma.notificationTemplate.update({
    where: { id },
    data: payload,
  });
};

const deleteTemplate = async (id: string): Promise<NotificationTemplate> => {
  const existing = await prisma.notificationTemplate.findUnique({
    where: { id },
  });

  if (!existing) {
    throw new ApiError(httpStatus.NOT_FOUND, "Notification template not found");
  }

  return prisma.notificationTemplate.delete({
    where: { id },
  });
};

/**
 * Render notification text with dynamic placeholders
 * Arabic and English maintained as fully independent entries
 */
const renderNotification = async (
  eventKey: string,
  lang: "ar" | "en" = "ar",
  variables: Record<string, string | number | undefined | null> = {}
): Promise<{
  title: string;
  body: string;
  pushEnabled: boolean;
  inAppEnabled: boolean;
  whatsappEnabled: boolean;
  smsEnabled: boolean;
  isActive: boolean;
}> => {
  const template = await getTemplateByEventKey(eventKey);

  if (!template) {
    return {
      title: eventKey,
      body: "",
      pushEnabled: true,
      inAppEnabled: true,
      whatsappEnabled: false,
      smsEnabled: false,
      isActive: true,
    };
  }

  const isArabic = lang.toLowerCase() === "ar";
  let title = isArabic ? template.titleAr : template.titleEn;
  let body = isArabic ? template.bodyAr : template.bodyEn;

  // Replace {{variableName}} tokens
  for (const [key, val] of Object.entries(variables)) {
    const safeVal = val !== undefined && val !== null ? String(val) : "";
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    title = title.replace(regex, safeVal);
    body = body.replace(regex, safeVal);
  }

  return {
    title,
    body,
    pushEnabled: template.pushEnabled,
    inAppEnabled: template.inAppEnabled,
    whatsappEnabled: template.whatsappEnabled,
    smsEnabled: template.smsEnabled,
    isActive: template.isActive,
  };
};

export const NotificationTemplateService = {
  getAllTemplates,
  getTemplateById,
  getTemplateByEventKey,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  seedDefaultTemplates,
  renderNotification,
};
