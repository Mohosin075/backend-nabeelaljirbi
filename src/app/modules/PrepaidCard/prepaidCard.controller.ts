import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import pick from "../../../shared/pick";
import sendResponse from "../../../shared/sendResponse";
import { PrepaidCardService } from "./prepaidCard.service";

const createPrepaidCard = catchAsync(async (req: Request, res: Response) => {
  const currentAdmin = (req as any).user;
  const result = await PrepaidCardService.createPrepaidCard(req.body, currentAdmin);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Prepaid card created successfully",
    data: result,
  });
});

const getAllPrepaidCards = catchAsync(async (req: Request, res: Response) => {
  const filters = pick(req.query, ["searchTerm", "used", "amount"]);
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

const getDistinctDenominations = catchAsync(async (req: Request, res: Response) => {
  const result = await PrepaidCardService.getDistinctDenominations();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Prepaid card denominations retrieved successfully",
    data: result,
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
  const currentAdmin = (req as any).user;
  const result = await PrepaidCardService.deletePrepaidCard(req.params.id, currentAdmin);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Prepaid card deleted successfully",
    data: result,
  });
});

const bulkDeletePrepaidCards = catchAsync(async (req: Request, res: Response) => {
  const currentAdmin = (req as any).user;
  const { ids } = req.body;
  const result = await PrepaidCardService.bulkDeletePrepaidCards(ids, currentAdmin);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.message,
    data: result,
  });
});

const purchasePrepaidCard = catchAsync(async (req: Request, res: Response) => {
  const user = (req as any).user;
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
  const filters = pick(req.query, ["searchTerm", "used", "amount"]);
  let ids: string[] | undefined;

  if (req.query.ids) {
    if (Array.isArray(req.query.ids)) {
      ids = req.query.ids as string[];
    } else {
      ids = (req.query.ids as string).split(",").map((id) => id.trim()).filter(Boolean);
    }
  }

  const buffer = await PrepaidCardService.exportPrepaidCardsToExcel({
    ...filters,
    ids,
  });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="prepaid_cards.xlsx"'
  );
  res.status(httpStatus.OK).send(buffer);
});

export const PrepaidCardController = {
  createPrepaidCard,
  getAllPrepaidCards,
  getDistinctDenominations,
  getPrepaidCardById,
  updatePrepaidCard,
  deletePrepaidCard,
  bulkDeletePrepaidCards,
  purchasePrepaidCard,
  getTopPurchaseList,
  exportPrepaidCards,
};
