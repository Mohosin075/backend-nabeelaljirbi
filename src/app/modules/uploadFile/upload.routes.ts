import { Router } from "express";
import { UploadController } from "./upload.controller";
import { upload } from "./file.upload";

;

const router = Router();

// Use multer's upload middleware
const fileUpload = upload.single("file");

router.post("/file", fileUpload, UploadController.uploadFiles);
router.post("/private-file-url", UploadController.getPrivateFileUrl);

export const UploadVideo = router;
