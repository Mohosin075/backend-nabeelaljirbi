import express from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { UserRole } from "@prisma/client";
import { ReferralController } from "./referral.controller";
import { referralValidation } from "./referral.validation";

const router = express.Router();

router.post('/apply', auth(), ReferralController.ReferralBonus)
router.post('/claim-bonus', auth(), ReferralController.claimRefelarsBunus)

export const ReferralRoutes = router;
