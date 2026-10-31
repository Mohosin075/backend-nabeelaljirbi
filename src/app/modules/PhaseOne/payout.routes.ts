import express from "express";
import prisma from "../../../shared/prisma";
import auth from "../../middlewares/auth";
import catchAsync from "../../../shared/catchAsync";
import { settlementOperations } from "../Admin/settlement.operations";
import { bookingScope, requireAdmin } from "./phaseOne.access";
import { pageOptions } from "./phaseOne.policy";
import ApiError from "../../../errors/ApiErrors";

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
    if (!["ADMIN", "CLINIC", "DOCTOR"].includes(req.user.role))
      throw new ApiError(403, "Payout history access denied");
    if (req.user.role === "ADMIN")
      requireAdmin(req.user, ["SUPER_ADMIN", "FINANCE", "READ_ONLY"]);
    const scope =
      req.user.role === "ADMIN" ? {} : await bookingScope(prisma, req.user);
    const { page, limit, skip } = pageOptions(req.query);
    const where = {
      ...scope,
      ...(req.query.status && req.query.status !== "ALL"
        ? { status: String(req.query.status) }
        : {}),
    };
    const [data, total] = await Promise.all([
      prisma.settlement.findMany({
        where,
        take: limit,
        skip,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      }),
      prisma.settlement.count({ where }),
    ]);
    // Internal review notes are not part of a recipient's receipt/history.
    res.json({
      success: true,
      data: {
        data: data.map((row) =>
          req.user.role === "ADMIN" ? row : { ...row, notes: undefined },
        ),
        meta: { page, limit, total },
      },
    });
  }),
);
export const PayoutRoutes = router;
