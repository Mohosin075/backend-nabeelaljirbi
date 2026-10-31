import { UserRole } from "@prisma/client";
import { AdminTier } from "@prisma/client";
import adminTierAuth from "../../middlewares/adminTierAuth";
import express from "express";
import { upload } from "../../../helpars/file/fileUploader";
import auth from "../../middlewares/auth";
import { UserController } from "./user.controller";

const router = express.Router();

const singleUpload = upload.single("image");

router.post("/create-user", UserController.createUser);

router.post("/create-social-user", UserController.createSocialUser);

router.patch("/update-user", auth(), singleUpload, UserController.updateUser);

router.patch(
  "/update-status/:id",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS),
  UserController.updateStatus
);

router.get("/", auth(UserRole.ADMIN), adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.OPERATIONS, AdminTier.SUPPORT, AdminTier.READ_ONLY), UserController.allUsers);

export const UserRoutes = router;
