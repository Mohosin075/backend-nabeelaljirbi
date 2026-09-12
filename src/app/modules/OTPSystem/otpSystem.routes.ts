
import express from "express";
import { OTPSystemController } from "./otpSystem.controller";

const router = express.Router();

router.post("/", OTPSystemController.createOTPSystem);
router.get("/", OTPSystemController.getOTPSystems);
router.get("/:id", OTPSystemController.getOTPSystemById);
router.patch("/:id", OTPSystemController.updateOTPSystem);
router.delete("/:id", OTPSystemController.deleteOTPSystem);

export const OTPSystemRoutes = router;
