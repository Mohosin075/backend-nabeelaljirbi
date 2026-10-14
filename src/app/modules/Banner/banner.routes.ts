import express from "express";
import { BannerController } from "./banner.controller";
import { s3Uploader } from "../../../helpars/s3Bucket/fileUploadToS3";
import auth from "../../middlewares/auth";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { AdminTier, UserRole } from "@prisma/client";

const router = express.Router();

router.post(
  "/create-banner",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  s3Uploader.array("images"),
  BannerController.createBanner
);

router.get("/", BannerController.getAllBanners);

router.patch(
  "/update/:id",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  s3Uploader.single("image"),
  BannerController.updateBanner
);

router.delete(
  "/delete/:id",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  BannerController.deleteBanner
);

export const BannerRoutes = router;
