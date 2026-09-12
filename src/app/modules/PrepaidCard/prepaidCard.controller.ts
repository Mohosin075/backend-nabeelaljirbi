import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import pick from "../../../shared/pick";
import sendResponse from "../../../shared/sendResponse";
import { PrepaidCardService } from "./prepaidCard.service";

const createPrepaidCard = catchAsync(async (req: Request, res: Response) => {
  const result = await PrepaidCardService.createPrepaidCard(req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Prepaid card created successfully",
    data: result,
  });
});

const getAllPrepaidCards = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ["searchTerm", "used"]);
  const options = pick(req.query, ["limit", "page", "sortBy", "sortOrder"]);

  const result = await PrepaidCardService.getAllPrepaidCards(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Prepaid cards retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const getPrepaidCardById = catchAsync(async (req: Request, res: Response) => {
  const result = await PrepaidCardService.getPrepaidCardById(req.params.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Prepaid card retrieved successfully",
    data: result,
  });
});

const updatePrepaidCard = catchAsync(async (req: Request, res: Response) => {
  const result = await PrepaidCardService.updatePrepaidCard(
    req.params.id,
    req.body
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Prepaid card updated successfully",
    data: result,
  });
});

const deletePrepaidCard = catchAsync(async (req: Request, res: Response) => {
  const result = await PrepaidCardService.deletePrepaidCard(req.params.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Prepaid card deleted successfully",
    data: result,
  });
});

const purchasePrepaidCard = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any; 
  // Assuming req.user is populated by auth middleware. 
  // However, if the middleware puts it in req.user, I need to be sure it's there. 
  // Usually strict typing requires a custom definition or using (req as any).user.

  const result = await PrepaidCardService.purchasePrepaidCard(user.id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Card redeemed successfully",
    data: result,
  });
});

const getTopPurchaseList = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ["searchTerm"]);
  const options = pick(req.query, ["limit", "page", "sortBy", "sortOrder"]);

  const result = await PrepaidCardService.getTopPurchaseList(filters, options);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Purchased prepaid cards retrieved successfully",
    meta: result.meta,
    data: result.data,
  });
});

const exportPrepaidCards = catchAsync(async (req: Request, res: Response) => {
  const buffer = await PrepaidCardService.exportPrepaidCardsToExcel();
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="prepaid_cards.xlsx"');
  res.send(buffer);
});

export const PrepaidCardController = {
  createPrepaidCard,
  getAllPrepaidCards,
  getPrepaidCardById,
  updatePrepaidCard,
  deletePrepaidCard,
  purchasePrepaidCard,
  getTopPurchaseList,
  exportPrepaidCards,
};
