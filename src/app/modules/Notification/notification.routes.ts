import express from "express";
import auth from "../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { NotificationController } from "./notification.controller";

const router = express.Router();

router.get(
    "/doctor",
    auth(),
    NotificationController.getDoctorNotification
);

router.get(
    "/clinic",
    auth(),
    NotificationController.getClinicNotification
);

router.get(
    "/patient",
    auth(),
    NotificationController.getPatientNotification
);



export const NotificationRoutes = router;
