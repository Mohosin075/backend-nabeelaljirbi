import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { BannerService } from "./banner.service";
import { fileUploadToS3 } from "../../../helpars/s3Bucket/fileUploadToS3";

const createBanner = catchAsync(async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[];
    const bannerData: { image: string }[] = [];

    if (files && files.length > 0) {
        for (const file of files) {
            const uploadedUrl = await fileUploadToS3(
                "banner",
                "banners",
                file.originalname,
                file.mimetype,
                file.path
            );
            bannerData.push({ image: uploadedUrl });
        }
    }

    const result = await BannerService.createBanner(bannerData);

    sendResponse(res, {
        statusCode: httpStatus.CREATED,
        success: true,
        message: "Banners created successfully",
        data: result,
    });
});

const getAllBanners = catchAsync(async (req: Request, res: Response) => {
    const result = await BannerService.getAllBanners();
    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Banners retrieved successfully",
        data: result,
    });
});
;

const updateBanner = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    let image;

    if (req.file) {
        const file = req.file;
        const uploadedUrl = await fileUploadToS3(
            "banner-updated",
            "banners",
            file.originalname,
            file.mimetype,
            file.path
        );
        image = uploadedUrl;
    }

    // We only update image for now as that's the only field in Banner besides ID/Dates
    // If the user body has other fields, we can include them, but Banner model is simple.
    
    // Check if body has data
    let payload = req.body;
    if (req.body.data) {
        try {
            payload = JSON.parse(req.body.data);
        } catch (e) {
            payload = req.body;
        }
    }

    const updateData = {
        ...payload,
        ...(image && { image })
    };

    const result = await BannerService.updateBanner(id, updateData);

    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Banner updated successfully",
        data: result,
    });
});

const deleteBanner = catchAsync(async (req: Request, res: Response) => {
    const { id } = req.params;
    const result = await BannerService.deleteBanner(id);
    sendResponse(res, {
        statusCode: httpStatus.OK,
        success: true,
        message: "Banner deleted successfully",
        data: result,
    });
});

export const BannerController = {
    createBanner,
    getAllBanners,
    updateBanner,
    deleteBanner
};
