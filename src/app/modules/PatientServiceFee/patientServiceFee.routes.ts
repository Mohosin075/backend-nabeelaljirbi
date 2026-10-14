
import express from "express";
import { AdminTier, UserRole } from "@prisma/client";
import auth from "../../middlewares/auth";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { PatientServiceFeeController } from "./patientServiceFee.controller";

const router = express.Router();

router.post(
  "/",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  PatientServiceFeeController.createPatientServiceFee
);
router.get("/", PatientServiceFeeController.getPatientServiceFees);

export const PatientServiceFeeRoutes = router;
