import express from "express";
import prisma from "../../../shared/prisma";
import auth from "../../middlewares/auth";
import catchAsync from "../../../shared/catchAsync";
import ApiError from "../../../errors/ApiErrors";
import { bookingOperations } from "./booking.operations";
import { historyOperations } from "./history.operations";
import { excelReport, pdfReport, ReportTable } from "./report.export";

const router = express.Router();
router.use(auth());
router.get(
  "/reports/:kind/:format",
  catchAsync(async (req: any, res) => {
    if (!["ADMIN", "DOCTOR", "CLINIC"].includes(req.user.role))
      throw new ApiError(403, "Report access denied");
    const { kind, format } = req.params;
    if (
      !["pdf", "xlsx"].includes(format) ||
      !["bookings", "wallet", "payouts"].includes(kind)
    )
      throw new ApiError(
        400,
        "Choose bookings, wallet or payouts and PDF or Excel",
      );
    const records = await prisma.$transaction(
      async (tx) => {
        const bookings = bookingOperations(tx as any, {
          transition() {},
          cancel() {},
        });
        const history = historyOperations(tx as any);
        const records: any[] = [];
        // A consistent read snapshot prevents concurrent inserts shifting pages.
        for (let page = 1; ; page++) {
          const result =
            kind === "bookings"
              ? await bookings.list(req.user, {
                  ...req.query,
                  page,
                  limit: 5000,
                })
              : await history[kind === "payouts" ? "payouts" : "wallet"](
                  req.user,
                  {
                    ...req.query,
                    page,
                    limit: 5000,
                  },
                );
          if (result.meta.total > 50000)
            throw new ApiError(
              400,
              "Narrow the date range to export at most 50,000 records",
            );
          records.push(...result.data);
          if (records.length >= result.meta.total) break;
          if (!result.data.length)
            throw new ApiError(
              409,
              "Incomplete report; retry with a narrower date range",
            );
        }
        return records;
      },
      { isolationLevel: "RepeatableRead", timeout: 30000 },
    );
    const table: ReportTable = {
      title:
        kind === "bookings"
          ? "Booking and Fee Report"
          : kind === "payouts"
            ? "Settlements and Withdrawal Requests"
            : "Wallet Ledger Report",
      filters: `Generated ${new Date().toISOString()} | ${
        Object.entries(req.query)
          .filter(([key]) => !["page", "limit"].includes(key))
          .map(([key, value]) => `${key}: ${value}`)
          .join(" | ") || "All records in your access scope"
      }`,
      columns:
        kind === "bookings"
          ? [
              "Date / Serial",
              "Status / Model",
              "Clinic / Country",
              "Doctor",
              "Patient",
              "Consultation",
              "Patient fee",
              "Clinic fee",
            ]
          : kind === "payouts"
            ? [
                "Request",
                "Requested / Paid",
                "Recipient / Phone",
                "Status / Method",
                "Country",
                "Amount",
                "Reference",
                "Receipt",
              ]
            : [
                "Date",
                "Record ID",
                "Booking ID",
                "Type",
                "Direction",
                "Amount",
                "Reference",
                "Receipt",
              ],
      rows: records.map((row) =>
        kind === "bookings"
          ? [
              row.consultDate.toISOString().slice(0, 10) +
                " / " +
                row.serialNumber,
              row.displayStatus + " / " + row.collectionMode,
              (row.clinic.clinicName || "") +
                " / " +
                (row.feeCountry || "Historical unspecified"),
              row.doctor.user.fullName || "",
              row.patient.user.fullName || "",
              row.consultFee,
              row.serviceFeeAmount,
              row.clinicServiceFee,
            ]
          : kind === "payouts"
            ? [
                row.settlementNumber,
                row.createdAt.toISOString().slice(0, 10) +
                  " / " +
                  (row.completedAt?.toISOString().slice(0, 10) || "Unpaid"),
                (row.clinic?.clinicName || row.doctor?.user.fullName || "") +
                  " / " +
                  (row.clinic?.user.phoneNumber ||
                    row.doctor?.user.phoneNumber ||
                    ""),
                (row.status === "COMPLETED" ? "PAID" : row.status) +
                  " / " +
                  (row.payoutMethod || "Historical unspecified"),
                row.payoutCountry || "Historical unspecified",
                row.amount,
                row.reference || "",
                row.receiptUrl || "",
              ]
            : [
                row.createdAt.toISOString(),
                row.id,
                row.appointmentId || "",
                row.type,
                row.direction,
                row.amount,
                row.reference || "",
                row.receiptUrl || "",
              ],
      ),
    };
    const file =
      format === "pdf" ? await pdfReport(table) : await excelReport(table);
    res.setHeader(
      "Content-Type",
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="salama-${kind}.${format}"`,
    );
    res.send(file);
  }),
);
export const ReportRoutes = router;
