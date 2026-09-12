import { UserRole } from "@prisma/client";
import express from "express";
import { AuthController } from "./auth.controller";
import { authValidation } from "./auth.validation";
import auth from "../../middlewares/auth";


const router = express.Router();

router.post("/send-otp", AuthController.sendOTP);

router.post("/verify-otp", AuthController.verifyUserByOTP);

router.get("/refresh-token", AuthController.refreshToken);


router.delete("/delete-account", auth(), AuthController.deleteUserAccount);

export const AuthRoutes = router;
