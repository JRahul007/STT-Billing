// Billing export helpers: builds one report model shared by the Excel and PDF
// exports, and writes it as a real .xlsx workbook (Office Open XML, no deps)
// or as a PDF via jsPDF/autoTable.
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const LOCATION_NAMES = { IDR: "INDORE", NSK: "NASHIK", BOM: "MUMBAI" };
// Only these columns get a sum in the Total row (as in the reference sheet).
const TOTALED_KEYS = ["total_amount", "bom_expense", "other_expense"];

const COLUMN_WIDTHS = {
  invoice_no: 12,
  date: 13,
  location: 36,
  weight: 9,
  total_amount: 11,
  bom_expense: 11,
  bom_exp_description: 32,
  other_expense: 11,
  other_exp_description: 32,
  extra_charges_total: 11,
  extra_charges_desc: 85,
  payment_status: 15,
};

/**
 * Build the export layout from already date-grouped billings.
 * rows[i].cells holds raw values (numbers stay numbers); the date cell is only
 * filled on the first row of each group, which carries `span` = group size.
 */
export function buildBillingReport({ groups, cols, getCellValue, billings, extractLocation }) {
  const dateIdx = cols.findIndex((c) => c.key === "date");
  const rows = [];
  groups.forEach((group) => {
    group.items.forEach((b, bi) => {
      const cells = cols.map((c, ci) => {
        if (ci === dateIdx) return bi === 0 ? group.date : null;
        const val = getCellValue(b, c);
        if (c.numeric && typeof val !== "number") {
          const n = Number(val);
          return val !== "-" && val !== "" && Number.isFinite(n) ? n : val;
        }
        return val;
      });
      rows.push({ cells, groupStart: bi === 0, span: bi === 0 ? group.items.length : 0 });
    });
  });

  const totaledIdx = cols
    .map((c, i) => (TOTALED_KEYS.includes(c.key) ? i : -1))
    .filter((i) => i >= 0);
  let totals = null;
  if (totaledIdx.length > 0) {
    const values = {};
    totaledIdx.forEach((i) => {
      values[i] = billings.reduce((s, b) => s + (Number(b[cols[i].key]) || 0), 0);
    });
    totals = { labelIdx: totaledIdx[0] - 1, values };
  }

  let summary = null;
  if (cols.some((c) => c.key === "total_amount")) {
    const byLoc = new Map();
    billings.forEach((b) => {
      const code = extractLocation(b.location) || "OTHER";
      const name = LOCATION_NAMES[code] || code;
      byLoc.set(name, (byLoc.get(name) || 0) + (Number(b.total_amount) || 0));
    });
    const items = Array.from(byLoc, ([location, amount]) => ({ location, amount }))
      .sort((a, b) => b.amount - a.amount);
    const locIdx = cols.findIndex((c) => c.key === "location");
    summary = {
      items,
      total: items.reduce((s, it) => s + it.amount, 0),
      colIdx: locIdx >= 0 && locIdx + 1 < cols.length ? locIdx : 0,
    };
  }

  return { cols, dateIdx, rows, totals, summary };
}

// ---------------------------------------------------------------------------
// PDF writer
// ---------------------------------------------------------------------------

/** Returns a jsPDF document laid out like the Excel export. */
export function buildBillingPdf(report, { title, subtitle }) {
  const { cols, dateIdx, rows, totals, summary } = report;
  const doc = new jsPDF({ orientation: "landscape" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  // Helvetica has no ₹ glyph, so currency is written as "Rs.".
  const fmt = (c, v) => {
    if (v === null || v === undefined) return "";
    if (c.currency && typeof v === "number") return "Rs. " + v.toLocaleString("en-IN");
    return String(v);
  };

  // --- Header: red underlined title + grey subtitle ---
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(255, 0, 0);
  doc.text(title, pageWidth / 2, 14, { align: "center" });
  const titleWidth = doc.getTextWidth(title);
  doc.setDrawColor(255, 0, 0);
  doc.setLineWidth(0.5);
  doc.line(pageWidth / 2 - titleWidth / 2, 15.5, pageWidth / 2 + titleWidth / 2, 15.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(128, 128, 128);
  doc.text(subtitle, pageWidth / 2, 22, { align: "center" });

  // --- Table: the date cell spans all rows of its date group ---
  const body = [];
  const groupStartRows = new Set();
  rows.forEach((row) => {
    if (row.groupStart) groupStartRows.add(body.length);
    const cells = [];
    row.cells.forEach((v, ci) => {
      if (ci === dateIdx) {
        if (row.groupStart) {
          cells.push({ content: fmt(cols[ci], v), rowSpan: row.span, styles: { valign: "middle", halign: "center" } });
        }
        return;
      }
      cells.push(fmt(cols[ci], v));
    });
    body.push(cells);
  });

  const totalsIdx = body.length;
  if (totals) {
    body.push(
      cols.map((c, ci) => {
        if (ci === totals.labelIdx) return "Total";
        if (ci in totals.values) return fmt(c, totals.values[ci]);
        return "";
      })
    );
  }

  autoTable(doc, {
    head: [cols.map((c) => c.label)],
    body,
    startY: 27,
    theme: "grid",
    margin: { top: 10, left: margin, right: margin, bottom: 12 },
    tableWidth: "auto",
    styles: {
      fontSize: 8,
      cellPadding: { top: 2, right: 2.5, bottom: 2, left: 2.5 },
      lineWidth: 0.3,
      lineColor: [0, 0, 0],
      textColor: [0, 0, 0],
      font: "helvetica",
      overflow: "linebreak",
      halign: "center",
      valign: "middle",
    },
    headStyles: {
      fillColor: [67, 97, 238],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      lineWidth: 0.3,
      lineColor: [0, 0, 0],
    },
    didParseCell: (data) => {
      if (data.section !== "body" || !totals || data.row.index !== totalsIdx) return;
      const ci = data.column.index;
      if (ci === totals.labelIdx || ci in totals.values) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [255, 255, 0];
      } else {
        // No fill: a white fill here would paint over the last data row's bottom border.
        data.cell.styles.lineWidth = 0;
        data.cell.styles.fillColor = false;
      }
    },
    didDrawCell: (data) => {
      // Thick separator above every date group after the first
      if (data.section !== "body" || data.row.index === 0 || !groupStartRows.has(data.row.index)) return;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.9);
      doc.line(data.cell.x, data.cell.y, data.cell.x + data.cell.width, data.cell.y);
    },
    didDrawPage: () => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(120, 120, 120);
      doc.text(`Page ${doc.getCurrentPageInfo().pageNumber}`, pageWidth - margin, pageHeight - 5, { align: "right" });
    },
  });

  // --- Location-wise summary, aligned under the Location column ---
  if (summary && summary.items.length > 0) {
    const left = doc.lastAutoTable.columns.slice(0, summary.colIdx).reduce((s, c) => s + c.width, margin);
    autoTable(doc, {
      head: [["LOCATION", "AMOUNT"]],
      body: [...summary.items.map((it) => [it.location, String(it.amount)]), ["TOTAL", String(summary.total)]],
      startY: doc.lastAutoTable.finalY + 8,
      margin: { top: 10, left, bottom: 12 },
      tableWidth: 70,
      theme: "grid",
      pageBreak: "avoid",
      styles: { fontSize: 9, halign: "center", lineWidth: 0.3, lineColor: [0, 0, 0], textColor: [0, 0, 0], cellPadding: 1.5 },
      headStyles: { fillColor: [255, 255, 0], textColor: [0, 0, 0], fontStyle: "bold" },
      didParseCell: (data) => {
        if (data.section === "body" && data.row.index === summary.items.length) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [255, 255, 0];
        }
      },
    });
  }

  return doc;
}

// ---------------------------------------------------------------------------
// XLSX writer
// ---------------------------------------------------------------------------

const S = {
  title: 1,
  subtitle: 2,
  header: 3,
  text: 4,
  money: 5,
  textTop: 6,
  moneyTop: 7,
  totalLabel: 8,
  totalMoney: 9,
  sumHeader: 10,
  sumCell: 11,
  sumTotal: 12,
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;₹&quot;#,##0"/></numFmts>
<fonts count="6">
<font><sz val="10"/><name val="Arial"/><family val="2"/></font>
<font><b/><u/><sz val="16"/><color rgb="FFFF0000"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="13"/><color rgb="FF808080"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="10"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF4361EE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>
<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="medium"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="13">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="4" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function escapeXml(v) {
  return String(v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colLetter(i) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Returns a Blob containing an .xlsx workbook for the report. */
export function buildBillingXlsx(report, { title, subtitle, sheetName = "Billing" }) {
  const { cols, dateIdx, rows, totals, summary } = report;
  const lastCol = colLetter(cols.length - 1);
  const strings = [];
  const stringIdx = new Map();
  const sst = (v) => {
    const key = String(v);
    if (!stringIdx.has(key)) {
      stringIdx.set(key, strings.length);
      strings.push(key);
    }
    return stringIdx.get(key);
  };
  const cell = (r, c, value, style) => {
    const ref = `${colLetter(c)}${r}`;
    if (value === null || value === undefined || value === "") return `<c r="${ref}" s="${style}"/>`;
    if (typeof value === "number") return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
    return `<c r="${ref}" s="${style}" t="s"><v>${sst(value)}</v></c>`;
  };

  // Fixed row heights (roomy like the reference), grown for text that wraps.
  const rowHeight = (cells) => {
    const lines = cells.reduce((max, v, ci) => {
      if (typeof v !== "string") return max;
      const width = COLUMN_WIDTHS[cols[ci].key] || 14;
      return Math.max(max, Math.ceil(v.length / (width * 1.1)));
    }, 1);
    return Math.max(18, lines * 13 + 5);
  };

  const sheetRows = [];
  const merges = [`A1:${lastCol}1`, `A2:${lastCol}2`];
  sheetRows.push(`<row r="1" ht="24" customHeight="1">${cell(1, 0, title, S.title)}</row>`);
  sheetRows.push(`<row r="2" ht="20" customHeight="1">${cell(2, 0, subtitle, S.subtitle)}</row>`);
  sheetRows.push(
    `<row r="3" ht="30" customHeight="1">${cols.map((c, i) => cell(3, i, c.label, S.header)).join("")}</row>`
  );

  // Heights (pt) of each date group and of the summary block, used for page breaks.
  const groupBlocks = [];
  let summaryBlock = null;

  let r = 4;
  rows.forEach((row) => {
    const ht = rowHeight(row.cells);
    if (row.groupStart) groupBlocks.push({ start: r, height: 0 });
    groupBlocks[groupBlocks.length - 1].height += ht;
    // Medium top border marks the start of every date group after the first.
    const top = row.groupStart && r > 4;
    const xml = row.cells
      .map((v, ci) => {
        const isMoney = cols[ci].currency && typeof v === "number";
        const style = isMoney ? (top ? S.moneyTop : S.money) : top ? S.textTop : S.text;
        return cell(r, ci, v, style);
      })
      .join("");
    if (dateIdx >= 0 && row.groupStart && row.span > 1) {
      merges.push(`${colLetter(dateIdx)}${r}:${colLetter(dateIdx)}${r + row.span - 1}`);
    }
    sheetRows.push(`<row r="${r}" ht="${ht}" customHeight="1">${xml}</row>`);
    r++;
  });

  if (totals) {
    const parts = [];
    if (totals.labelIdx >= 0) parts.push(cell(r, totals.labelIdx, "Total", S.totalLabel));
    Object.keys(totals.values)
      .map(Number)
      .forEach((ci) => parts.push(cell(r, ci, totals.values[ci], S.totalMoney)));
    sheetRows.push(`<row r="${r}" ht="18" customHeight="1">${parts.join("")}</row>`);
    // Keep the Total row on the same page as the last date group.
    if (groupBlocks.length > 0) groupBlocks[groupBlocks.length - 1].height += 18;
    r++;
  }

  if (summary && summary.items.length > 0) {
    summaryBlock = { start: r, height: 15 + (summary.items.length + 2) * 18 };
    r++; // blank spacer row
    const c0 = summary.colIdx;
    const sumRow = (a, b, sa, sb) => {
      sheetRows.push(`<row r="${r}" ht="18" customHeight="1">${cell(r, c0, a, sa)}${cell(r, c0 + 1, b, sb)}</row>`);
      r++;
    };
    sumRow("LOCATION", "AMOUNT", S.sumHeader, S.sumHeader);
    summary.items.forEach((it) => sumRow(it.location, it.amount, S.sumCell, S.sumCell));
    sumRow("TOTAL", summary.total, S.sumTotal, S.sumTotal);
  }

  const breaks = pageBreaks(cols, groupBlocks, summaryBlock);
  const breaksXml = breaks.length
    ? `<rowBreaks count="${breaks.length}" manualBreakCount="${breaks.length}">${breaks
        .map((id) => `<brk id="${id}" max="16383" man="1"/>`)
        .join("")}</rowBreaks>`
    : "";

  const colsXml = cols
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${COLUMN_WIDTHS[c.key] || 14}" customWidth="1"/>`)
    .join("");

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${lastCol}${Math.max(r - 1, 3)}"/>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${colsXml}</cols>
<sheetData>${sheetRows.join("")}</sheetData>
<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>
<printOptions horizontalCentered="1"/>
<pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
${breaksXml}
</worksheet>`;

  const sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings
    .map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`)
    .join("")}</sst>`;

  const safeSheet = escapeXml(sheetName.replace(/[\\/?*[\]:']/g, "").slice(0, 31) || "Sheet1");
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${safeSheet}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">'${safeSheet}'!$3:$3</definedName></definedNames>
</workbook>`;

  const files = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    ],
    ["xl/workbook.xml", workbookXml],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`,
    ],
    ["xl/worksheets/sheet1.xml", sheetXml],
    ["xl/styles.xml", STYLES_XML],
    ["xl/sharedStrings.xml", sstXml],
  ];

  return new Blob(zipStore(files), {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/**
 * Manual page breaks (row numbers to break after) so Excel and online
 * converters never split a date group or the location summary across pages.
 * Page capacity is estimated for A4 landscape with fit-to-width scaling. The
 * estimate is deliberately low (Excel and online converters were measured to
 * fit ~15-30% more), so tools only leave some spare space at a page's bottom
 * instead of adding their own break inside a group.
 */
function pageBreaks(cols, groupBlocks, summaryBlock) {
  const widthPt = cols.reduce((s, c) => s + ((COLUMN_WIDTHS[c.key] || 14) * 7 + 5) * 0.75, 0);
  const scale = Math.min(1, ((11.69 - 0.5) * 72) / widthPt);
  const capacity = (((8.27 - 0.8) * 72) / scale) * 1.05;
  const TITLE_AND_HEADER = 24 + 20 + 30;
  const HEADER = 30; // header row repeats on every page (print titles)

  const breaks = [];
  let pageStart = 0; // index of the first group on the current page
  let used = TITLE_AND_HEADER;
  groupBlocks.forEach((g, i) => {
    if (i > pageStart && used + g.height > capacity) {
      breaks.push(g.start - 1);
      pageStart = i;
      used = HEADER;
    }
    used += g.height;
  });

  if (summaryBlock && used + summaryBlock.height > capacity) {
    const last = groupBlocks[groupBlocks.length - 1];
    if (last && groupBlocks.length - 1 > pageStart && HEADER + last.height + summaryBlock.height <= capacity) {
      // Carry the last date group over with the summary so the new page isn't only the summary.
      breaks.push(last.start - 1);
    } else {
      breaks.push(summaryBlock.start);
    }
  }
  return breaks;
}

// ---------------------------------------------------------------------------
// Minimal ZIP (stored, no compression) — used for the .xlsx package and the
// bulk invoice download (PDFs are already compressed, so storing loses nothing).
// ---------------------------------------------------------------------------

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// files: [name, string | Uint8Array][]. Returns the archive as Blob parts.
function zipStore(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const locals = [];
  const centrals = [];
  let offset = 0;
  files.forEach(([name, content]) => {
    const nameBytes = enc.encode(name);
    const data = typeof content === "string" ? enc.encode(content) : content;
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), nameBytes, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, dosTime, true);
    central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  });

  const centralSize = centrals.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return [...locals, ...centrals, new Uint8Array(end.buffer)];
}

/** Returns a .zip Blob of [fileName, Uint8Array] entries. */
export function buildZipBlob(files) {
  return new Blob(zipStore(files), { type: "application/zip" });
}
