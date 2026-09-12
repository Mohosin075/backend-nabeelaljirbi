import express from "express";
import { BannerController } from "./banner.controller";
import { s3Uploader } from "../../../helpars/s3Bucket/fileUploadToS3";

const router = express.Router();

router.post(
    "/create-banner",
    s3Uploader.array("images"),
    BannerController.createBanner
);

router.get("/", BannerController.getAllBanners);


router.patch(
    "/update/:id",
    s3Uploader.single("image"),
    BannerController.updateBanner
);

router.delete("/delete/:id", BannerController.deleteBanner);

export const BannerRoutes = router;
