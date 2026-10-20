
import express from "express";
import { AdminTier, UserRole } from "@prisma/client";
import auth from "../../middlewares/auth";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { OTPSystemController } from "./otpSystem.controller";

const router = express.Router();

router.post(
  "/",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS, AdminTier.SUPPORT),
  OTPSystemController.createOTPSystem
);
router.get(
  "/",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS, AdminTier.SUPPORT, AdminTier.READ_ONLY),
  OTPSystemController.getOTPSystems
);
router.get(
  "/:id",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS, AdminTier.SUPPORT, AdminTier.READ_ONLY),
  OTPSystemController.getOTPSystemById
);
router.patch(
  "/:id",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS, AdminTier.SUPPORT),
  OTPSystemController.updateOTPSystem
);
router.delete(
  "/:id",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS, AdminTier.SUPPORT),
  OTPSystemController.deleteOTPSystem
);

export const OTPSystemRoutes = router;
