import { Router } from "express";
import { UploadController } from "./upload.controller";
import { upload } from "./file.upload";
import auth from "../../middlewares/auth";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { AdminTier, UserRole } from "@prisma/client";

;

import prisma from '../../../shared/prisma';
import catchAsync from '../../../shared/catchAsync';
import ApiError from '../../../errors/ApiErrors';
import { uploadToS3 } from './file.upload';

const router = Router();
router.post('/settlement-receipt/:settlementId', auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE), upload.single('file'),
  catchAsync(async (req, res) => {
    const settlement = await prisma.settlement.findUnique({ where: { id: req.params.settlementId } });
    if (!settlement) throw new ApiError(404, 'Settlement not found');
    if (['COMPLETED', 'REJECTED'].includes(settlement.status)) throw new ApiError(400, 'Settlement is already closed');
    if (!req.file || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(req.file.mimetype)) {
      throw new ApiError(400, 'Choose a JPEG, PNG, WebP image or PDF receipt');
    }
    const key = await uploadToS3('settlement-receipts/' + settlement.id, req.file);
    res.status(201).json({ success: true, data: key });
  }));

// Use multer's upload middleware
const fileUpload = upload.single("file");

router.post("/file", auth(), fileUpload, UploadController.uploadFiles);
router.post("/private-file-url", auth(UserRole.ADMIN), adminTierAuth(AdminTier.SUPER_ADMIN), UploadController.getPrivateFileUrl);

export const UploadVideo = router;
