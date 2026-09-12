import express from "express";
import { UserRole } from "@prisma/client";
import auth from "../../middlewares/auth";
import { PrepaidCardController } from "./prepaidCard.controller";

const router = express.Router();

router.post(
  "/create",
  //   auth(UserRole.ADMIN),
  PrepaidCardController.createPrepaidCard,
);

router.post("/top-up", auth(), PrepaidCardController.purchasePrepaidCard);

router.get(
  "/top-up-purchase-list",
  //   auth(UserRole.ADMIN),
  PrepaidCardController.getTopPurchaseList,
);

router.get(
  "/",
  //   auth(UserRole.ADMIN),
  PrepaidCardController.getAllPrepaidCards,
);

router.get("/export", PrepaidCardController.exportPrepaidCards);

router.get(
  "/:id",
  auth(UserRole.ADMIN),
  PrepaidCardController.getPrepaidCardById,
);

router.patch(
  "/update/:id",
  //   auth(UserRole.ADMIN),
  PrepaidCardController.updatePrepaidCard,
);

router.delete(
  "/delete/:id",
  //   auth(UserRole.ADMIN),
  PrepaidCardController.deletePrepaidCard,
);

export const PrepaidCardRoutes = router;
