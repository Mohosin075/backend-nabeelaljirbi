import express from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "@prisma/client";
import { RatingController } from "./rating.controller";
import { ratingValidation } from "./rating.validation";

const router = express.Router();

router.post(
  "/",
  auth(),
  RatingController.createRating
);

router.get("/doctor/:doctorId", RatingController.getRatingsForDoctor);

export const RatingRoutes = router;
