import express from "express";

import { AuthRoutes } from "../modules/Auth/auth.routes";
import { UserRoutes } from "../modules/User/user.routes";
import { PatientRoutes } from "../modules/Patient/patient.routes";
import { DoctorRoutes } from "../modules/Doctor/doctor.routes";
import { ClinicRoutes } from "../modules/Clinic/clinic.routes";
import { BookingRoutes } from "../modules/Booking/booking.routes";
import { RatingRoutes } from "../modules/Rating/rating.routes";
import { ReferralRoutes } from "../modules/Referral/referral.routes";
import { BannerRoutes } from "../modules/Banner/banner.routes";
import { NotificationRoutes } from "../modules/Notification/notification.routes";
import { PaymentRoutes } from "../modules/Payment/payment.routes";
import { WebhookRoutes } from "../modules/Payment/webhook.routes";
import { UploadVideo } from "../modules/uploadFile/upload.routes";
import { AdminRoutes } from "../modules/Admin/admin.routes";
import { OTPSystemRoutes } from "../modules/OTPSystem/otpSystem.routes";
import { SpecialistRoutes } from "../modules/Specialist/specialist.routes";
import { InsuranceRoutes } from "../modules/Insurance/insurance.routes";
import { PatientPlatformSubscriptionRoutes } from "../modules/PatientPlatformSubscription/patientPlatformSubscription.routes";
import { ClinicPlatformSubscriptionRoutes } from "../modules/ClinicPlatformSubscription/clinicPlatformSubscription.routes";
import { PrepaidCardRoutes } from "../modules/PrepaidCard/prepaidCard.routes";
import { AllowNotificationRoutes } from "../modules/AllowNotification/allowNotification.routes";
import { AllowAiChatRoutes } from "../modules/AllowAiChat/allowAiChat.routes";
import { PatientServiceFeeRoutes } from "../modules/PatientServiceFee/patientServiceFee.routes";

const router = express.Router();

const moduleRoutes = [
  {
    path: "/auth",
    route: AuthRoutes,
  },
  {
    path: "/user",
    route: UserRoutes,
  },
  {
    path: "/patient",
    route: PatientRoutes,
  },
  {
    path: "/doctor",
    route: DoctorRoutes,
  },
  {
    path: "/clinic",
    route: ClinicRoutes,
  },
  {
    path: "/booking",
    route: BookingRoutes,
  },
  {
    path: "/rating",
    route: RatingRoutes,
  },
  {
    path: "/referral",
    route: ReferralRoutes,
  },
  {
    path: "/banner",
    route: BannerRoutes,
  },
  {
    path: "/notification",
    route: NotificationRoutes,
  },
  {
    path: "/payment",
    route: PaymentRoutes,
  },
  {
    path: "/subscription/webhooks",
    route: WebhookRoutes,
  },
  {
    path: "/upload-video",
    route: UploadVideo,
  },
  {
    path: "/admin",
    route: AdminRoutes,
  },
  {
    path: "/otp-system",
    route: OTPSystemRoutes,
  },
  {
    path: "/specialist",
    route: SpecialistRoutes,
  },
  {
    path: "/insurance",
    route: InsuranceRoutes,
  },
  {
    path: "/patient-platform-subscription",
    route: PatientPlatformSubscriptionRoutes,
  },
  {
    path: "/clinic-platform-subscription",
    route: ClinicPlatformSubscriptionRoutes,
  },
  {
    path: "/prepaid-card",
    route: PrepaidCardRoutes,
  },
  {
    path: "/allow-notification",
    route: AllowNotificationRoutes,
  },
  {
    path: "/allow-ai-chat",
    route: AllowAiChatRoutes,
  },
  {
    path: "/patient-service-fee",
    route: PatientServiceFeeRoutes,
  }
];

moduleRoutes.forEach((route) => router.use(route.path, route.route));

export default router;
