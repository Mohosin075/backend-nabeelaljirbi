import { Router } from "express";
import { UploadController } from "./upload.controller";
import { upload } from "./file.upload";
import auth from "../../middlewares/auth";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { AdminTier, UserRole } from "@prisma/client";

;

const router = Router();

// Use multer's upload middleware
const fileUpload = upload.single("file");

router.post("/file", auth(), fileUpload, UploadController.uploadFiles);
router.post("/private-file-url", auth(UserRole.ADMIN), adminTierAuth(AdminTier.SUPER_ADMIN), UploadController.getPrivateFileUrl);

export const UploadVideo = router;
