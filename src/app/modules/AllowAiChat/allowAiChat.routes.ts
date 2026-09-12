
import express from "express";
import { AllowAiChatController } from "./allowAiChat.controller";

const router = express.Router();

router.post("/", AllowAiChatController.createAllowAiChat);
router.get("/", AllowAiChatController.getAllowAiChats);

export const AllowAiChatRoutes = router;
