import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import path from "path";

export type ReportTable = {
  title: string;
  filters: string;
  columns: string[];
  rows: Array<Array<string | number>>;
};
export async function excelReport(table: ReportTable) {
  const book = new ExcelJS.Workbook();
  book.creator = "Salama";
  const sheet = book.addWorksheet("Report");
  sheet.addRow([table.title]);
  sheet.addRow([table.filters]);
  sheet.addRow(table.columns);
  table.rows.forEach((row) => {
    const added = sheet.addRow(row);
    row.forEach((value, index) => {
      if (
        table.columns[index] === "Receipt" &&
        typeof value === "string" &&
        /^https?:\/\//i.test(value)
      )
        added.getCell(index + 1).value = {
          text: "View receipt",
          hyperlink: value,
        };
    });
  });
  sheet.getRow(3).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 3 }];
  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: table.columns.length },
  };
  sheet.columns.forEach((column, index) => {
    column.width = Math.min(42, Math.max(18, table.columns[index].length + 3));
  });
  return Buffer.from(await book.xlsx.writeBuffer());
}
export function pdfReport(table: ReportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margin: 32,
      bufferPages: true,
    });
    const parts: Buffer[] = [];
    doc.on("data", (part) => parts.push(part));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(parts)));
    const fontDirectory = path.join(
      path.dirname(
        require.resolve("@fontsource/noto-sans-arabic/package.json"),
      ),
      "files",
    );
    doc.registerFont(
      "Arabic",
      path.join(fontDirectory, "noto-sans-arabic-arabic-400-normal.woff"),
    );
    const width = doc.page.width - 64,
      cell = width / table.columns.length;
    let y = 32;
    const header = () => {
      doc
        .font("Helvetica-Bold")
        .fontSize(16)
        .fillColor("#123c55")
        .text(table.title, 32, 28, { width });
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#425466")
        .text(table.filters, 32, 53, { width, height: 36, ellipsis: true });
      y = 96;
      doc.rect(32, y, width, 32).fill("#123c55");
      table.columns.forEach((label, i) =>
        doc
          .fillColor("white")
          .font("Helvetica-Bold")
          .fontSize(8)
          .text(label, 37 + cell * i, y + 6, { width: cell - 10, height: 22 }),
      );
      y += 32;
    };
    header();
    if (!table.rows.length)
      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor("#425466")
        .text("No records match these filters.", 32, y + 20);
    table.rows.forEach((row, index) => {
      const values = row.map((value, index) =>
        table.columns[index] === "Receipt" &&
        typeof value === "string" &&
        /^https?:\/\//i.test(value)
          ? "View receipt"
          : typeof value === "number"
            ? value.toFixed(2)
            : String(value),
      );
      const height = Math.min(
        76,
        Math.max(
          34,
          ...values.map(
            (value) =>
              Math.ceil(value.length / Math.max(9, Math.floor(cell / 5))) * 13 +
              12,
          ),
        ),
      );
      if (y + height > doc.page.height - 44) {
        doc.addPage();
        header();
      }
      doc.rect(32, y, width, height).fill(index % 2 ? "#f0f5f8" : "#ffffff");
      values.forEach((value, i) => {
        const arabic = /[\u0600-\u06ff]/.test(value);
        if (arabic && /[A-Za-z0-9]/.test(value)) {
          // Fontsource language subsets do not contain each other's glyphs.
          // Place shaped Arabic and Latin runs separately so country codes,
          // account numbers and mixed-language names cannot disappear.
          const left = 37 + cell * i,
            right = left + cell - 10;
          let pen = right,
            line = y + 6;
          for (const run of value.match(
            /[\u0600-\u06ff]+|[^\u0600-\u06ff]+/g,
          ) || []) {
            doc
              .font(/[\u0600-\u06ff]/.test(run) ? "Arabic" : "Helvetica")
              .fontSize(8);
            let text = run;
            while (
              doc.widthOfString(text, { features: [] }) > cell - 10 &&
              text.length > 1
            )
              text = text.slice(0, -1);
            const runWidth = doc.widthOfString(text, { features: [] });
            if (pen - runWidth < left) {
              pen = right;
              line += 14;
            }
            if (line + 12 > y + height) break;
            doc.fillColor("#172b3a").text(text, pen - runWidth, line, {
              lineBreak: false,
              features: [],
            });
            pen -= runWidth;
          }
          return;
        }
        // Supplying features makes PDFKit shape the complete Arabic line rather
        // than separately laying out words in left-to-right cache order.
        doc
          .font(arabic ? "Arabic" : "Helvetica")
          .fontSize(8)
          .fillColor("#172b3a")
          .text(value, 37 + cell * i, y + 6, {
            width: cell - 10,
            height: height - 10,
            ellipsis: true,
            align: arabic ? "right" : "left",
            ...(arabic ? { features: [] } : {}),
            ...(table.columns[i] === "Receipt" &&
            typeof row[i] === "string" &&
            /^https?:\/\//i.test(String(row[i]))
              ? { link: String(row[i]), underline: true }
              : {}),
          });
      });
      y += height;
    });
    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index++) {
      doc.switchToPage(index);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#526677")
        .text(
          `Salama | ${table.rows.length} records | Page ${index + 1} of ${range.count}`,
          32,
          doc.page.height - 28,
          { width, lineBreak: false },
        );
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
