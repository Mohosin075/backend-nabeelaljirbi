import express from "express";
import prisma from "../../../shared/prisma";
import auth from "../../middlewares/auth";
import catchAsync from "../../../shared/catchAsync";
import { adminOperations } from "./admin.operations";
import { requireAdmin } from "./phaseOne.access";
import ApiError from "../../../errors/ApiErrors";

// Authorization and cross-clinic behavior covered by phase-one-access.integration.cjs.
const router = express.Router(),
  operations = adminOperations(prisma);
router.use(auth());
const run = (handler: (req: any) => Promise<any>) =>
  catchAsync(async (req, res) => {
    res.json({ success: true, data: await handler(req) });
  });
router.patch(
  "/accounts/:id/controls",
  run((req) => operations.controls(req.user, req.params.id, req.body)),
);
router.get(
  "/accounts/:id/controls",
  run(async (req) => {
    requireAdmin(req.user, ["SUPER_ADMIN"]);
    const account = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        role: true,
        remoteConsultationsEnabled: true,
        profileApproved: true,
      },
    });
    if (!account) throw new ApiError(404, "Account not found");
    return account;
  }),
);
router.patch(
  "/clinic-phone",
  run((req) => operations.clinicPhone(req.user, req.body)),
);
router.get(
  "/receptionists",
  run((req) => operations.listStaff(req.user, req.query.clinicId as string)),
);
router.post(
  "/receptionists",
  run((req) => operations.createStaff(req.user, req.body)),
);
router.patch(
  "/receptionists/:id",
  run((req) => operations.staffStatus(req.user, req.params.id, req.body)),
);
export const AccountRoutes = router;
