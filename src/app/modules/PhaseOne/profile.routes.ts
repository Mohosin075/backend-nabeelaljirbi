import express from "express";
import type { PrismaClient } from "@prisma/client";
import prisma from "../../../shared/prisma";
import auth from "../../middlewares/auth";
import catchAsync from "../../../shared/catchAsync";
import { phaseOneOperations } from "./phaseOne.operations";

// Targeted authorization/rollback integration tests: phase-one.integration.cjs.
// These routes never change wallets or process a payment.
export function createProfileRoutes(
  db: PrismaClient,
  authenticate: any = auth(),
) {
  const router = express.Router(),
    operations = phaseOneOperations(db);
  router.use(authenticate);
  const run = (handler: (req: any) => Promise<any>) =>
    catchAsync(async (req, res) => {
      res.json({ success: true, data: await handler(req) });
    });
  router.get(
    "/profile-access",
    run((req) => operations.access(req.user.id)),
  );
  router.get(
    "/profile-changes",
    run((req) => operations.listRequests(req.user, req.query)),
  );
  router.post(
    "/profile-changes",
    run((req) => operations.requestChange(req.user.id, req.body)),
  );
  router.patch(
    "/profile-changes/:id",
    run((req) => operations.reviewChange(req.params.id, req.body, req.user)),
  );
  router.get(
    "/payout-profile",
    run((req) => operations.readBank(req.user.id)),
  );
  router.put(
    "/payout-profile",
    run((req) => operations.saveBank(req.user.id, req.body)),
  );
  return router;
}
export const ProfileRoutes = createProfileRoutes(prisma);
