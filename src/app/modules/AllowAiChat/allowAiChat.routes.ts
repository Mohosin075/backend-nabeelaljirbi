
import express from "express";
import { AdminTier, UserRole } from "@prisma/client";
import auth from "../../middlewares/auth";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { AllowAiChatController } from "./allowAiChat.controller";

const router = express.Router();

router.post(
  "/",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  AllowAiChatController.createAllowAiChat
);
router.get("/my-status", auth(), AllowAiChatController.getMyAiStatus);
router.get(
  "/admin-stats",
  auth(UserRole.ADMIN),
  AllowAiChatController.getAdminAiStats
);
router.get("/", AllowAiChatController.getAllowAiChats);

export const AllowAiChatRoutes = router;
