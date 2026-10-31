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
      !["bookings", "wallet"].includes(kind)
    )
      throw new ApiError(400, "Choose bookings or wallet and PDF or Excel");
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
              : await history.wallet(req.user, {
                  ...req.query,
                  page,
                  limit: 5000,
                });
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
        kind === "bookings" ? "Booking and Fee Report" : "Wallet Ledger Report",
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
          : ["Date", "Record ID", "Booking ID", "Type", "Direction", "Amount"],
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
          : [
              row.createdAt.toISOString(),
              row.id,
              row.appointmentId || "",
              row.type,
              row.direction,
              row.amount,
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
