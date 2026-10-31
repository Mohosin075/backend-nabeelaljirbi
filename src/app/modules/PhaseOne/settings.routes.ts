import express from "express";
import prisma from "../../../shared/prisma";
import auth from "../../middlewares/auth";
import catchAsync from "../../../shared/catchAsync";
import { phaseOneOperations } from "./phaseOne.operations";
import { requireAdmin } from "./phaseOne.access";
const router = express.Router(),
  operations = phaseOneOperations(prisma);
router.use(auth());
router.get(
  "/country-fees",
  catchAsync(async (req: any, res) => {
    requireAdmin(req.user, ["SUPER_ADMIN", "FINANCE", "READ_ONLY"]);
    res.json({
      success: true,
      data: await prisma.patientServiceFee.findMany({
        orderBy: { country: "asc" },
      }),
    });
  }),
);
router.put(
  "/country-fees",
  catchAsync(async (req: any, res) => {
    res.json({
      success: true,
      data: await operations.countryFees(req.body.records, req.user),
    });
  }),
);
export const CountrySettingRoutes = router;
