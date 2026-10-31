import express from "express";
import prisma from "../../../shared/prisma";
import auth from "../../middlewares/auth";
import catchAsync from "../../../shared/catchAsync";
import { historyOperations } from "./history.operations";
const router = express.Router(),
  operations = historyOperations(prisma);
router.use(auth());
const run = (handler: (req: any) => Promise<any>) =>
  catchAsync(async (req, res) => {
    res.json({ success: true, data: await handler(req) });
  });
router.get(
  "/my-complaints",
  run((req) => operations.complaints(req.user, req.query)),
);
router.get(
  "/wallet-history",
  run((req) => operations.wallet(req.user, req.query)),
);
router.get(
  "/financial-monitoring",
  run((req) => operations.monitoring(req.user, req.query)),
);
router.get(
  "/overview",
  run((req) => operations.overview(req.user)),
);
export const HistoryRoutes = router;
