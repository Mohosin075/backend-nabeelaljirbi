
import express from "express";
import { PatientServiceFeeController } from "./patientServiceFee.controller";

const router = express.Router();

router.post("/", PatientServiceFeeController.createPatientServiceFee);
router.get("/", PatientServiceFeeController.getPatientServiceFees);

export const PatientServiceFeeRoutes = router;
