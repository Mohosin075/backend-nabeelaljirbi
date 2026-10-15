import express from "express";
import { AdminTier, UserRole } from "@prisma/client";
import auth from "../../middlewares/auth";
import adminTierAuth from "../../middlewares/adminTierAuth";
import { PrepaidCardController } from "./prepaidCard.controller";

const router = express.Router();

router.post(
  "/create",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  PrepaidCardController.createPrepaidCard
);

router.post("/top-up", auth(), PrepaidCardController.purchasePrepaidCard);

router.get(
  "/top-up-purchase-list",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE, AdminTier.READ_ONLY),
  PrepaidCardController.getTopPurchaseList
);

router.get(
  "/denominations",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE, AdminTier.READ_ONLY),
  PrepaidCardController.getDistinctDenominations
);

router.get(
  "/",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE, AdminTier.READ_ONLY),
  PrepaidCardController.getAllPrepaidCards
);

router.get(
  "/export",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE, AdminTier.READ_ONLY),
  PrepaidCardController.exportPrepaidCards
);

router.post(
  "/bulk-delete",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  PrepaidCardController.bulkDeletePrepaidCards
);

router.get(
  "/:id",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE, AdminTier.READ_ONLY),
  PrepaidCardController.getPrepaidCardById
);

router.patch(
  "/update/:id",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  PrepaidCardController.updatePrepaidCard
);

router.delete(
  "/delete/:id",
  auth(UserRole.ADMIN),
  adminTierAuth(AdminTier.SUPER_ADMIN, AdminTier.FINANCE),
  PrepaidCardController.deletePrepaidCard
);

export const PrepaidCardRoutes = router;
