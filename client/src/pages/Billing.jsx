import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import JsBarcode from "jsbarcode";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";
import { getBillings, createBilling, updateBilling, deleteBilling } from "../services/api";
import defaultStamp from "../defaultStamp";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function extractLocation(routeStr) {
  if (!routeStr) return null;
  const route = routeStr.replace(/\(.*\)/, "").trim().toUpperCase();
  const parts = route.split("-");
  if (parts.length !== 2) return null;
  const [from, to] = parts;
  if (from === "BOM") return to;
  if (to === "BOM") return from;
  return route;
}

const emptyForm = {
  invoice_no: "",
  date: "",
  location: "",
  location_route: "",
  location_client: "",
  weight: "",
  total_amount: "",
  bom_expense: "",
  bom_exp_description: "",
  other_expense: "",
  other_exp_description: "",
  // Extra Charges (same structure as InvoiceCreate)
  show_packaging: false,
  box_rate: "150",
  boxes: "1",
  show_oda: false,
  oda_location: "Bhosri",
  oda_person: "Ankit P",
  oda_amount: "600",
  show_pickup: false,
  pickup_rate: "600",
  pickup_entries: [],
  pickup_new_name: "",
  show_other: false,
  other_desc: "",
  other_amount: "",
  showExtrasDropdown: false,
  payment_status: "NOTPAID",
};

const defaultLocations = ["BOM-PUNE", "PUNE-BOM", "BOM-GOA", "GOA-BOM", "IDR-BOM", "BOM-IDR"];

// Extract extra charges as [{description, amount}] from a billing record
function getExtraChargeItems(b) {
  const items = [];
  const bxs = Number(b.boxes) || 1;
  const bxRate = Number(b.box_rate) || 150;
  if (b.show_packaging) items.push({ description: `Box & Pkging (${bxs}-Box)`, amount: bxs * bxRate });
  if (b.show_oda) items.push({ description: `${b.oda_person || ""} (ODA-Pickup)`, amount: Number(b.oda_amount) || 0 });
  if (b.show_pickup && b.pickup_entries) {
    const pRate = Number(b.pickup_rate) || 600;
    b.pickup_entries.forEach((name) => items.push({ description: `Pickup (${name})`, amount: pRate }));
  }
  if (b.show_other && b.other_desc) items.push({ description: b.other_desc, amount: Number(b.other_amount) || 0 });
  // Support legacy extra_charges_list format
  if (b.extra_charges_list) b.extra_charges_list.forEach((ec) => {
    if (Number(ec.amount) > 0) items.push({ description: ec.description || "Other", amount: Number(ec.amount) });
  });
  return items;
}

const sampleBillings = [
  { invoice_no: "1666", date: "2026-03-15", location: "BOM-GOA", weight: 10, total_amount: 500, bom_expense: 100, bom_exp_description: "ytest", other_expense: 200, other_exp_description: "test", payment_status: "PAID" },
  { invoice_no: "1667", date: "2026-01-10", location: "BOM-PUNE", weight: 25, total_amount: 105000, bom_expense: 8000, bom_exp_description: "Transport fuel", other_expense: 3500, other_exp_description: "Loading charges", payment_status: "PAID" },
  { invoice_no: "1668", date: "2026-01-22", location: "PUNE-BOM", weight: 18, total_amount: 78000, bom_expense: 6500, bom_exp_description: "Diesel", other_expense: 2000, other_exp_description: "Toll charges", payment_status: "PAID" },
  { invoice_no: "1669", date: "2026-02-05", location: "BOM-PUNE", weight: 30, total_amount: 125000, bom_expense: 9500, bom_exp_description: "Fuel + driver", other_expense: 4000, other_exp_description: "Packaging", payment_status: "PAID" },
  { invoice_no: "1670", date: "2026-02-18", location: "PUNE-BOM", weight: 22, total_amount: 95000, bom_expense: 7200, bom_exp_description: "Transport", other_expense: 3000, other_exp_description: "Handling", payment_status: "NOTPAID" },
  { invoice_no: "1671", date: "2026-03-08", location: "BOM-PUNE", weight: 15, total_amount: 68000, bom_expense: 5500, bom_exp_description: "Fuel charges", other_expense: 2500, other_exp_description: "Labour", payment_status: "PAID" },
  { invoice_no: "1672", date: "2026-03-25", location: "PUNE-BOM", weight: 28, total_amount: 132000, bom_expense: 10000, bom_exp_description: "Diesel + toll", other_expense: 5000, other_exp_description: "Warehouse", payment_status: "NOTPAID" },
  { invoice_no: "1673", date: "2026-04-02", location: "BOM-PUNE", weight: 20, total_amount: 89000, bom_expense: 7000, bom_exp_description: "Transport fuel", other_expense: 3200, other_exp_description: "Loading", payment_status: "PAID" },
  { invoice_no: "1674", date: "2026-01-15", location: "BOM-GOA", weight: 12, total_amount: 55000, bom_expense: 4500, bom_exp_description: "Fuel", other_expense: 2000, other_exp_description: "Toll", payment_status: "PAID" },
  { invoice_no: "1675", date: "2026-02-12", location: "GOA-BOM", weight: 8, total_amount: 42000, bom_expense: 3800, bom_exp_description: "Diesel", other_expense: 1500, other_exp_description: "Loading", payment_status: "PAID" },
  { invoice_no: "1676", date: "2026-03-20", location: "BOM-GOA", weight: 16, total_amount: 72000, bom_expense: 6000, bom_exp_description: "Transport", other_expense: 2800, other_exp_description: "Packaging", payment_status: "NOTPAID" },
  { invoice_no: "1677", date: "2026-04-01", location: "GOA-BOM", weight: 14, total_amount: 63000, bom_expense: 5200, bom_exp_description: "Fuel + toll", other_expense: 2200, other_exp_description: "Handling", payment_status: "PAID" },
  { invoice_no: "1678", date: "2026-01-08", location: "IDR-BOM", weight: 35, total_amount: 145000, bom_expense: 11000, bom_exp_description: "Long route fuel", other_expense: 5500, other_exp_description: "Loading + toll", payment_status: "PAID" },
  { invoice_no: "1679", date: "2026-02-20", location: "BOM-IDR", weight: 40, total_amount: 168000, bom_expense: 12500, bom_exp_description: "Diesel + driver", other_expense: 6000, other_exp_description: "Warehouse + handling", payment_status: "NOTPAID" },
  { invoice_no: "1680", date: "2026-03-12", location: "IDR-BOM", weight: 30, total_amount: 130000, bom_expense: 10500, bom_exp_description: "Transport fuel", other_expense: 4800, other_exp_description: "Labour charges", payment_status: "PAID" },
  { invoice_no: "1681", date: "2026-04-01", location: "BOM-IDR", weight: 38, total_amount: 155000, bom_expense: 12000, bom_exp_description: "Fuel + toll", other_expense: 5500, other_exp_description: "Packaging", payment_status: "PAID" },
  { invoice_no: "1682", date: "2026-05-10", location: "BOM-PUNE", weight: 24, total_amount: 98000, bom_expense: 7800, bom_exp_description: "Transport", other_expense: 3500, other_exp_description: "Loading", payment_status: "NOTPAID" },
  { invoice_no: "1683", date: "2026-06-15", location: "BOM-GOA", weight: 19, total_amount: 82000, bom_expense: 6800, bom_exp_description: "Diesel", other_expense: 3000, other_exp_description: "Toll + handling", payment_status: "PAID" },
  { invoice_no: "1684", date: "2026-07-20", location: "IDR-BOM", weight: 33, total_amount: 140000, bom_expense: 11500, bom_exp_description: "Long haul fuel", other_expense: 5200, other_exp_description: "Warehouse", payment_status: "PAID" },
  { invoice_no: "1685", date: "2026-08-05", location: "PUNE-BOM", weight: 27, total_amount: 115000, bom_expense: 9000, bom_exp_description: "Fuel charges", other_expense: 4000, other_exp_description: "Labour", payment_status: "NOTPAID" },
  { invoice_no: "1686", date: "2026-09-18", location: "GOA-BOM", weight: 11, total_amount: 48000, bom_expense: 4000, bom_exp_description: "Transport", other_expense: 1800, other_exp_description: "Packaging", payment_status: "PAID" },
  { invoice_no: "1687", date: "2026-10-22", location: "BOM-IDR", weight: 42, total_amount: 175000, bom_expense: 13000, bom_exp_description: "Diesel + driver", other_expense: 6500, other_exp_description: "Loading + toll", payment_status: "PAID" },
  { invoice_no: "1688", date: "2026-11-10", location: "BOM-PUNE", weight: 21, total_amount: 92000, bom_expense: 7500, bom_exp_description: "Fuel", other_expense: 3300, other_exp_description: "Handling", payment_status: "NOTPAID" },
  { invoice_no: "1689", date: "2026-12-05", location: "BOM-GOA", weight: 17, total_amount: 76000, bom_expense: 6200, bom_exp_description: "Transport fuel", other_expense: 2700, other_exp_description: "Toll charges", payment_status: "PAID" },
];

function seedSampleData() {
  const existing = JSON.parse(localStorage.getItem("invoices") || "[]");
  const existingNos = new Set(existing.map((b) => b.invoice_no));
  const toAdd = sampleBillings.filter((b) => !existingNos.has(b.invoice_no));
  if (toAdd.length > 0) {
    localStorage.setItem("invoices", JSON.stringify([...existing, ...toAdd]));
    return true;
  }
  return false;
}

export default function Billing() {
  const navigate = useNavigate();
  const [billings, setBillings] = useState(() => {
    return JSON.parse(localStorage.getItem("invoices") || "[]");
  });
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [locations, setLocations] = useState(() => {
    const saved = localStorage.getItem("billing_locations");
    return saved ? JSON.parse(saved) : [...defaultLocations];
  });
  const [newLocation, setNewLocation] = useState("");
  const [pickupRoster, setPickupRoster] = useState(() => {
    const saved = localStorage.getItem("pickup_roster");
    return saved ? JSON.parse(saved) : ["Ankit Yadav", "Dhiraj Maske", "Tirath Mali"];
  });
  const [filterMonth, setFilterMonth] = useState("");
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());
  const [filterLocation, setFilterLocation] = useState("");
  const [showExportPanel, setShowExportPanel] = useState(false);

  const ALL_COLUMNS = [
    { key: "invoice_no", label: "Invoice No.", numeric: false },
    { key: "date", label: "Date", numeric: false },
    { key: "location", label: "Location", numeric: false },
    { key: "weight", label: "Weight", numeric: true },
    { key: "total_amount", label: "Total Amount", numeric: true, currency: true },
    { key: "bom_expense", label: "BOM Expense", numeric: true, currency: true },
    { key: "bom_exp_description", label: "BOM Exp Description", numeric: false },
    { key: "other_expense", label: "Other Exp", numeric: true, currency: true },
    { key: "other_exp_description", label: "Other Exp Description", numeric: false },
    { key: "extra_charges_total", label: "Extra Charges", numeric: true, currency: true },
    { key: "extra_charges_desc", label: "Extra Charges Description", numeric: false },
    { key: "payment_status", label: "PAID / NOTPAID", numeric: false },
  ];

  const [exportColumns, setExportColumns] = useState(() =>
    ALL_COLUMNS.reduce((acc, col) => ({ ...acc, [col.key]: true }), {})
  );

  // Derived filter data
  const availableYears = useMemo(() => {
    const yrs = new Set();
    billings.forEach((b) => { if (b.date) yrs.add(new Date(b.date).getFullYear()); });
    return Array.from(yrs).sort((a, b) => b - a);
  }, [billings]);

  const availableLocations = useMemo(() => {
    const locs = new Set();
    billings.forEach((b) => { const loc = extractLocation(b.location); if (loc) locs.add(loc); });
    return Array.from(locs).sort();
  }, [billings]);

  const filteredBillings = useMemo(() => {
    return billings.filter((b) => {
      if (!b.date) return !filterMonth && !filterYear;
      const d = new Date(b.date);
      if (filterYear && d.getFullYear() !== parseInt(filterYear)) return false;
      if (filterMonth && (d.getMonth() + 1) !== parseInt(filterMonth)) return false;
      if (filterLocation && extractLocation(b.location) !== filterLocation) return false;
      return true;
    });
  }, [billings, filterMonth, filterYear, filterLocation]);

  const filterTotals = useMemo(() => {
    return filteredBillings.reduce(
      (acc, b) => ({
        total: acc.total + parseFloat(b.total_amount || 0),
        bom: acc.bom + parseFloat(b.bom_expense || 0),
        other: acc.other + parseFloat(b.other_expense || 0),
        extra: acc.extra + getExtraChargeItems(b).reduce((s, ec) => s + ec.amount, 0),
      }),
      { total: 0, bom: 0, other: 0, extra: 0 }
    );
  }, [filteredBillings]);

  const selectedCols = ALL_COLUMNS.filter((c) => exportColumns[c.key]);

  const getFilterLabel = () => {
    let label = "Billing Data";
    if (filterLocation) label += ` - ${filterLocation}`;
    if (filterMonth && filterYear) {
      label += ` (${MONTH_FULL[filterMonth - 1]}-${filterYear})`;
    } else if (filterMonth) {
      label += ` (${MONTH_FULL[filterMonth - 1]})`;
    } else if (filterYear) {
      label += ` (${filterYear})`;
    }
    return label;
  };

  const getCellValue = (b, col) => {
    if (col.key === "date") return b.date ? new Date(b.date).toLocaleDateString() : "-";
    if (col.key === "extra_charges_total") {
      return getExtraChargeItems(b).reduce((s, ec) => s + ec.amount, 0);
    }
    if (col.key === "extra_charges_desc") {
      const items = getExtraChargeItems(b);
      return items.length > 0 ? items.map((ec) => ec.description).join(", ") : "-";
    }
    if (col.currency) return b[col.key] != null ? Number(b[col.key]) : 0;
    return b[col.key] || "-";
  };

  // Sort billings by date and group them
  const getGroupedBillings = () => {
    const sorted = [...filteredBillings].sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return da - db;
    });
    const groups = [];
    let currentDate = null;
    let currentGroup = null;
    sorted.forEach((b) => {
      const dateStr = b.date ? new Date(b.date).toLocaleDateString() : "No Date";
      if (dateStr !== currentDate) {
        currentDate = dateStr;
        currentGroup = { date: dateStr, items: [] };
        groups.push(currentGroup);
      }
      currentGroup.items.push(b);
    });
    return { sorted, groups };
  };

  const exportToPDF = () => {
    const cols = selectedCols;
    if (cols.length === 0) return alert("Please select at least one column to export.");
    const doc = new jsPDF({ orientation: "landscape" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const numericCols = cols.filter((c) => c.numeric);
    const filterLabel = getFilterLabel();
    const genDate = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

    // --- Header ---
    doc.setFillColor(26, 26, 46);
    doc.rect(0, 0, pageWidth, 28, "F");
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text("SWATI TOURS & TRANSPORT", margin, 13);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(200, 200, 220);
    doc.text(filterLabel, margin, 22);
    doc.text(genDate + "  |  Records: " + filteredBillings.length, pageWidth - margin, 22, { align: "right" });

    // --- Table ---
    const { groups } = getGroupedBillings();
    const head = [cols.map((c) => c.label)];
    const body = [];
    const groupStartRows = new Set();

    groups.forEach((group) => {
      groupStartRows.add(body.length);
      group.items.forEach((b) => {
        body.push(cols.map((c) => {
          const val = getCellValue(b, c);
          if (c.currency && typeof val === "number") return "Rs. " + val.toLocaleString("en-IN");
          return String(val);
        }));
      });
    });

    const grandTotalIdx = body.length;
    if (numericCols.length > 0) {
      const totalsRow = cols.map((c) => {
        if (c.numeric) {
          const sum = filteredBillings.reduce((s, b) => s + (Number(b[c.key]) || 0), 0);
          if (c.currency) return "Rs. " + sum.toLocaleString("en-IN");
          return sum.toLocaleString("en-IN");
        }
        return "";
      });
      totalsRow[0] = totalsRow[0] || "TOTAL";
      body.push(totalsRow);
    }

    autoTable(doc, {
      head,
      body,
      startY: 32,
      margin: { left: margin, right: margin },
      tableWidth: "auto",
      styles: {
        fontSize: 8.5,
        cellPadding: { top: 3.5, right: 5, bottom: 3.5, left: 5 },
        lineWidth: 0.4,
        lineColor: [50, 50, 50],
        textColor: [30, 30, 30],
        font: "helvetica",
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [67, 97, 238],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8.5,
        cellPadding: { top: 4, right: 5, bottom: 4, left: 5 },
        halign: "center",
        lineWidth: 0.4,
        lineColor: [50, 50, 50],
      },
      columnStyles: cols.reduce((acc, c, i) => {
        if (c.numeric) acc[i] = { halign: "right" };
        return acc;
      }, {}),
      alternateRowStyles: { fillColor: [245, 246, 250] },
      didDrawCell: (data) => {
        if (data.section !== "body") return;
        if (groupStartRows.has(data.row.index) && data.row.index > 0) {
          doc.setDrawColor(0, 0, 0);
          doc.setLineWidth(1.5);
          doc.line(data.cell.x, data.cell.y, data.cell.x + data.cell.width, data.cell.y);
        }
      },
      didParseCell: (data) => {
        if (data.section !== "body") return;
        if (data.row.index === grandTotalIdx) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [26, 26, 46];
          data.cell.styles.textColor = [255, 255, 255];
          data.cell.styles.fontSize = 9;
        }
      },
      didDrawPage: () => {
        // Footer
        doc.setFillColor(26, 26, 46);
        doc.rect(0, pageHeight - 10, pageWidth, 10, "F");
        doc.setFontSize(7.5);
        doc.setTextColor(180, 180, 200);
        doc.text("Swati Tours & Transport", margin, pageHeight - 4);
        const pg = `Page ${doc.getCurrentPageInfo().pageNumber} of ${doc.getNumberOfPages()}`;
        doc.text(pg, pageWidth - margin, pageHeight - 4, { align: "right" });
      },
    });

    doc.save(`${filterLabel.replace(/ /g, "_")}.pdf`);
  };

  const exportToExcel = () => {
    const cols = selectedCols;
    if (cols.length === 0) return alert("Please select at least one column to export.");
    const numericCols = cols.filter((c) => c.numeric);
    const { groups } = getGroupedBillings();

    const cellStyle = "border: 1px solid #000; padding: 6px 10px; font-size: 13px;";
    const headerStyle = `${cellStyle} background: #4361ee; color: #fff; font-weight: bold; text-align: center;`;
    const grandTotalStyle = `${cellStyle} background: #f0f0f0; font-weight: bold;`;

    let tableHTML = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8">
<style>td, th { mso-number-format:"\\@"; }</style>
</head><body>
<h2 style="font-family:Arial;">Swati Tours &amp; Transport</h2>
<p style="font-family:Arial; color:#666;">${getFilterLabel()}</p>
<table style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif;">
<thead><tr>${cols.map((c) => `<th style="${headerStyle}">${c.label}</th>`).join("")}</tr></thead><tbody>`;

    groups.forEach((group, gi) => {
      group.items.forEach((b, bi) => {
        // First row of a new date group gets a thick top border
        const topBorder = gi > 0 && bi === 0 ? "border-top: 3px solid #000;" : "";
        tableHTML += "<tr>";
        cols.forEach((c) => {
          const val = getCellValue(b, c);
          const display = c.currency && typeof val === "number" ? `₹${val.toLocaleString("en-IN")}` : String(val);
          const align = c.numeric ? "text-align: right;" : "";
          tableHTML += `<td style="${cellStyle} ${topBorder} ${align}">${display}</td>`;
        });
        tableHTML += "</tr>";
      });
    });

    // Grand total row
    if (numericCols.length > 0) {
      tableHTML += "<tr>";
      cols.forEach((c, ci) => {
        if (c.numeric) {
          const sum = filteredBillings.reduce((s, b) => s + (Number(b[c.key]) || 0), 0);
          const display = c.currency ? `₹${sum.toLocaleString("en-IN")}` : sum.toLocaleString("en-IN");
          tableHTML += `<td style="${grandTotalStyle} text-align: right;">${display}</td>`;
        } else if (ci === 0) {
          tableHTML += `<td style="${grandTotalStyle}">TOTAL</td>`;
        } else {
          tableHTML += `<td style="${grandTotalStyle}"></td>`;
        }
      });
      tableHTML += "</tr>";
    }

    tableHTML += "</tbody></table></body></html>";

    const blob = new Blob([tableHTML], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${getFilterLabel().replace(/ /g, "_")}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addLocation = () => {
    const val = newLocation.trim().toUpperCase();
    if (val && !locations.includes(val)) {
      const updated = [...locations, val];
      setLocations(updated);
      localStorage.setItem("billing_locations", JSON.stringify(updated));
      setForm({ ...form, location: val });
      setNewLocation("");
    }
  };

  const loadData = () => {
    const localInvoices = JSON.parse(localStorage.getItem("invoices") || "[]");
    getBillings().then((res) => {
      // Merge: API data + local invoices (avoid duplicates by invoice_no)
      const apiData = res.data || [];
      const apiNos = new Set(apiData.map((d) => d.invoice_no));
      const merged = [...apiData, ...localInvoices.filter((l) => !apiNos.has(l.invoice_no))];
      setBillings(merged);
    }).catch(() => {
      setBillings(localInvoices);
    });
  };

  useEffect(() => {
    seedSampleData();
    loadData();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const location = form.location_route
      ? form.location_route + (form.location_client ? `(${form.location_client})` : "")
      : form.location;
    const submitData = { ...form, location };
    delete submitData.location_route;
    delete submitData.location_client;

    if (editing) {
      // If record has a numeric DB id, try API update; otherwise update localStorage
      if (typeof editing.id === "number" && editing.id > 0) {
        try {
          await updateBilling(editing.id, submitData);
        } catch (e) {
          // API failed, fall back to localStorage update
          const local = JSON.parse(localStorage.getItem("invoices") || "[]");
          const idx = local.findIndex((l) => l.invoice_no === editing.invoice_no);
          if (idx !== -1) { local[idx] = { ...local[idx], ...submitData }; }
          localStorage.setItem("invoices", JSON.stringify(local));
        }
      } else {
        // Local-only record, update in localStorage
        const local = JSON.parse(localStorage.getItem("invoices") || "[]");
        const idx = local.findIndex((l) => l.invoice_no === editing.invoice_no);
        if (idx !== -1) { local[idx] = { ...local[idx], ...submitData }; }
        localStorage.setItem("invoices", JSON.stringify(local));
      }
    } else {
      // New record: try API, fall back to localStorage
      try {
        await createBilling(submitData);
      } catch (e) {
        const local = JSON.parse(localStorage.getItem("invoices") || "[]");
        local.push(submitData);
        localStorage.setItem("invoices", JSON.stringify(local));
      }
    }

    setShowModal(false);
    setEditing(null);
    setForm({ ...emptyForm });
    loadData();
  };

  const parseLocation = (loc) => {
    if (!loc) return { route: "", client: "" };
    const match = loc.match(/^([A-Z]+-[A-Z]+)\((.+)\)$/);
    if (match) return { route: match[1], client: match[2] };
    if (locations.includes(loc)) return { route: loc, client: "" };
    return { route: "", client: "" };
  };

  const handleEdit = (b) => {
    setEditing(b);
    const parsed = parseLocation(b.location);
    setForm({
      invoice_no: b.invoice_no,
      date: b.date ? b.date.split("T")[0] : "",
      location: b.location || "",
      location_route: parsed.route,
      location_client: parsed.client,
      weight: b.weight || "",
      total_amount: b.total_amount || "",
      bom_expense: b.bom_expense || "",
      bom_exp_description: b.bom_exp_description || "",
      other_expense: b.other_expense || "",
      other_exp_description: b.other_exp_description || "",
      show_packaging: b.show_packaging || false,
      box_rate: b.box_rate || "150",
      boxes: b.boxes || "1",
      show_oda: b.show_oda || false,
      oda_location: b.oda_location || "Bhosri",
      oda_person: b.oda_person || "Ankit P",
      oda_amount: b.oda_amount || "600",
      show_pickup: b.show_pickup || false,
      pickup_rate: b.pickup_rate || "600",
      pickup_entries: b.pickup_entries || [],
      pickup_new_name: "",
      show_other: b.show_other || false,
      other_desc: b.other_desc || "",
      other_amount: b.other_amount || "",
      showExtrasDropdown: false,
      payment_status: b.payment_status || "NOTPAID",
    });
    setShowModal(true);
  };

  const handleDelete = async (id, invoice_no) => {
    if (window.confirm("Delete this billing record?")) {
      // Remove from localStorage
      const local = JSON.parse(localStorage.getItem("invoices") || "[]");
      const filtered = local.filter((l) => l.invoice_no !== invoice_no);
      localStorage.setItem("invoices", JSON.stringify(filtered));
      // Remove from API if it has a numeric id
      if (typeof id === "number" && id > 0) {
        try { await deleteBilling(id); } catch (e) { /* ignore */ }
      }
      loadData();
    }
  };

  const numberToWords = (num) => {
    if (num === 0) return "Zero";
    const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
      "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    const n = Math.floor(num);
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    if (n < 1000) return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + numberToWords(n % 100) : "");
    if (n < 100000) return numberToWords(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + numberToWords(n % 1000) : "");
    if (n < 10000000) return numberToWords(Math.floor(n / 100000)) + " Lakh" + (n % 100000 ? " " + numberToWords(n % 100000) : "");
    return numberToWords(Math.floor(n / 10000000)) + " Crore" + (n % 10000000 ? " " + numberToWords(n % 10000000) : "");
  };

  const generateInvoice = async (b) => {
    const parsed = parseLocation(b.location);
    const route = parsed.route || b.location || "";
    const clientName = parsed.client || "";
    const routeDisplay = route.replace("-", " to ");
    const dateObj = b.date ? new Date(b.date) : new Date();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dateStr = dateObj.getDate().toString().padStart(2, "0") + "-" + months[dateObj.getMonth()] + "-" + String(dateObj.getFullYear()).slice(-2);
    const totalAmt = Number(b.total_amount) || 0;
    const weight = Number(b.weight) || 0;
    const boxes = 1;
    const boxRate = 150;
    const packagingAmt = boxes * boxRate;
    const weightAmt = totalAmt - packagingAmt > 0 ? totalAmt - packagingAmt : totalAmt;
    const ratePerKg = weight > 0 ? (weightAmt / weight) : 0;
    const grandTotal = weightAmt + packagingAmt;
    const amtWords = numberToWords(Math.floor(grandTotal)) + " Rupees Only";

    const shipperName = clientName || "";

    // Generate barcode as data URL
    let barcodeDataUrl = "";
    try {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, b.invoice_no, { format: "CODE128", width: 1.8, height: 40, displayValue: false, margin: 2, background: "transparent" });
      barcodeDataUrl = canvas.toDataURL("image/png");
    } catch (e) { /* ignore */ }

    // Get stamp from localStorage
    const stampBase64 = localStorage.getItem("stamp_image") || defaultStamp;

    const invoiceHTML = `<!DOCTYPE html>
<html>
<head>
<title>Invoice ${b.invoice_no}</title>
<style>
  @media print { body { margin: 0; } .no-print { display: none !important; } .inv-page { box-shadow: none !important; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', Courier, monospace; font-size: 13px; color: #000; background: #f5f5f5; }
  .inv-page { width: 800px; margin: 20px auto; background: #fff; border: 2px solid #222; box-shadow: 0 2px 20px rgba(0,0,0,0.12); }
  .inv-head { text-align: center; padding: 14px 20px 10px; border-bottom: 3px double #222; background: linear-gradient(180deg, #fafafa 0%, #fff 100%); }
  .inv-head h1 { font-size: 20px; font-weight: bold; letter-spacing: 3px; color: #b71c1c; margin: 0 0 4px; }
  .inv-head .addr { font-size: 11px; line-height: 1.5; margin: 0; color: #333; }
  .inv-head .pan { font-size: 11.5px; font-weight: bold; margin-top: 3px; color: #222; }
  .it { width: 100%; border-collapse: collapse; }
  .it td { border: 1px solid #333; padding: 6px 10px; vertical-align: top; font-size: 13px; background: transparent; }
  .it { position: relative; z-index: 1; }
  .lbl { font-weight: bold; font-size: 12px; background: #f5f5f5; color: #222; letter-spacing: 0.5px; }
  .print-btn { display: block; width: 200px; margin: 20px auto; padding: 12px; background: #4361ee; color: #fff; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; font-family: Arial, sans-serif; }
  .print-btn:hover { background: #3a56d4; }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">Print Invoice</button>
<div class="inv-page" style="position:relative;">
  <div style="position:absolute; top:0; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; pointer-events:none; z-index:0;">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="500" height="500" style="opacity:0.18;">
      <defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#f7850a"/><stop offset="100%" stop-color="#e06800"/></linearGradient><linearGradient id="blue" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4355db"/><stop offset="100%" stop-color="#2d3cb8"/></linearGradient><linearGradient id="brown" x1="100%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#9b3e1c"/><stop offset="100%" stop-color="#6d2b12"/></linearGradient></defs>
      <rect width="200" height="200" rx="40" fill="url(#bg)"/>
      <circle cx="72" cy="100" r="60" fill="none" stroke="url(#blue)" stroke-width="13" stroke-dasharray="310 68" stroke-dashoffset="-34" stroke-linecap="round"/>
      <circle cx="72" cy="100" r="46" fill="none" stroke="url(#brown)" stroke-width="9" stroke-dasharray="230 60" stroke-dashoffset="80" stroke-linecap="round"/>
      <text x="105" y="120" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="52" font-weight="900" font-style="italic" fill="#ffffff" letter-spacing="2">STT</text>
    </svg>
  </div>
  <div class="inv-head">
    <h1>SWATI TOURS &amp; TRANSPORT</h1>
    <p class="addr">ROOM NO 4, RAM NAGIN TIWARI BHUVAN ASALFA VILLAGE, NEAR SHRI RAM APTGHATKOPAR WEST MUMBAI 400084</p>
    <p class="pan">UAM MH19D0152647 / PAN BSNPP7564G</p>
  </div>
  <table class="it">
    <colgroup><col style="width:32%"/><col style="width:33%"/><col style="width:15%"/><col style="width:20%"/></colgroup>
    <tbody>
      <tr><td class="lbl">Consignor's</td><td class="lbl">CONSIGNEE</td><td class="lbl" style="text-align:center;">INVOICE No</td><td class="lbl" style="text-align:center;">Dated</td></tr>
      <tr>
        <td style="padding:10px; line-height:1.7;">
          <strong style="font-size:13px;">SWATI TOURS &amp; TRANSPORT</strong><br/>
          <span style="font-size:10.5px; color:#444; line-height:1.5;">ROOM NO 4, RAM NAGIN TIWARI<br/>BHUVAN ASALFA VILLAGE, NEAR<br/>SHRI RAM APTGHATKOPAR WEST<br/>MUMBAI 400084</span>
        </td>
        <td style="padding:10px; line-height:1.7;">
          <strong style="font-size:14px;">${shipperName}</strong><br/>
        </td>
        <td style="text-align:center; vertical-align:middle; padding:10px;">
          ${barcodeDataUrl ? `<img src="${barcodeDataUrl}" style="max-width:100%; height:auto;" />` : ""}
          <div style="font-weight:bold; font-size:22px; color:#b71c1c; letter-spacing:1px; margin-top:2px;">${b.invoice_no}</div>
        </td>
        <td style="text-align:center; vertical-align:middle; padding:10px;">
          <div style="font-weight:bold; font-size:15px; color:#222;">${dateStr}</div>
        </td>
      </tr>
    </tbody>
  </table>
  <table class="it" style="border-top:none;">
    <colgroup><col style="width:32%"/><col style="width:8%"/><col style="width:12%"/><col style="width:13%"/><col style="width:15%"/><col style="width:20%"/></colgroup>
    <tbody>
      <tr><td class="lbl">Description of Service</td><td class="lbl" style="text-align:center;">Boxes</td><td class="lbl" style="text-align:center;">Contain</td><td class="lbl" style="text-align:center;">Weight</td><td class="lbl" style="text-align:center;">Rate/kg</td><td class="lbl" style="text-align:right;">Amount</td></tr>
      <tr>
        <td style="padding:12px 10px; line-height:1.8;"><strong>Bill for Providing Services for ${routeDisplay} sending&nbsp;&nbsp;sample</strong></td>
        <td></td><td></td><td></td><td></td><td></td>
      </tr>
      <tr>
        <td style="padding:8px 10px;"><strong>Weight</strong>&nbsp;&nbsp;${weight} kgs</td>
        <td style="text-align:center; vertical-align:middle;">1</td>
        <td style="vertical-align:middle;">water<br/>sample</td>
        <td style="text-align:right; vertical-align:middle; font-weight:bold;">${weight}</td>
        <td style="text-align:right; vertical-align:middle;">${ratePerKg.toFixed(0)}</td>
        <td style="text-align:right; vertical-align:middle; font-weight:bold; font-size:14px;">${weightAmt.toFixed(0)}</td>
      </tr>
      <tr>
        <td style="padding:8px 10px;"><strong>Box &amp; Packaging (1-Box)</strong></td>
        <td></td><td></td><td></td><td></td>
        <td style="text-align:right; vertical-align:middle; font-weight:bold; font-size:14px;">${packagingAmt.toFixed(0)}</td>
      </tr>
      <tr><td style="height:25px;"></td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td style="height:25px;"></td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td style="height:25px;"></td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr style="background:#f5f5f5;">
        <td colspan="5" style="font-weight:bold; font-size:14px; border-top:2px solid #222; padding:8px 10px;">Total</td>
        <td style="text-align:right; font-weight:bold; font-size:16px; border-top:2px solid #222; padding:8px 10px; color:#b71c1c;">\u20B9 ${grandTotal.toFixed(2)}</td>
      </tr>
      <tr>
        <td colspan="3" style="padding:10px; vertical-align:top; line-height:1.6;">
          <span style="font-size:12px; color:#222; font-weight:bold;">Amount Chargeable (in words)</span><br/>
          <strong style="font-size:15px; color:#111;">${amtWords}</strong>
        </td>
        <td colspan="3" style="text-align:right; vertical-align:top; padding:10px;">
          <strong style="font-size:13px;">For Swati Tours &amp; Transport</strong><br/>
          ${stampBase64 ? `<img src="${stampBase64}" style="width:120px; height:auto; opacity:0.9; margin-top:4px;" />` : ""}
        </td>
      </tr>
      <tr>
        <td colspan="3" style="padding:0; vertical-align:top;">
          <div style="padding:8px 10px 5px; font-weight:bold; font-size:13px; background:#f5f5f5; border-bottom:1px solid #333;">Received By</div>
          <div style="padding:8px 10px;">
            <div style="margin-bottom:10px;">
              <div style="font-size:11px; color:#555; margin-bottom:4px;">Name</div>
              <div style="border-bottom:1px dashed #999; min-height:18px;"></div>
            </div>
            <div style="margin-bottom:10px;">
              <div style="font-size:11px; color:#555; margin-bottom:4px;">Stamp / Sign</div>
              <div style="min-height:18px;"></div>
            </div>
            <div>
              <div style="font-size:11px; color:#555; margin-bottom:4px;">Date</div>
              <div style="border-bottom:1px dashed #999; min-height:18px;"></div>
            </div>
          </div>
        </td>
        <td colspan="3" style="padding:0; vertical-align:top;">
          <div style="padding:8px 10px 5px; font-weight:bold; font-size:13px; background:#f5f5f5; border-bottom:1px solid #333;">Bank Details</div>
          <div style="padding:8px 10px; font-size:11.5px; line-height:1.8;">
            <div><span style="color:#555;">Banker Name:</span> <strong>Bank of India</strong></div>
            <div><span style="color:#555;">Account Holder:</span> <strong>Swati Tours and Transport</strong></div>
            <div><span style="color:#555;">Account No:</span> <strong>061320110001257</strong></div>
            <div><span style="color:#555;">IFSC:</span> <strong>BKID0000613</strong></div>
            <div><span style="color:#555;">Branch:</span> <strong>Uttam Nagar, Pune</strong></div>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</div>
</body>
</html>`;

    const win = window.open("", "_blank");
    win.document.write(invoiceHTML);
    win.document.close();
  };

  const downloadInvoicePDF = async (b) => {
    const parsed = parseLocation(b.location);
    const route = parsed.route || b.location || "";
    const clientName = parsed.client || "";
    const routeDisplay = route.replace("-", " to ");
    const dateObj = b.date ? new Date(b.date) : new Date();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dateStr = dateObj.getDate().toString().padStart(2, "0") + "-" + months[dateObj.getMonth()] + "-" + String(dateObj.getFullYear()).slice(-2);
    const totalAmt = Number(b.total_amount) || 0;
    const weight = Number(b.weight) || 0;
    const extraItems = getExtraChargeItems(b);
    const extraTotal = extraItems.reduce((s, ec) => s + ec.amount, 0);
    const weightAmt = totalAmt - extraTotal > 0 ? totalAmt - extraTotal : totalAmt;
    const ratePerKg = weight > 0 ? (weightAmt / weight) : 0;
    const grandTotal = weightAmt + extraTotal;
    const amtWords = numberToWords(Math.floor(grandTotal)) + " Rupees Only";
    const shipperName = clientName || "";

    let barcodeDataUrl = "";
    try {
      const barcodeCanvas = document.createElement("canvas");
      JsBarcode(barcodeCanvas, b.invoice_no, { format: "CODE128", width: 1.8, height: 40, displayValue: false, margin: 2, background: "transparent" });
      barcodeDataUrl = barcodeCanvas.toDataURL("image/png");
    } catch (e) { /* ignore */ }

    const stampBase64 = localStorage.getItem("stamp_image") || defaultStamp;

    // Create hidden container for invoice rendering
    const container = document.createElement("div");
    container.style.cssText = "position:fixed; left:-9999px; top:0; z-index:-1;";
    container.innerHTML = `
<div style="width:800px; background:#fff; color:#000; font-family:'Courier New',Courier,monospace; font-size:13px; border:2px solid #222; position:relative;">
  <div style="position:absolute; top:0; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; pointer-events:none; z-index:0;">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="500" height="500" style="opacity:0.18;">
      <defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#f7850a"/><stop offset="100%" stop-color="#e06800"/></linearGradient><linearGradient id="blue" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4355db"/><stop offset="100%" stop-color="#2d3cb8"/></linearGradient><linearGradient id="brown" x1="100%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#9b3e1c"/><stop offset="100%" stop-color="#6d2b12"/></linearGradient></defs>
      <rect width="200" height="200" rx="40" fill="url(#bg)"/>
      <circle cx="72" cy="100" r="60" fill="none" stroke="url(#blue)" stroke-width="13" stroke-dasharray="310 68" stroke-dashoffset="-34" stroke-linecap="round"/>
      <circle cx="72" cy="100" r="46" fill="none" stroke="url(#brown)" stroke-width="9" stroke-dasharray="230 60" stroke-dashoffset="80" stroke-linecap="round"/>
      <text x="105" y="120" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="52" font-weight="900" font-style="italic" fill="#ffffff" letter-spacing="2">STT</text>
    </svg>
  </div>
  <div style="text-align:center; padding:14px 20px 10px; border-bottom:3px double #222; background:linear-gradient(180deg,#fafafa 0%,#fff 100%);">
    <h1 style="font-size:20px; font-weight:bold; letter-spacing:3px; color:#b71c1c; margin:0 0 4px; font-family:'Courier New',Courier,monospace;">SWATI TOURS &amp; TRANSPORT</h1>
    <p style="font-size:11px; line-height:1.5; margin:0; color:#333;">ROOM NO 4, RAM NAGIN TIWARI BHUVAN ASALFA VILLAGE, NEAR SHRI RAM APTGHATKOPAR WEST MUMBAI 400084</p>
    <p style="font-size:11.5px; font-weight:bold; margin-top:3px; color:#222;">UAM MH19D0152647 / PAN BSNPP7564G</p>
  </div>
  <table style="width:100%; border-collapse:collapse; position:relative; z-index:1;">
    <colgroup><col style="width:32%"/><col style="width:33%"/><col style="width:15%"/><col style="width:20%"/></colgroup>
    <tbody>
      <tr>
        <td style="border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222;">Consignor's</td>
        <td style="border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222;">CONSIGNEE</td>
        <td style="border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222; text-align:center;">INVOICE No</td>
        <td style="border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222; text-align:center;">Dated</td>
      </tr>
      <tr>
        <td style="border:1px solid #333; padding:10px; line-height:1.7; vertical-align:top; font-size:13px;">
          <strong style="font-size:13px;">SWATI TOURS &amp; TRANSPORT</strong><br/>
          <span style="font-size:10.5px; color:#444; line-height:1.5;">ROOM NO 4, RAM NAGIN TIWARI<br/>BHUVAN ASALFA VILLAGE, NEAR<br/>SHRI RAM APTGHATKOPAR WEST<br/>MUMBAI 400084</span>
        </td>
        <td style="border:1px solid #333; padding:10px; line-height:1.7; vertical-align:top; font-size:13px;">
          <strong style="font-size:14px;">${shipperName}</strong>
        </td>
        <td style="border:1px solid #333; text-align:center; vertical-align:middle; padding:10px; font-size:13px;">
          ${barcodeDataUrl ? `<img src="${barcodeDataUrl}" style="max-width:100%; height:auto;" />` : ""}
          <div style="font-weight:bold; font-size:22px; color:#b71c1c; letter-spacing:1px; margin-top:2px;">${b.invoice_no}</div>
        </td>
        <td style="border:1px solid #333; text-align:center; vertical-align:middle; padding:10px; font-size:13px;">
          <div style="font-weight:bold; font-size:15px; color:#222;">${dateStr}</div>
        </td>
      </tr>
    </tbody>
  </table>
  <table style="width:100%; border-collapse:collapse; border-top:none; position:relative; z-index:1;">
    <colgroup><col style="width:32%"/><col style="width:8%"/><col style="width:12%"/><col style="width:13%"/><col style="width:15%"/><col style="width:20%"/></colgroup>
    <tbody>
      <tr>
        <td style="border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222;">Description of Service</td>
        <td style="border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222; text-align:center;">Boxes</td>
        <td style="border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222; text-align:center;">Contain</td>
        <td style="border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222; text-align:center;">Weight</td>
        <td style="border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222; text-align:center;">Rate/kg</td>
        <td style="border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222; text-align:center;">Amount</td>
      </tr>
      <tr>
        <td style="border:1px solid #333; padding:12px 10px; line-height:1.8; font-size:13px;"><strong>Bill for Providing Services for ${routeDisplay} sending\u00A0\u00A0sample</strong></td>
        <td style="border:1px solid #333; font-size:13px;"></td><td style="border:1px solid #333; font-size:13px;"></td><td style="border:1px solid #333; font-size:13px;"></td><td style="border:1px solid #333; font-size:13px;"></td><td style="border:1px solid #333; font-size:13px;"></td>
      </tr>
      <tr>
        <td style="border:1px solid #333; padding:8px 10px; font-size:13px;"><strong>Weight</strong>\u00A0\u00A0${weight} kgs</td>
        <td style="border:1px solid #333; text-align:center; vertical-align:middle; font-size:13px;">1</td>
        <td style="border:1px solid #333; vertical-align:middle; font-size:13px; text-align:center;">water<br/>sample</td>
        <td style="border:1px solid #333; text-align:center; vertical-align:middle; font-weight:bold; font-size:13px;">${weight}</td>
        <td style="border:1px solid #333; text-align:center; vertical-align:middle; font-size:13px;">${ratePerKg.toFixed(0)}</td>
        <td style="border:1px solid #333; text-align:center; vertical-align:middle; font-weight:bold; font-size:14px;">${weightAmt.toFixed(0)}</td>
      </tr>
      ${extraItems.map((ec) => ec.amount > 0 ? `<tr>
        <td style="border:1px solid #333; padding:8px 10px; font-size:13px;"><strong>${ec.description}</strong></td>
        <td style="border:1px solid #333; font-size:13px;"></td><td style="border:1px solid #333; font-size:13px;"></td><td style="border:1px solid #333; font-size:13px;"></td><td style="border:1px solid #333; font-size:13px;"></td>
        <td style="border:1px solid #333; text-align:center; vertical-align:middle; font-weight:bold; font-size:14px;">${ec.amount.toFixed(0)}</td>
      </tr>` : "").join("")}
      <tr><td style="border:1px solid #333; height:25px; font-size:13px;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td></tr>
      <tr><td style="border:1px solid #333; height:25px; font-size:13px;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td></tr>
      <tr><td style="border:1px solid #333; height:25px; font-size:13px;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td></tr>
      <tr style="background:#f5f5f5;">
        <td colspan="5" style="border:1px solid #333; font-weight:bold; font-size:14px; border-top:2px solid #222; padding:8px 10px;">Total</td>
        <td style="border:1px solid #333; text-align:center; font-weight:bold; font-size:16px; border-top:2px solid #222; padding:8px 10px; color:#b71c1c;">\u20B9 ${grandTotal.toFixed(2)}</td>
      </tr>
      <tr>
        <td colspan="3" style="border:1px solid #333; padding:10px; vertical-align:top; line-height:1.6; font-size:13px;">
          <span style="font-size:12px; color:#222; font-weight:bold;">Amount Chargeable (in words)</span><br/>
          <strong style="font-size:15px; color:#111;">${amtWords}</strong>
        </td>
        <td colspan="3" style="border:1px solid #333; text-align:right; vertical-align:top; padding:10px; font-size:13px;">
          <strong style="font-size:13px;">For Swati Tours &amp; Transport</strong><br/>
          ${stampBase64 ? `<img src="${stampBase64}" style="width:120px; height:auto; opacity:0.9; margin-top:4px;" />` : ""}
        </td>
      </tr>
      <tr>
        <td colspan="3" style="border:1px solid #333; padding:0; vertical-align:top; font-size:13px;">
          <div style="padding:8px 10px 5px; font-weight:bold; font-size:13px; background:rgba(245,245,245,0.6); border-bottom:1px solid #333;">Received By</div>
          <div style="padding:8px 10px;">
            <div style="margin-bottom:10px;"><div style="font-size:11px; color:#555; margin-bottom:4px;">Name</div><div style="border-bottom:1px dashed #999; min-height:18px;"></div></div>
            <div style="margin-bottom:10px;"><div style="font-size:11px; color:#555; margin-bottom:4px;">Stamp / Sign</div><div style="min-height:18px;"></div></div>
            <div><div style="font-size:11px; color:#555; margin-bottom:4px;">Date</div><div style="border-bottom:1px dashed #999; min-height:18px;"></div></div>
          </div>
        </td>
        <td colspan="3" style="border:1px solid #333; padding:0; vertical-align:top; font-size:13px;">
          <div style="padding:8px 10px 5px; font-weight:bold; font-size:13px; background:rgba(245,245,245,0.6); border-bottom:1px solid #333;">Bank Details</div>
          <div style="padding:8px 10px; font-size:11.5px; line-height:1.8;">
            <div><span style="color:#555;">Banker Name:</span> <strong>Bank of India</strong></div>
            <div><span style="color:#555;">Account Holder:</span> <strong>Swati Tours and Transport</strong></div>
            <div><span style="color:#555;">Account No:</span> <strong>061320110001257</strong></div>
            <div><span style="color:#555;">IFSC:</span> <strong>BKID0000613</strong></div>
            <div><span style="color:#555;">Branch:</span> <strong>Uttam Nagar, Pune</strong></div>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</div>`;

    document.body.appendChild(container);
    await new Promise((r) => setTimeout(r, 100));

    const el = container.firstElementChild;
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#fff" });
    document.body.removeChild(container);

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = (canvas.height * pdfW) / canvas.width;
    pdf.addImage(imgData, "PNG", 0, 0, pdfW, pdfH);
    pdf.save(`Invoice_${b.invoice_no}_${dateStr || "draft"}.pdf`);
  };

  const handleDownloadInvoice = (b) => {
    const parsed = parseLocation(b.location);
    const route = parsed.route || b.location || "";
    const clientName = parsed.client || "";
    const extraItems = getExtraChargeItems(b);
    const extraTotal = extraItems.reduce((s, ec) => s + ec.amount, 0);
    const totalAmt = Number(b.total_amount) || 0;
    const wt = Number(b.weight) || 0;
    const weightAmt = totalAmt - extraTotal > 0 ? totalAmt - extraTotal : totalAmt;
    const ratePerKg = wt > 0 ? Math.round(weightAmt / wt) : 0;

    // Map billing data to InvoiceCreate format
    const invoiceData = {
      invoice_no: b.invoice_no || "",
      date: b.date ? b.date.split("T")[0] : "",
      route: route,
      client_name: clientName,
      client_address: "",
      client_phone: "",
      weight: String(wt),
      boxes: String(b.boxes || "1"),
      contain: "water\nsample",
      rate_per_kg: String(ratePerKg),
      box_rate: String(b.box_rate || "150"),
      show_packaging: b.show_packaging || false,
      show_oda: b.show_oda || false,
      oda_location: b.oda_location || "Bhosri",
      oda_person: b.oda_person || "Ankit P",
      oda_amount: String(b.oda_amount || "600"),
      show_pickup: b.show_pickup || false,
      pickup_entries: b.pickup_entries || [],
      pickup_rate: String(b.pickup_rate || "600"),
      show_other: b.show_other || false,
      other_desc: b.other_desc || "",
      other_amount: String(b.other_amount || ""),
    };

    localStorage.setItem("open_invoice", JSON.stringify(invoiceData));
    navigate("/invoice/create?autodownload=" + b.invoice_no);
  };

  return (
    <div>
      <div className="page-header">
        <h1>Billing Details</h1>
        <button
          className="btn btn-primary"
          onClick={() => { setEditing(null); setForm({ ...emptyForm }); setShowModal(true); }}
        >
          + Add Billing
        </button>
      </div>

      {/* Filter Bar */}
      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Year:</label>
            <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }}>
              <option value="">All Years</option>
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Month:</label>
            <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }}>
              <option value="">All Months</option>
              {MONTH_NAMES.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Location:</label>
            <select value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }}>
              <option value="">All Locations</option>
              {availableLocations.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
            </select>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={() => { setFilterYear(new Date().getFullYear().toString()); setFilterMonth(""); setFilterLocation(""); }}>
            Reset
          </button>
          <span style={{ fontSize: 13, color: "#666", marginLeft: "auto" }}>
            Showing {filteredBillings.length} of {billings.length} records
          </span>
        </div>
      </div>

      {/* Filter Summary Cards */}
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        <div className="stat-card blue">
          <div className="label">
            Total Billing
            {filterLocation ? ` - ${filterLocation}` : ""}
            {filterMonth ? ` - ${MONTH_NAMES[filterMonth - 1]}` : ""}
            {filterYear ? ` ${filterYear}` : ""}
          </div>
          <div className="value" style={{ fontSize: 22 }}>₹{filterTotals.total.toLocaleString("en-IN")}</div>
        </div>
        <div className="stat-card orange">
          <div className="label">
            BOM Expense
            {filterLocation ? ` - ${filterLocation}` : ""}
            {filterMonth ? ` - ${MONTH_NAMES[filterMonth - 1]}` : ""}
            {filterYear ? ` ${filterYear}` : ""}
          </div>
          <div className="value" style={{ fontSize: 22 }}>₹{filterTotals.bom.toLocaleString("en-IN")}</div>
        </div>
        <div className="stat-card red">
          <div className="label">
            Other Expense
            {filterLocation ? ` - ${filterLocation}` : ""}
            {filterMonth ? ` - ${MONTH_NAMES[filterMonth - 1]}` : ""}
            {filterYear ? ` ${filterYear}` : ""}
          </div>
          <div className="value" style={{ fontSize: 22 }}>₹{filterTotals.other.toLocaleString("en-IN")}</div>
        </div>
      </div>

      {/* Export Section */}
      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-sm" style={{ background: "#16a34a", color: "#fff" }} onClick={() => setShowExportPanel(!showExportPanel)}>
              {showExportPanel ? "Hide Export Options" : "Export Options"}
            </button>
            <button className="btn btn-sm" style={{ background: "#dc2626", color: "#fff" }} onClick={exportToPDF}>
              Export PDF
            </button>
            <button className="btn btn-sm" style={{ background: "#0d6efd", color: "#fff" }} onClick={exportToExcel}>
              Export Excel
            </button>
          </div>
          <span style={{ fontSize: 12, color: "#999" }}>
            {selectedCols.length} of {ALL_COLUMNS.length} columns selected
          </span>
        </div>
        {showExportPanel && (
          <div style={{ marginTop: 14, padding: "14px 0 0", borderTop: "1px solid #eee" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Select columns to export:</label>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-sm btn-secondary" onClick={() => setExportColumns(ALL_COLUMNS.reduce((a, c) => ({ ...a, [c.key]: true }), {}))}>Select All</button>
                <button className="btn btn-sm btn-secondary" onClick={() => setExportColumns(ALL_COLUMNS.reduce((a, c) => ({ ...a, [c.key]: false }), {}))}>Deselect All</button>
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 20px" }}>
              {ALL_COLUMNS.map((col) => (
                <label key={col.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={exportColumns[col.key]}
                    onChange={(e) => setExportColumns({ ...exportColumns, [col.key]: e.target.checked })}
                    style={{ width: 16, height: 16, accentColor: "#4361ee" }}
                  />
                  {col.label}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Invoice No.</th>
              <th>Date</th>
              <th>Location</th>
              <th>Weight</th>
              <th>Total Amount</th>
              <th>BOM Expense</th>
              <th>Exp Description</th>
              <th>Other Exp</th>
              <th>Exp Description</th>
              <th>Extra Charges</th>
              <th>Extra Charges Description</th>
              <th>PAID / NOTPAID</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredBillings.length === 0 ? (
              <tr>
                <td colSpan="13" style={{ textAlign: "center", padding: "40px", color: "#999" }}>
                  No billing records match the filters
                </td>
              </tr>
            ) : (
              filteredBillings.map((b) => (
                <tr key={b.id}>
                  <td><strong style={{ color: "#4361ee", cursor: "pointer", textDecoration: "underline" }}
                    onClick={() => {
                      if (b.invoice_data) {
                        localStorage.setItem("open_invoice", b.invoice_data);
                        navigate("/invoice/create?open=" + b.invoice_no);
                      } else {
                        generateInvoice(b);
                      }
                    }}>{b.invoice_no}</strong></td>
                  <td>{b.date ? new Date(b.date).toLocaleDateString() : "-"}</td>
                  <td>{b.location || "-"}</td>
                  <td>{b.weight || "-"}</td>
                  <td>{b.total_amount != null ? `₹${Number(b.total_amount).toLocaleString()}` : "-"}</td>
                  <td>{b.bom_expense != null ? `₹${Number(b.bom_expense).toLocaleString()}` : "-"}</td>
                  <td>{b.bom_exp_description || "-"}</td>
                  <td>{b.other_expense != null ? `₹${Number(b.other_expense).toLocaleString()}` : "-"}</td>
                  <td>{b.other_exp_description || "-"}</td>
                  <td style={{ fontSize: 12, lineHeight: 1.6 }}>{(() => {
                    const items = getExtraChargeItems(b);
                    return items.length > 0
                      ? items.map((ec, i) => <div key={i}>₹{ec.amount.toLocaleString()}</div>)
                      : "-";
                  })()}</td>
                  <td style={{ fontSize: 11, lineHeight: 1.6 }}>{(() => {
                    const items = getExtraChargeItems(b);
                    return items.length > 0
                      ? items.map((ec, i) => <div key={i}>{ec.description}</div>)
                      : "-";
                  })()}</td>
                  <td>
                    <span className={`badge ${b.payment_status === "PAID" ? "delivered" : "cancelled"}`}>
                      {b.payment_status}
                    </span>
                  </td>
                  <td>
                    <div className="btn-group" style={{ flexWrap: "wrap" }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleEdit(b)}>Edit</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(b.id, b.invoice_no)}>Delete</button>
                      <button className="btn btn-sm" style={{ background: "#4361ee", color: "#fff" }} onClick={() => handleDownloadInvoice(b)}>Download Invoice</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? "Edit Billing" : "Add Billing"}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Invoice No.</label>
                <input required value={form.invoice_no} onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Date</label>
                <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Location</label>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <select
                    style={{ flex: 1 }}
                    value={form.location_route || ""}
                    onChange={(e) => setForm({ ...form, location_route: e.target.value })}
                  >
                    <option value="">-- Select Route --</option>
                    {locations.map((loc) => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                  <input
                    style={{ flex: 1 }}
                    placeholder="Client name (optional)"
                    value={form.location_client || ""}
                    onChange={(e) => setForm({ ...form, location_client: e.target.value })}
                  />
                </div>
                <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                  <input
                    style={{ flex: 1 }}
                    placeholder="Add new route e.g. NGP-BOM"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value.toUpperCase())}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLocation(); } }}
                  />
                  <button type="button" className="btn btn-primary btn-sm" onClick={addLocation}>Add</button>
                </div>
                {form.location_route && (
                  <div style={{ marginTop: "6px", fontSize: "13px", color: "#555" }}>
                    Preview: <strong>{form.location_route}{form.location_client ? `(${form.location_client})` : ""}</strong>
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>Weight</label>
                <input type="number" step="0.01" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Total Amount</label>
                <input type="number" step="0.01" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} />
              </div>
              <div className="form-group">
                <label>BOM Expense</label>
                <input type="number" step="0.01" value={form.bom_expense} onChange={(e) => setForm({ ...form, bom_expense: e.target.value })} />
              </div>
              <div className="form-group">
                <label>BOM Exp Description</label>
                <input value={form.bom_exp_description} onChange={(e) => setForm({ ...form, bom_exp_description: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Other Expense</label>
                <input type="number" step="0.01" value={form.other_expense} onChange={(e) => setForm({ ...form, other_expense: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Other Exp Description</label>
                <input value={form.other_exp_description} onChange={(e) => setForm({ ...form, other_exp_description: e.target.value })} />
              </div>
              <div className="form-group">
                <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Extra Charges</span>
                  <button type="button" className="btn btn-sm"
                    style={{ padding: "4px 12px", fontSize: 12, background: (form.show_packaging || form.show_oda || form.show_pickup || form.show_other) ? "#4361ee" : "#555", color: "#fff", borderRadius: 6 }}
                    onClick={() => setForm({ ...form, showExtrasDropdown: !form.showExtrasDropdown })}>
                    Extra Charges ▾
                  </button>
                </label>
                {form.showExtrasDropdown && (
                  <div style={{ marginTop: 8, background: "#fff", border: "1px solid #ddd", borderRadius: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.12)", padding: 0, maxHeight: "60vh", overflowY: "auto" }}>

                    {/* --- Box & Packaging --- */}
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <strong style={{ fontSize: 13 }}>Box &amp; Packaging</strong>
                        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                          <input type="checkbox" checked={form.show_packaging}
                            onChange={(e) => setForm({ ...form, show_packaging: e.target.checked })} /> Enable
                        </label>
                      </div>
                      {form.show_packaging && (
                        <div>
                          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: 11, color: "#555" }}>Boxes</label>
                              <input type="number" step="1" style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                                value={form.boxes} onChange={(e) => setForm({ ...form, boxes: e.target.value })} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: 11, color: "#555" }}>Rate per Box (₹)</label>
                              <input type="number" step="1" style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                                value={form.box_rate} onChange={(e) => setForm({ ...form, box_rate: e.target.value })} />
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: "#555" }}>
                            {Number(form.boxes) || 0} box × ₹{Number(form.box_rate) || 0} = <strong>₹{(Number(form.boxes) || 0) * (Number(form.box_rate) || 0)}</strong>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* --- ODA Pickup --- */}
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <strong style={{ fontSize: 13 }}>ODA Pickup Location</strong>
                        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                          <input type="checkbox" checked={form.show_oda}
                            onChange={(e) => setForm({ ...form, show_oda: e.target.checked })} /> Enable
                        </label>
                      </div>
                      {form.show_oda && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div>
                            <label style={{ fontSize: 11, color: "#555" }}>Location</label>
                            <input style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                              value={form.oda_location} onChange={(e) => setForm({ ...form, oda_location: e.target.value })} />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: "#555" }}>Person Name</label>
                            <input style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                              value={form.oda_person} onChange={(e) => setForm({ ...form, oda_person: e.target.value })} />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: "#555" }}>Amount (₹)</label>
                            <input type="number" style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                              value={form.oda_amount} onChange={(e) => setForm({ ...form, oda_amount: e.target.value })} />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* --- Pickup Charges --- */}
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <strong style={{ fontSize: 13 }}>Pickup Charges</strong>
                        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                          <input type="checkbox" checked={form.show_pickup}
                            onChange={(e) => setForm({ ...form, show_pickup: e.target.checked })} /> Enable
                        </label>
                      </div>
                      {form.show_pickup && (
                        <div>
                          <div style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: 11, color: "#555" }}>Rate per Pickup (₹)</label>
                            <input type="number" style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                              value={form.pickup_rate} onChange={(e) => setForm({ ...form, pickup_rate: e.target.value })} />
                          </div>
                          <div style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: 11, color: "#555" }}>Select Person</label>
                            <select style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                              value="" onChange={(e) => {
                                if (e.target.value) setForm({ ...form, pickup_entries: [...form.pickup_entries, e.target.value] });
                              }}>
                              <option value="">-- Select name to add --</option>
                              {pickupRoster.map((name, i) => <option key={i} value={name}>{name}</option>)}
                            </select>
                          </div>
                          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                            <input style={{ flex: 1, padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12 }}
                              placeholder="Add new name to list"
                              value={form.pickup_new_name}
                              onChange={(e) => setForm({ ...form, pickup_new_name: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && form.pickup_new_name.trim()) {
                                  e.preventDefault();
                                  const updated = [...pickupRoster, form.pickup_new_name.trim()];
                                  setPickupRoster(updated);
                                  localStorage.setItem("pickup_roster", JSON.stringify(updated));
                                  setForm({ ...form, pickup_new_name: "" });
                                }
                              }} />
                            <button type="button" className="btn btn-sm" style={{ background: "#444", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 11 }}
                              onClick={() => {
                                if (form.pickup_new_name.trim()) {
                                  const updated = [...pickupRoster, form.pickup_new_name.trim()];
                                  setPickupRoster(updated);
                                  localStorage.setItem("pickup_roster", JSON.stringify(updated));
                                  setForm({ ...form, pickup_new_name: "" });
                                }
                              }}>+ Name</button>
                          </div>
                          {form.pickup_entries.length > 0 && (
                            <div style={{ marginBottom: 4 }}>
                              <label style={{ fontSize: 11, color: "#555", marginBottom: 4, display: "block" }}>Added ({form.pickup_entries.length})</label>
                              {form.pickup_entries.map((name, i) => (
                                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 12 }}>
                                  <span>Pickup Charges (<strong>{name}</strong>)</span>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <span style={{ color: "#555" }}>₹{Number(form.pickup_rate) || 0}</span>
                                    <span style={{ cursor: "pointer", color: "#e63946", fontWeight: "bold", fontSize: 14 }}
                                      onClick={() => setForm({ ...form, pickup_entries: form.pickup_entries.filter((_, idx) => idx !== i) })}>×</span>
                                  </div>
                                </div>
                              ))}
                              <div style={{ borderTop: "1px solid #eee", marginTop: 4, paddingTop: 4, fontSize: 12, fontWeight: "bold" }}>
                                Total: ₹{form.pickup_entries.length * (Number(form.pickup_rate) || 0)}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* --- Other Charges --- */}
                    <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <strong style={{ fontSize: 13 }}>Other Charges</strong>
                        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                          <input type="checkbox" checked={form.show_other}
                            onChange={(e) => setForm({ ...form, show_other: e.target.checked })} /> Enable
                        </label>
                      </div>
                      {form.show_other && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div>
                            <label style={{ fontSize: 11, color: "#555" }}>Description</label>
                            <input style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                              placeholder="Enter description"
                              value={form.other_desc} onChange={(e) => setForm({ ...form, other_desc: e.target.value })} />
                          </div>
                          <div>
                            <label style={{ fontSize: 11, color: "#555" }}>Amount (₹)</label>
                            <input type="number" style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                              value={form.other_amount} onChange={(e) => setForm({ ...form, other_amount: e.target.value })} />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* --- Done --- */}
                    <div style={{ padding: "10px 16px" }}>
                      <button type="button" className="btn btn-sm" style={{ width: "100%", background: "#4361ee", color: "#fff", padding: "8px", borderRadius: 6, fontSize: 13 }}
                        onClick={() => setForm({ ...form, showExtrasDropdown: false })}>Done</button>
                    </div>
                  </div>
                )}
                {/* Summary of enabled extras */}
                {(form.show_packaging || form.show_oda || form.show_pickup || form.show_other) && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#555", lineHeight: 1.8 }}>
                    {form.show_packaging && <div>Box & Packaging: <strong>₹{(Number(form.boxes) || 0) * (Number(form.box_rate) || 0)}</strong></div>}
                    {form.show_oda && <div>{form.oda_person} (ODA-Pickup): <strong>₹{Number(form.oda_amount) || 0}</strong></div>}
                    {form.show_pickup && form.pickup_entries.map((name, i) => <div key={i}>Pickup ({name}): <strong>₹{Number(form.pickup_rate) || 0}</strong></div>)}
                    {form.show_other && form.other_desc && <div>{form.other_desc}: <strong>₹{Number(form.other_amount) || 0}</strong></div>}
                    <div style={{ fontWeight: 600, borderTop: "1px solid #eee", paddingTop: 4, marginTop: 4 }}>
                      Total Extra: ₹{getExtraChargeItems(form).reduce((s, ec) => s + ec.amount, 0).toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
              <div className="form-group">
                <label>Payment Status</label>
                <select value={form.payment_status} onChange={(e) => setForm({ ...form, payment_status: e.target.value })}>
                  <option value="PAID">PAID</option>
                  <option value="NOTPAID">NOTPAID</option>
                </select>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editing ? "Update" : "Add"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
