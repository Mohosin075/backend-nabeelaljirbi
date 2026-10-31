import express from "express";
import prisma from "../../../shared/prisma";
import auth from "../../middlewares/auth";
import catchAsync from "../../../shared/catchAsync";
import { settlementOperations } from "../Admin/settlement.operations";
import { historyOperations } from "./history.operations";

const router = express.Router(),
  operations = settlementOperations(prisma);
router.use(auth());
router.post(
  "/payouts",
  catchAsync(async (req: any, res) => {
    res.json({
      success: true,
      data: await operations.create(req.body, req.user),
    });
  }),
);
router.get(
  "/payouts",
  catchAsync(async (req: any, res) => {
    res.json({
      success: true,
      data: await historyOperations(prisma).payouts(req.user, req.query),
    });
  }),
);
export const PayoutRoutes = router;
