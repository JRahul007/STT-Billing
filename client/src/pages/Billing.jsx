import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import JsBarcode from "jsbarcode";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";
import {
  getBillings,
  createBilling,
  updateBilling,
  deleteBilling,
  getParties,
  createParty,
  updateParty,
  deleteParty,
} from "../services/api";
import { getDefaultStamp } from "../defaultStamp";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DEFAULT_CONSIGNER = {
  name: "SWATI TOURS & TRANSPORT",
  address: "A-902, DREAM CARNIVAL, NEAR PNG JEWELLERS, CHAROLI, PUNE-412105",
  mobile: "+91 8291301603",
};

const DEFAULT_CONSIGNEE = {
  name: "EQUINOX LABS PVT.LTD",
  address: "Center, R65, TTC, Rabale, Navi Mumbai, Maharashtra 400701",
  mobile: "+91 7588712196",
};

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
  consigner_name: DEFAULT_CONSIGNER.name,
  consigner_address: DEFAULT_CONSIGNER.address,
  consigner_mobile: DEFAULT_CONSIGNER.mobile,
  consignee_name: DEFAULT_CONSIGNEE.name,
  consignee_address: DEFAULT_CONSIGNEE.address,
  consignee_mobile: DEFAULT_CONSIGNEE.mobile,
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
  total_boxes: "1",
  packaging_mode: "box",
  packaging_name: "",
  packaging_amount: "",
  packaging_entries: [],
  packaging_edit_index: null,
  show_delivery: false,
  delivery_rate: "600",
  delivery_entries: [],
  delivery_selected_name: "",
  delivery_edit_index: null,
  delivery_new_name: "",
  show_pickup: false,
  pickup_rate: "600",
  pickup_entries: [],
  pickup_selected_name: "",
  pickup_edit_index: null,
  pickup_new_name: "",
  show_other: false,
  other_desc: "",
  other_amount: "",
  other_entries: [],
  other_edit_index: null,
  show_remark: false,
  remark: "",
  showExtrasDropdown: false,
  payment_status: "NOTPAID",
};

function buildDefaultBillingForm(consigners = [], consignees = []) {
  const selectedConsigner = consigners[0] ? normalizeParty(consigners[0]) : normalizeParty(DEFAULT_CONSIGNER);
  const selectedConsignee = consignees[0] ? normalizeParty(consignees[0]) : normalizeParty(DEFAULT_CONSIGNEE);
  return {
    ...emptyForm,
    consigner_name: selectedConsigner.name,
    consigner_address: selectedConsigner.address,
    consigner_mobile: selectedConsigner.mobile,
    consignee_name: selectedConsignee.name,
    consignee_address: selectedConsignee.address,
    consignee_mobile: selectedConsignee.mobile,
  };
}

const defaultLocations = [
  { route: "BOM-PUNE", rate_per_kg: "" },
  { route: "PUNE-BOM", rate_per_kg: "" },
  { route: "BOM-GOA", rate_per_kg: "" },
  { route: "GOA-BOM", rate_per_kg: "" },
  { route: "IDR-BOM", rate_per_kg: "" },
  { route: "BOM-IDR", rate_per_kg: "" },
];

const INVOICE_PREFIX = "STT-";

function getNextInvoiceNo(billings) {
  let max = 0;
  for (const b of billings || []) {
    const m = /^STT-0*(\d+)$/i.exec(String(b?.invoice_no || "").trim());
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `${INVOICE_PREFIX}${String(max + 1).padStart(3, "0")}`;
}

// Extract extra charges as [{description, amount}] from a billing record
function normalizePackagingEntries(b) {
  if (Array.isArray(b?.packaging_entries) && b.packaging_entries.length > 0) {
    return b.packaging_entries
      .map((entry) => ({
        kind: String(entry?.kind || (entry?.amount ? "ice_box" : "box")),
        name: String(entry?.name || entry?.label || ""),
        boxes: String(entry?.boxes ?? ""),
        rate: String(entry?.rate ?? entry?.box_rate ?? ""),
        amount: String(entry?.amount ?? ""),
      }))
      .filter((entry) => (
        (entry.kind === "ice_box" && (entry.name.trim() || Number(entry.amount) > 0))
        || (entry.kind !== "ice_box" && (Number(entry.boxes) > 0 || Number(entry.rate) > 0))
      ));
  }
  // Only Boxes mode: count goes to total_boxes only, never to a packaging line/charge.
  if (b?.packaging_mode === "only_boxes") return [];
  if (b?.show_packaging) {
    return [{
      kind: "box",
      name: "",
      boxes: String(b?.boxes || "1"),
      rate: String(b?.box_rate || "150"),
      amount: "",
    }];
  }
  return [];
}

function normalizePickupEntries(b) {
  if (!Array.isArray(b?.pickup_entries)) return [];
  return b.pickup_entries
    .map((entry) => {
      if (typeof entry === "string") {
        return { name: entry, rate: String(b?.pickup_rate || "600") };
      }
      return {
        name: String(entry?.name || entry?.person || ""),
        rate: String(entry?.rate ?? b?.pickup_rate ?? "600"),
      };
    })
    .filter((entry) => entry.name.trim());
}

function normalizeDeliveryEntries(b) {
  if (!Array.isArray(b?.delivery_entries)) return [];
  return b.delivery_entries
    .map((entry) => {
      if (typeof entry === "string") {
        return { name: entry, rate: String(b?.delivery_rate || "600") };
      }
      return {
        name: String(entry?.name || entry?.person || ""),
        rate: String(entry?.rate ?? b?.delivery_rate ?? "600"),
      };
    })
    .filter((entry) => entry.name.trim());
}

function normalizeOtherEntries(b) {
  if (Array.isArray(b?.other_entries) && b.other_entries.length > 0) {
    return b.other_entries
      .map((entry) => ({
        description: String(entry?.description || entry?.desc || ""),
        amount: String(entry?.amount ?? ""),
      }))
      .filter((entry) => entry.description.trim() || Number(entry.amount) > 0);
  }
  if (b?.show_other && b?.other_desc) {
    return [{
      description: String(b.other_desc || ""),
      amount: String(b.other_amount || ""),
    }];
  }
  return [];
}

function getLegacyExtraFields(source) {
  const packagingEntries = normalizePackagingEntries(source);
  const pickupEntries = normalizePickupEntries(source);
  const deliveryEntries = normalizeDeliveryEntries(source);
  const otherEntries = normalizeOtherEntries(source);
  const firstPackaging = packagingEntries[0] || {};
  const firstBoxPackaging = packagingEntries.find((entry) => entry.kind !== "ice_box") || {};
  const firstPickup = pickupEntries[0] || {};
  const firstDelivery = deliveryEntries[0] || {};
  const firstOther = otherEntries[0] || {};

  return {
    boxes: firstBoxPackaging.boxes ? String(firstBoxPackaging.boxes || "1") : "1",
    box_rate: firstBoxPackaging.rate ? String(firstBoxPackaging.rate || "150") : "150",
    pickup_rate: pickupEntries.length > 0 ? String(firstPickup.rate || "600") : "600",
    delivery_rate: deliveryEntries.length > 0 ? String(firstDelivery.rate || "600") : "600",
    other_desc: otherEntries.length > 0 ? String(firstOther.description || "") : "",
    other_amount: otherEntries.length > 0 ? String(firstOther.amount || "") : "",
  };
}

function getExtraChargeItems(b) {
  const items = [];
  if (b.show_packaging) {
    normalizePackagingEntries(b).forEach((entry) => {
      if (entry.kind === "ice_box") {
        items.push({
          description: `Box & Packaging (Ice-Box${entry.name ? ` - ${entry.name}` : ""})`,
          amount: Number(entry.amount) || 0,
        });
      } else {
        const boxes = Number(entry.boxes) || 0;
        const rate = Number(entry.rate) || 0;
        items.push({ description: `Box & Pkging (${boxes}-Box)`, amount: boxes * rate });
      }
    });
  }
  if (b.show_pickup) {
    normalizePickupEntries(b).forEach((entry) => {
      items.push({ description: `Pickup (${entry.name})`, amount: Number(entry.rate) || 0 });
    });
  }
  if (b.show_delivery) {
    normalizeDeliveryEntries(b).forEach((entry) => {
      items.push({ description: `Delivery (${entry.name})`, amount: Number(entry.rate) || 0 });
    });
  }
  if (b.show_other) {
    normalizeOtherEntries(b).forEach((entry) => {
      items.push({ description: entry.description || "Other", amount: Number(entry.amount) || 0 });
    });
  }
  // Support legacy extra_charges_list format
  if (b.extra_charges_list) b.extra_charges_list.forEach((ec) => {
    if (Number(ec.amount) > 0) items.push({ description: ec.description || "Other", amount: Number(ec.amount) });
  });
  return items;
}

function normalizeParty(party) {
  return {
    id: party?.id,
    party_type: party?.party_type || "",
    name: (party?.name || "").trim().toUpperCase(),
    address: (party?.address || "").trim(),
    mobile: (party?.mobile || "").trim(),
  };
}

function formatPartyName(name) {
  return (name || "").trim().toUpperCase();
}

function findPartyIndex(list, target) {
  if (!target?.name) return -1;
  return list.findIndex((party) =>
    party.name === formatPartyName(target.name)
    && (party.address || "") === (target.address || "")
    && (party.mobile || "") === (target.mobile || "")
  );
}

function normalizeLocationEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    const route = entry.trim().toUpperCase();
    return route ? { route, rate_per_kg: "" } : null;
  }
  const route = (entry.route || entry.location || "").trim().toUpperCase();
  if (!route) return null;
  const rate = entry.rate_per_kg ?? entry.ratePerKg ?? entry.rate ?? "";
  return { route, rate_per_kg: rate === "" ? "" : String(rate) };
}

function normalizeLocations(entries) {
  const seen = new Set();
  const normalized = [];
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const item = normalizeLocationEntry(entry);
    if (!item || seen.has(item.route)) return;
    seen.add(item.route);
    normalized.push(item);
  });
  return normalized;
}

function saveLocationsToStorage(entries) {
  localStorage.setItem("billing_locations", JSON.stringify(entries));
}

export default function Billing() {
  const RECORDS_PER_PAGE = 10;
  const navigate = useNavigate();
  const [billings, setBillings] = useState(() => {
    return JSON.parse(localStorage.getItem("invoices") || "[]");
  });
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(() => buildDefaultBillingForm([DEFAULT_CONSIGNER], [DEFAULT_CONSIGNEE]));
  const [locations, setLocations] = useState(() => {
    const saved = localStorage.getItem("billing_locations");
    return saved ? normalizeLocations(JSON.parse(saved)) : [...defaultLocations];
  });
  const [locationForm, setLocationForm] = useState({ route: "", rate_per_kg: "" });
  const [locationEditingRoute, setLocationEditingRoute] = useState(null);
  const [showLocationManager, setShowLocationManager] = useState(false);
  const [pickupRoster, setPickupRoster] = useState(() => {
    const saved = localStorage.getItem("pickup_roster");
    return saved ? JSON.parse(saved) : ["Ankit Yadav", "Dhiraj Maske", "Tirath Mali"];
  });
  const [deliveryRoster, setDeliveryRoster] = useState(() => {
    const saved = localStorage.getItem("delivery_roster");
    return saved ? JSON.parse(saved) : ["Ankit P", "Ravi K", "Suresh M"];
  });
  const [consigners, setConsigners] = useState(() => [normalizeParty(DEFAULT_CONSIGNER)]);
  const [consignees, setConsignees] = useState(() => [normalizeParty(DEFAULT_CONSIGNEE)]);
  const [showPartyModal, setShowPartyModal] = useState(false);
  const [partyType, setPartyType] = useState("consignee");
  const [partyEditingIndex, setPartyEditingIndex] = useState(null);
  const [partyForm, setPartyForm] = useState({ name: "", address: "", mobile: "" });
  const [filterMonth, setFilterMonth] = useState("");
  const [filterYear, setFilterYear] = useState(new Date().getFullYear().toString());
  const [filterLocation, setFilterLocation] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
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

  const availableClients = useMemo(() => {
    const clients = new Set();
    billings.forEach((b) => {
      const name = b.consignee_name;
      if (name) clients.add(name);
    });
    return Array.from(clients).sort();
  }, [billings]);

  const filteredBillings = useMemo(() => {
    return billings.filter((b) => {
      if (!b.date) return !filterMonth && !filterYear;
      const d = new Date(b.date);
      if (filterYear && d.getFullYear() !== parseInt(filterYear)) return false;
      if (filterMonth && (d.getMonth() + 1) !== parseInt(filterMonth)) return false;
      if (filterLocation && extractLocation(b.location) !== filterLocation) return false;
      if (filterClient && b.consignee_name !== filterClient) return false;
      return true;
    });
  }, [billings, filterMonth, filterYear, filterLocation, filterClient]);

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

  const totalPages = Math.max(1, Math.ceil(filteredBillings.length / RECORDS_PER_PAGE));
  const paginatedBillings = useMemo(() => {
    const start = (currentPage - 1) * RECORDS_PER_PAGE;
    return filteredBillings.slice(start, start + RECORDS_PER_PAGE);
  }, [filteredBillings, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterMonth, filterYear, filterLocation, filterClient]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pageNumbers = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages]);

  const selectedCols = ALL_COLUMNS.filter((c) => exportColumns[c.key]);
  const selectedLocationConfig = useMemo(
    () => locations.find((loc) => loc.route === form.location_route) || null,
    [locations, form.location_route]
  );
  const computedFreightAmount = useMemo(() => {
    const weight = Number(form.weight);
    const rate = Number(selectedLocationConfig?.rate_per_kg);
    if (!form.location_route || !Number.isFinite(weight) || weight <= 0 || !Number.isFinite(rate) || rate <= 0) {
      return "";
    }
    return String(Math.round(weight * rate));
  }, [form.location_route, form.weight, selectedLocationConfig]);

  const getFilterLabel = () => {
    let label = "Billing Data";
    if (filterClient) label += ` - ${filterClient}`;
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

  const resetLocationManager = () => {
    setLocationForm({ route: "", rate_per_kg: "" });
    setLocationEditingRoute(null);
  };

  const openLocationManager = () => {
    setShowLocationManager((prev) => !prev);
    if (showLocationManager) resetLocationManager();
  };

  const handleSaveLocation = () => {
    const route = locationForm.route.trim().toUpperCase();
    const ratePerKg = locationForm.rate_per_kg.trim();
    if (!route) {
      alert("Location route is required.");
      return;
    }

    const duplicate = locations.some(
      (loc) => loc.route === route && loc.route !== locationEditingRoute
    );
    if (duplicate) {
      alert("This location already exists.");
      return;
    }

    const nextEntry = { route, rate_per_kg: ratePerKg };
    const updated = locationEditingRoute
      ? locations.map((loc) => (loc.route === locationEditingRoute ? nextEntry : loc))
      : [...locations, nextEntry];

    setLocations(updated);
    saveLocationsToStorage(updated);
    setForm((prev) => ({
      ...prev,
      location_route: prev.location_route === locationEditingRoute || (!locationEditingRoute && !prev.location_route)
        ? route
        : prev.location_route,
    }));
    resetLocationManager();
  };

  const handleEditLocation = (route) => {
    const current = locations.find((loc) => loc.route === route);
    if (!current) return;
    setLocationEditingRoute(route);
    setLocationForm({ route: current.route, rate_per_kg: current.rate_per_kg || "" });
    setShowLocationManager(true);
  };

  const handleDeleteLocation = (route) => {
    if (!window.confirm(`Delete location "${route}"?`)) return;
    const updated = locations.filter((loc) => loc.route !== route);
    setLocations(updated);
    saveLocationsToStorage(updated);
    if (form.location_route === route) {
      setForm((prev) => ({ ...prev, location_route: "", total_amount: "" }));
    }
    if (locationEditingRoute === route) resetLocationManager();
  };

  const getCurrentPartyList = () => (partyType === "consigner" ? consigners : consignees);

  const loadParties = async () => {
    try {
      let { data } = await getParties();
      let all = Array.isArray(data) ? data : [];

      const hasConsigner = all.some((party) => party.party_type === "consigner");
      const hasConsignee = all.some((party) => party.party_type === "consignee");

      if (!hasConsigner) {
        await createParty({ party_type: "consigner", ...DEFAULT_CONSIGNER });
      }
      if (!hasConsignee) {
        await createParty({ party_type: "consignee", ...DEFAULT_CONSIGNEE });
      }

      if (!hasConsigner || !hasConsignee) {
        const reloaded = await getParties();
        all = Array.isArray(reloaded.data) ? reloaded.data : [];
      }

      const consignerList = all
        .filter((party) => party.party_type === "consigner")
        .map((party) => normalizeParty(party));
      const consigneeList = all
        .filter((party) => party.party_type === "consignee")
        .map((party) => normalizeParty(party));

      const safeConsigners = consignerList.length > 0 ? consignerList : [normalizeParty(DEFAULT_CONSIGNER)];
      const safeConsignees = consigneeList.length > 0 ? consigneeList : [normalizeParty(DEFAULT_CONSIGNEE)];

      setConsigners(safeConsigners);
      setConsignees(safeConsignees);
    } catch (e) {
      setConsigners([normalizeParty(DEFAULT_CONSIGNER)]);
      setConsignees([normalizeParty(DEFAULT_CONSIGNEE)]);
    }
  };

  const openPartyManager = (type) => {
    setPartyType(type);
    setPartyEditingIndex(null);
    setPartyForm({ name: "", address: "", mobile: "" });
    setShowPartyModal(true);
  };

  const closePartyManager = () => {
    setShowPartyModal(false);
    setPartyEditingIndex(null);
    setPartyForm({ name: "", address: "", mobile: "" });
  };

  const startEditParty = (index) => {
    const list = getCurrentPartyList();
    const current = list[index];
    if (!current) return;
    setPartyEditingIndex(index);
    setPartyForm({ ...current });
  };

  const handleDeleteParty = async (index) => {
    const list = getCurrentPartyList();
    const target = list[index];
    if (!target) return;
    if (!window.confirm(`Delete ${partyType} "${target.name}"?`)) return;

    if (!target.id) {
      alert("This party is not in DB yet. Please refresh and try again.");
      return;
    }

    try {
      await deleteParty(target.id);
      await loadParties();
    } catch (err) {
      alert(err?.response?.data?.error || "Failed to delete party.");
      return;
    }

    if (partyType === "consigner" && form.consigner_name === target.name) {
      setForm((prev) => ({ ...prev, consigner_name: "", consigner_address: "", consigner_mobile: "" }));
    }
    if (partyType === "consignee" && form.consignee_name === target.name) {
      setForm((prev) => ({ ...prev, consignee_name: "", consignee_address: "", consignee_mobile: "" }));
    }
  };

  const handleSaveParty = async (e) => {
    e.preventDefault();
    const normalized = normalizeParty(partyForm);
    if (!normalized.name) {
      alert("Name is required.");
      return;
    }

    const payload = {
      party_type: partyType,
      name: normalized.name,
      address: normalized.address,
      mobile: normalized.mobile,
    };

    try {
      if (partyEditingIndex != null && partyEditingIndex >= 0) {
        const current = getCurrentPartyList()[partyEditingIndex];
        if (!current?.id) {
          alert("Cannot update this party right now. Please refresh and try again.");
          return;
        }
        await updateParty(current.id, payload);
      } else {
        await createParty(payload);
      }
      await loadParties();
    } catch (err) {
      alert(err?.response?.data?.error || "Failed to save party.");
      return;
    }

    if (partyType === "consigner") {
      setForm((prev) => ({
        ...prev,
        consigner_name: normalized.name,
        consigner_address: normalized.address,
        consigner_mobile: normalized.mobile,
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        consignee_name: normalized.name,
        consignee_address: normalized.address,
        consignee_mobile: normalized.mobile,
      }));
    }

    setPartyEditingIndex(null);
    setPartyForm({ name: "", address: "", mobile: "" });
  };

  const applySelectedParty = (type, index) => {
    if (index === "") {
      if (type === "consigner") {
        setForm((prev) => ({ ...prev, consigner_name: "", consigner_address: "", consigner_mobile: "" }));
      } else {
        setForm((prev) => ({ ...prev, consignee_name: "", consignee_address: "", consignee_mobile: "" }));
      }
      return;
    }
    const list = type === "consigner" ? consigners : consignees;
    const selected = list[Number(index)];
    if (!selected) return;
    if (type === "consigner") {
      setForm((prev) => ({
        ...prev,
        consigner_name: selected.name,
        consigner_address: selected.address,
        consigner_mobile: selected.mobile,
      }));
    } else {
      setForm((prev) => ({
        ...prev,
        consignee_name: selected.name,
        consignee_address: selected.address,
        consignee_mobile: selected.mobile,
      }));
    }
  };

  // Parse `invoice_data` JSON blob back onto the record so extras (packaging/pickup/ODA/other)
  // round-trip through the server. The server only persists 11 named columns — anything else
  // has to live inside `invoice_data`.
  const hydrateBilling = (b) => {
    if (!b || !b.invoice_data) return b;
    try {
      const parsed = typeof b.invoice_data === "string" ? JSON.parse(b.invoice_data) : b.invoice_data;
      if (parsed && typeof parsed === "object") return { ...parsed, ...b };
    } catch (e) { /* ignore malformed JSON */ }
    return b;
  };

  const loadData = () => {
    const localInvoices = JSON.parse(localStorage.getItem("invoices") || "[]");
    getBillings().then((res) => {
      // Merge: API data + local invoices (avoid duplicates by invoice_no)
      const apiData = (res.data || []).map(hydrateBilling);
      const apiNos = new Set(apiData.map((d) => d.invoice_no));
      const merged = [...apiData, ...localInvoices.filter((l) => !apiNos.has(l.invoice_no))];
      setBillings(merged);
    }).catch(() => {
      setBillings(localInvoices);
    });
  };

  useEffect(() => {
    loadData();
    loadParties();
  }, []);

  useEffect(() => {
    if (computedFreightAmount === "") return;
    setForm((prev) => (prev.total_amount === computedFreightAmount
      ? prev
      : { ...prev, total_amount: computedFreightAmount }));
  }, [computedFreightAmount]);

  const upsertPackagingEntry = () => {
    const nextEntry = form.packaging_mode === "ice_box"
      ? {
        kind: "ice_box",
        name: form.packaging_name.trim(),
        boxes: "",
        rate: "",
        amount: String(form.packaging_amount || "").trim(),
      }
      : {
        kind: "box",
        name: "",
        boxes: String(form.boxes || "").trim(),
        rate: String(form.box_rate || "").trim(),
        amount: "",
      };
    if (
      (nextEntry.kind === "ice_box" && (!nextEntry.name || !nextEntry.amount))
      || (nextEntry.kind === "box" && (!nextEntry.boxes || !nextEntry.rate))
    ) return;
    const nextEntries = [...form.packaging_entries];
    if (form.packaging_edit_index !== null) nextEntries[form.packaging_edit_index] = nextEntry;
    else nextEntries.push(nextEntry);
    setForm({
      ...form,
      packaging_entries: nextEntries,
      packaging_mode: "box",
      packaging_name: "",
      packaging_amount: "",
      boxes: "1",
      box_rate: "150",
      packaging_edit_index: null,
    });
  };

  const upsertPickupEntry = () => {
    const name = form.pickup_selected_name.trim();
    const rate = String(form.pickup_rate || "").trim();
    if (!name || !rate) return;
    const nextEntry = { name, rate };
    const nextEntries = [...form.pickup_entries];
    if (form.pickup_edit_index !== null) nextEntries[form.pickup_edit_index] = nextEntry;
    else nextEntries.push(nextEntry);
    setForm({
      ...form,
      pickup_entries: nextEntries,
      pickup_selected_name: "",
      pickup_rate: "600",
      pickup_edit_index: null,
    });
  };

  const upsertDeliveryEntry = () => {
    const name = (form.delivery_selected_name || "").trim();
    const rate = String(form.delivery_rate || "").trim();
    if (!name || !rate) return;
    const nextEntry = { name, rate };
    const nextEntries = [...form.delivery_entries];
    if (form.delivery_edit_index !== null) nextEntries[form.delivery_edit_index] = nextEntry;
    else nextEntries.push(nextEntry);
    setForm({
      ...form,
      delivery_entries: nextEntries,
      delivery_selected_name: "",
      delivery_rate: "600",
      delivery_edit_index: null,
    });
  };

  // Inline rate editor: when user types a rate next to the route dropdown, update the
  // route's rate_per_kg in both state and localStorage so auto-freight fires immediately.
  const handleRouteRateChange = (newRate) => {
    if (!form.location_route) return;
    const sanitized = String(newRate).replace(/[^0-9.]/g, "");
    const updated = locations.map((loc) =>
      loc.route === form.location_route ? { ...loc, rate_per_kg: sanitized } : loc
    );
    // If the selected route isn't in the locations list yet (edge case), add it.
    if (!locations.some((loc) => loc.route === form.location_route)) {
      updated.push({ route: form.location_route, rate_per_kg: sanitized });
    }
    setLocations(updated);
    saveLocationsToStorage(updated);
  };

  const upsertOtherEntry = () => {
    const description = form.other_desc.trim();
    const amount = String(form.other_amount || "").trim();
    if (!description || !amount) return;
    const nextEntry = { description, amount };
    const nextEntries = [...form.other_entries];
    if (form.other_edit_index !== null) nextEntries[form.other_edit_index] = nextEntry;
    else nextEntries.push(nextEntry);
    setForm({
      ...form,
      other_entries: nextEntries,
      other_desc: "",
      other_amount: "",
      other_edit_index: null,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const location = form.location_route
      ? form.location_route + (form.location_client ? `(${form.location_client})` : "")
      : form.location;
    // Compute grand total = freight + extras (rounded to whole rupees to avoid float issues)
    const freight = Math.round(Number(form.total_amount) || 0);
    const extrasTotal = getExtraChargeItems(form).reduce((s, ec) => s + ec.amount, 0);
    const grandTotal = freight + extrasTotal;
    const submitData = {
      ...form,
      ...getLegacyExtraFields(form),
      location,
      total_amount: grandTotal,
    };
    delete submitData.location_route;
    delete submitData.location_client;
    delete submitData.showExtrasDropdown;
    delete submitData.packaging_name;
    delete submitData.packaging_amount;
    delete submitData.packaging_edit_index;
    delete submitData.pickup_selected_name;
    delete submitData.pickup_edit_index;
    delete submitData.pickup_new_name;
    delete submitData.delivery_selected_name;
    delete submitData.delivery_edit_index;
    delete submitData.delivery_new_name;
    delete submitData.other_edit_index;

    // Serialize all extras into the invoice_data TEXT column so they round-trip through the server.
    // The server schema only stores 11 named columns; anything outside that whitelist must live in
    // invoice_data. Without this, packaging/delivery/pickup/other entries disappear on reload and
    // the downloaded invoice PDF shows no extras.
    submitData.invoice_data = JSON.stringify({
      consigner_name: submitData.consigner_name,
      consigner_address: submitData.consigner_address,
      consigner_mobile: submitData.consigner_mobile,
      consignee_name: submitData.consignee_name,
      consignee_address: submitData.consignee_address,
      consignee_mobile: submitData.consignee_mobile,
      freight_amount: freight,
      show_packaging: submitData.show_packaging,
      packaging_mode: submitData.packaging_mode,
      packaging_entries: submitData.packaging_entries,
      boxes: submitData.boxes,
      total_boxes: submitData.total_boxes,
      box_rate: submitData.box_rate,
      show_delivery: submitData.show_delivery,
      delivery_entries: submitData.delivery_entries,
      delivery_rate: submitData.delivery_rate,
      show_pickup: submitData.show_pickup,
      pickup_entries: submitData.pickup_entries,
      pickup_rate: submitData.pickup_rate,
      show_other: submitData.show_other,
      other_entries: submitData.other_entries,
      other_desc: submitData.other_desc,
      other_amount: submitData.other_amount,
      show_remark: submitData.show_remark,
      remark: submitData.remark,
    });

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
    setForm(buildDefaultBillingForm(consigners, consignees));
    loadData();
  };

  const parseLocation = (loc) => {
    if (!loc) return { route: "", client: "" };
    const match = loc.match(/^([A-Z]+-[A-Z]+)\((.+)\)$/);
    if (match) return { route: match[1], client: match[2] };
    if (locations.some((entry) => entry.route === loc)) return { route: loc, client: "" };
    return { route: "", client: "" };
  };

  const handleEdit = (b) => {
    setEditing(b);
    const parsed = parseLocation(b.location);
    const savedConsigner = normalizeParty({
      name: b.consigner_name || DEFAULT_CONSIGNER.name,
      address: b.consigner_address || DEFAULT_CONSIGNER.address,
      mobile: b.consigner_mobile || DEFAULT_CONSIGNER.mobile,
    });
    const savedConsignee = normalizeParty({
      name: b.consignee_name || parsed.client || "",
      address: b.consignee_address || "",
      mobile: b.consignee_mobile || "",
    });
    // Compute freight = total - extras (so total stays = freight + extras when re-edited)
    const extrasTotal = getExtraChargeItems(b).reduce((s, ec) => s + ec.amount, 0);
    const totalRounded = Math.round(Number(b.total_amount) || 0);
    const freightAmount = totalRounded - extrasTotal;
    const packagingEntries = normalizePackagingEntries(b);
    const pickupEntries = normalizePickupEntries(b);
    const deliveryEntries = normalizeDeliveryEntries(b);
    const otherEntries = normalizeOtherEntries(b);
    const legacyFields = getLegacyExtraFields({
      packaging_entries: packagingEntries,
      pickup_entries: pickupEntries,
      delivery_entries: deliveryEntries,
      other_entries: otherEntries,
    });
    setForm({
      invoice_no: b.invoice_no,
      date: b.date ? b.date.split("T")[0] : "",
      location: b.location || "",
      location_route: parsed.route,
      location_client: parsed.client,
      consigner_name: savedConsigner.name,
      consigner_address: savedConsigner.address,
      consigner_mobile: savedConsigner.mobile,
      consignee_name: savedConsignee.name,
      consignee_address: savedConsignee.address,
      consignee_mobile: savedConsignee.mobile,
      weight: b.weight || "",
      total_amount: freightAmount > 0 ? String(freightAmount) : "",
      bom_expense: b.bom_expense || "",
      bom_exp_description: b.bom_exp_description || "",
      other_expense: b.other_expense || "",
      other_exp_description: b.other_exp_description || "",
      show_packaging: b.show_packaging || false,
      box_rate: legacyFields.box_rate,
      boxes: legacyFields.boxes,
      total_boxes: String(b.total_boxes || legacyFields.boxes || "1"),
      packaging_mode: b.packaging_mode === "only_boxes" ? "only_boxes" : "box",
      packaging_name: "",
      packaging_amount: "",
      packaging_entries: packagingEntries,
      packaging_edit_index: null,
      show_delivery: b.show_delivery || false,
      delivery_rate: legacyFields.delivery_rate,
      delivery_entries: deliveryEntries,
      delivery_selected_name: "",
      delivery_edit_index: null,
      delivery_new_name: "",
      show_pickup: b.show_pickup || false,
      pickup_rate: legacyFields.pickup_rate,
      pickup_entries: pickupEntries,
      pickup_selected_name: "",
      pickup_edit_index: null,
      pickup_new_name: "",
      show_other: b.show_other || false,
      other_desc: legacyFields.other_desc,
      other_amount: legacyFields.other_amount,
      other_entries: otherEntries,
      other_edit_index: null,
      show_remark: b.show_remark || Boolean(b.remark),
      remark: b.remark || "",
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

    const consigner = normalizeParty({
      name: b.consigner_name || DEFAULT_CONSIGNER.name,
      address: b.consigner_address || DEFAULT_CONSIGNER.address,
      mobile: b.consigner_mobile || "",
    });
    const consignee = normalizeParty({
      name: b.consignee_name || clientName || "",
      address: b.consignee_address || "",
      mobile: b.consignee_mobile || "",
    });

    // Generate barcode as data URL
    let barcodeDataUrl = "";
    try {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, b.invoice_no, { format: "CODE128", width: 1.8, height: 40, displayValue: false, margin: 2, background: "transparent" });
      barcodeDataUrl = canvas.toDataURL("image/png");
    } catch (e) { /* ignore */ }

    // Get stamp from localStorage
    const stampBase64 = localStorage.getItem("stamp_image") || await getDefaultStamp();

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
    <p class="addr">A-902, DREAM CARNIVAL, NEAR PNG JEWELLERS, CHAROLI, PUNE-412105</p>
    <p class="addr">Contact: 8291301603 &nbsp;|&nbsp; Email: pune.stt@gmail.com</p>
    <p class="pan">UAM MH19D0152647 / PAN BSNPP7564G</p>
  </div>
  <table class="it">
    <colgroup><col style="width:32%"/><col style="width:33%"/><col style="width:15%"/><col style="width:20%"/></colgroup>
    <tbody>
      <tr><td class="lbl">Consignor's</td><td class="lbl">CONSIGNEE</td><td class="lbl" style="text-align:center;">INVOICE No</td><td class="lbl" style="text-align:center;">Date</td></tr>
      <tr>
        <td style="padding:10px; line-height:1.7;">
          <strong style="font-size:13px;">${formatPartyName(consigner.name)}</strong><br/>
          <span style="font-size:10.5px; color:#444; line-height:1.5; white-space:pre-line;">${consigner.address || "-"}</span><br/>
          <span style="font-size:10.5px; color:#444; line-height:1.5;">${consigner.mobile || "-"}</span>
        </td>
        <td style="padding:10px; line-height:1.7;">
          <strong style="font-size:14px;">${formatPartyName(consignee.name)}</strong><br/>
          <span style="font-size:10.5px; color:#444; line-height:1.5; white-space:pre-line;">${consignee.address || "-"}</span><br/>
          <span style="font-size:10.5px; color:#444; line-height:1.5;">${consignee.mobile || "-"}</span>
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
    const consigner = normalizeParty({
      name: b.consigner_name || DEFAULT_CONSIGNER.name,
      address: b.consigner_address || DEFAULT_CONSIGNER.address,
      mobile: b.consigner_mobile || "",
    });
    const consignee = normalizeParty({
      name: b.consignee_name || clientName || "",
      address: b.consignee_address || "",
      mobile: b.consignee_mobile || "",
    });

    let barcodeDataUrl = "";
    try {
      const barcodeCanvas = document.createElement("canvas");
      JsBarcode(barcodeCanvas, b.invoice_no, { format: "CODE128", width: 1.8, height: 40, displayValue: false, margin: 2, background: "transparent" });
      barcodeDataUrl = barcodeCanvas.toDataURL("image/png");
    } catch (e) { /* ignore */ }

    const stampBase64 = localStorage.getItem("stamp_image") || await getDefaultStamp();

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
    <p style="font-size:11px; line-height:1.5; margin:0; color:#333;">A-902, DREAM CARNIVAL, NEAR PNG JEWELLERS, CHAROLI, PUNE-412105</p>
    <p style="font-size:11px; margin:3px 0 0; color:#333;">Contact: 8291301603 &nbsp;|&nbsp; Email: pune.stt@gmail.com</p>
    <p style="font-size:11.5px; font-weight:bold; margin-top:3px; color:#222;">UAM MH19D0152647 / PAN BSNPP7564G</p>
  </div>
  <table style="width:100%; border-collapse:collapse; position:relative; z-index:1;">
    <colgroup><col style="width:32%"/><col style="width:33%"/><col style="width:15%"/><col style="width:20%"/></colgroup>
    <tbody>
      <tr>
        <td style="border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222;">Consignor's</td>
        <td style="border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222;">CONSIGNEE</td>
        <td style="border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222; text-align:center;">INVOICE No</td>
        <td style="border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222; text-align:center;">Date</td>
      </tr>
      <tr>
        <td style="border:1px solid #333; padding:10px; line-height:1.7; vertical-align:top; font-size:13px;">
          <strong style="font-size:13px;">${formatPartyName(consigner.name)}</strong><br/>
          <span style="font-size:10.5px; color:#444; line-height:1.5; white-space:pre-line;">${consigner.address || "-"}</span><br/>
          <span style="font-size:10.5px; color:#444; line-height:1.5;">${consigner.mobile || "-"}</span>
        </td>
        <td style="border:1px solid #333; padding:10px; line-height:1.7; vertical-align:top; font-size:13px;">
          <strong style="font-size:14px;">${formatPartyName(consignee.name)}</strong><br/>
          <span style="font-size:10.5px; color:#444; line-height:1.5; white-space:pre-line;">${consignee.address || "-"}</span><br/>
          <span style="font-size:10.5px; color:#444; line-height:1.5;">${consignee.mobile || "-"}</span>
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
    const consigner = normalizeParty({
      name: b.consigner_name || DEFAULT_CONSIGNER.name,
      address: b.consigner_address || DEFAULT_CONSIGNER.address,
      mobile: b.consigner_mobile || "",
    });
    const consignee = normalizeParty({
      name: b.consignee_name || clientName || "",
      address: b.consignee_address || "",
      mobile: b.consignee_mobile || "",
    });
    const extraItems = getExtraChargeItems(b);
    const extraTotal = extraItems.reduce((s, ec) => s + ec.amount, 0);
    const totalAmt = Math.round(Number(b.total_amount) || 0);
    const wt = Number(b.weight) || 0;
    const weightAmt = totalAmt - extraTotal > 0 ? totalAmt - extraTotal : totalAmt;
    // Keep rate as float (not rounded) so weight × rate = weightAmt exactly. The PDF rounds the rate display only.
    const ratePerKg = wt > 0 ? (weightAmt / wt) : 0;

    // Map billing data to InvoiceCreate format
    const invoiceData = {
      invoice_no: b.invoice_no || "",
      date: b.date ? b.date.split("T")[0] : "",
      route: route,
      client_name: consignee.name,
      client_address: consignee.address,
      client_phone: consignee.mobile,
      consigner_name: consigner.name,
      consigner_address: consigner.address,
      consigner_mobile: consigner.mobile,
      consignee_name: consignee.name,
      consignee_address: consignee.address,
      consignee_mobile: consignee.mobile,
      weight: String(wt),
      boxes: String(b.boxes || "1"),
      total_boxes: String(b.total_boxes || b.boxes || "1"),
      contain: "water\nsample",
      rate_per_kg: String(ratePerKg),
      box_rate: String(b.box_rate || "150"),
      packaging_mode: b.packaging_mode === "only_boxes" ? "only_boxes" : "box",
      packaging_entries: normalizePackagingEntries(b),
      show_packaging: b.show_packaging || false,
      show_delivery: b.show_delivery || false,
      delivery_entries: normalizeDeliveryEntries(b),
      delivery_rate: String(b.delivery_rate || "600"),
      show_pickup: b.show_pickup || false,
      pickup_entries: normalizePickupEntries(b),
      pickup_rate: String(b.pickup_rate || "600"),
      show_other: b.show_other || false,
      other_desc: b.other_desc || "",
      other_amount: String(b.other_amount || ""),
      other_entries: normalizeOtherEntries(b),
      show_remark: b.show_remark || Boolean(b.remark),
      remark: b.remark || "",
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
          onClick={() => {
            setEditing(null);
            setForm({ ...buildDefaultBillingForm(consigners, consignees), invoice_no: getNextInvoiceNo(billings) });
            setShowModal(true);
          }}
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
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Client:</label>
            <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }}>
              <option value="">All Clients</option>
              {availableClients.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button className="btn btn-sm btn-secondary" onClick={() => { setFilterYear(new Date().getFullYear().toString()); setFilterMonth(""); setFilterLocation(""); setFilterClient(""); }}>
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
            {filterClient ? ` - ${filterClient}` : ""}
            {filterLocation ? ` - ${filterLocation}` : ""}
            {filterMonth ? ` - ${MONTH_NAMES[filterMonth - 1]}` : ""}
            {filterYear ? ` ${filterYear}` : ""}
          </div>
          <div className="value" style={{ fontSize: 22 }}>₹{filterTotals.total.toLocaleString("en-IN")}</div>
        </div>
        <div className="stat-card orange">
          <div className="label">
            BOM Expense
            {filterClient ? ` - ${filterClient}` : ""}
            {filterLocation ? ` - ${filterLocation}` : ""}
            {filterMonth ? ` - ${MONTH_NAMES[filterMonth - 1]}` : ""}
            {filterYear ? ` ${filterYear}` : ""}
          </div>
          <div className="value" style={{ fontSize: 22 }}>₹{filterTotals.bom.toLocaleString("en-IN")}</div>
        </div>
        <div className="stat-card red">
          <div className="label">
            Other Expense
            {filterClient ? ` - ${filterClient}` : ""}
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
              paginatedBillings.map((b) => (
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
      {filteredBillings.length > 0 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            style={{ minWidth: 84, opacity: currentPage === 1 ? 0.6 : 1 }}
          >
            Previous
          </button>
          {pageNumbers.map((page) => (
            <button
              key={page}
              type="button"
              className="btn btn-sm"
              onClick={() => setCurrentPage(page)}
              style={{
                minWidth: 38,
                background: currentPage === page ? "#4361ee" : "#fff",
                color: currentPage === page ? "#fff" : "#111",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontWeight: currentPage === page ? 700 : 500,
              }}
            >
              {page}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            style={{ minWidth: 84, opacity: currentPage === totalPages ? 0.6 : 1 }}
          >
            Next
          </button>
        </div>
      )}

      {showModal && (() => {
        const extrasActive = form.show_packaging || form.show_delivery || form.show_pickup || form.show_other;
        const extrasCount = (form.show_packaging ? 1 : 0) + (form.show_delivery ? 1 : 0) + (form.show_pickup ? 1 : 0) + (form.show_other ? 1 : 0);
        const freightNum = Math.round(Number(form.total_amount) || 0);
        const extrasTotal = getExtraChargeItems(form).reduce((s, ec) => s + ec.amount, 0);
        const grandTotal = freightNum + extrasTotal;
        return (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <div className="friendly-modal-header">
              <h2>
                <span style={{ fontSize: 24 }}>{editing ? "✏️" : "🧾"}</span>
                {editing ? "Edit Billing" : "Create New Billing"}
              </h2>
              <div className="friendly-subtitle">
                {editing
                  ? "Update the details below and save your changes."
                  : "Fill out the required sections to create a new bill. Optional sections can be skipped."}
              </div>
              <button type="button" className="modal-close-btn" aria-label="Close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="friendly-modal-body">

                {/* STEP 1 — BASIC INFO */}
                <div className="step-card">
                  <div className="step-card-header">
                    <div className="step-badge">1</div>
                    <div className="step-card-title">
                      <h3>Basic Details <span className="badge-required">Required</span></h3>
                      <p>Invoice number, date and route for this shipment.</p>
                    </div>
                  </div>
                  <div className="step-card-body">
                    <div className="field-row">
                      <div className="form-group">
                        <label>Invoice Number</label>
                        <div className="invoice-prefix-input">
                          <span className="prefix-badge">STT-</span>
                          <input
                            required
                            value={(form.invoice_no || "").replace(/^STT-/i, "")}
                            onChange={(e) => {
                              const suffix = e.target.value.replace(/^STT-/i, "").replace(/[^A-Za-z0-9\-]/g, "");
                              setForm({ ...form, invoice_no: `STT-${suffix}` });
                            }}
                            placeholder="001"
                          />
                        </div>
                        <div className="helper-hint">Auto-generated — edit if needed.</div>
                      </div>
                      <div className="form-group">
                        <label>Date</label>
                        <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                      </div>
                    </div>

                    <div className="form-group">
                      <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>Route &amp; Client</span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={openLocationManager}>
                          {showLocationManager ? "Close Manager" : "+ Manage Routes"}
                        </button>
                      </label>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <select
                          style={{ flex: "1 1 180px" }}
                          value={form.location_route || ""}
                          onChange={(e) => setForm({ ...form, location_route: e.target.value })}
                        >
                          <option value="">Select a route…</option>
                          {locations.map((loc) => (
                            <option key={loc.route} value={loc.route}>
                              {loc.route}{loc.rate_per_kg ? ` (₹${loc.rate_per_kg}/kg)` : ""}
                            </option>
                          ))}
                        </select>
                        {/* Inline rate editor — saves to route on change so auto-freight fires immediately */}
                        {form.location_route && (
                          <div className="rate-chip" title="Rate per kg for this route">
                            <span className="rate-chip-label">₹</span>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              placeholder="0"
                              value={selectedLocationConfig?.rate_per_kg || ""}
                              onChange={(e) => handleRouteRateChange(e.target.value)}
                            />
                            <span className="rate-chip-label">/kg</span>
                          </div>
                        )}
                        <input
                          style={{ flex: "1 1 200px" }}
                          placeholder="Client name (optional)"
                          value={form.location_client || ""}
                          onChange={(e) => setForm({ ...form, location_client: e.target.value })}
                        />
                      </div>
                      {form.location_route && !selectedLocationConfig?.rate_per_kg && (
                        <div className="helper-hint warn">
                          ⚠️ No rate set for {form.location_route}. Type the rate in the ₹/kg box above to auto-calculate freight.
                        </div>
                      )}
                      {selectedLocationConfig?.rate_per_kg && (
                        <div className="helper-hint info">
                          💡 Rate for {form.location_route}: ₹{Number(selectedLocationConfig.rate_per_kg).toLocaleString("en-IN")}/kg
                        </div>
                      )}
                      {form.location_route && (
                        <div className="helper-hint">
                          Preview: <strong style={{ marginLeft: 4 }}>{form.location_route}{form.location_client ? ` (${form.location_client})` : ""}</strong>
                        </div>
                      )}
                      {showLocationManager && (
                        <div style={{ marginTop: 12, border: "1px solid #dbe3f3", borderRadius: 12, background: "#f8faff", padding: 14 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#4338ca", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Manage Routes</div>
                          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr auto", gap: 8, alignItems: "end" }}>
                            <div>
                              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Route</label>
                              <input
                                placeholder="e.g. PUNE-BOM"
                                value={locationForm.route}
                                onChange={(e) => setLocationForm((prev) => ({ ...prev, route: e.target.value.toUpperCase() }))}
                              />
                            </div>
                            <div>
                              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Rate per KG</label>
                              <input
                                type="number"
                                min="0"
                                step="1"
                                placeholder="40"
                                value={locationForm.rate_per_kg}
                                onChange={(e) => setLocationForm((prev) => ({ ...prev, rate_per_kg: e.target.value }))}
                              />
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveLocation}>
                                {locationEditingRoute ? "Update" : "Add"}
                              </button>
                              {locationEditingRoute && (
                                <button type="button" className="btn btn-sm btn-secondary" onClick={resetLocationManager}>
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>
                          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                            {locations.length === 0 ? (
                              <div style={{ fontSize: 13, color: "#64748b" }}>No routes added yet.</div>
                            ) : (
                              locations.map((loc) => (
                                <div
                                  key={loc.route}
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    gap: 10,
                                    padding: "10px 12px",
                                    borderRadius: 10,
                                    background: "#fff",
                                    border: "1px solid #e2e8f0",
                                  }}
                                >
                                  <div>
                                    <div style={{ fontWeight: 700, color: "#0f172a" }}>{loc.route}</div>
                                    <div style={{ fontSize: 12, color: "#64748b" }}>
                                      {loc.rate_per_kg ? `₹${Number(loc.rate_per_kg).toLocaleString("en-IN")} per kg` : "Rate not set"}
                                    </div>
                                  </div>
                                  <div style={{ display: "flex", gap: 8 }}>
                                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => handleEditLocation(loc.route)}>Edit</button>
                                    <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteLocation(loc.route)}>Delete</button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* STEP 2 — PARTIES */}
                <div className="step-card">
                  <div className="step-card-header">
                    <div className="step-badge">2</div>
                    <div className="step-card-title">
                      <h3>Consigner &amp; Consignee <span className="badge-required">Required</span></h3>
                      <p>Who's sending and who's receiving? Pick from saved parties or add new ones.</p>
                    </div>
                  </div>
                  <div className="step-card-body">
                    <div className="field-row">
                      <div className="form-group">
                        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>Consigner (Sender)</span>
                          <button type="button" className="btn btn-sm btn-secondary" onClick={() => openPartyManager("consigner")}>+ Manage</button>
                        </label>
                        <select
                          value={(() => {
                            const index = findPartyIndex(consigners, {
                              name: form.consigner_name,
                              address: form.consigner_address,
                              mobile: form.consigner_mobile,
                            });
                            return index >= 0 ? String(index) : "";
                          })()}
                          onChange={(e) => applySelectedParty("consigner", e.target.value)}
                        >
                          <option value="">Select consigner…</option>
                          {consigners.map((party, index) => (
                            <option key={`${party.name}-${index}`} value={index}>
                              {party.name}
                            </option>
                          ))}
                        </select>
                        {form.consigner_name && (
                          <div className="party-preview">
                            <div className="pp-name">{formatPartyName(form.consigner_name)}</div>
                            <div className="pp-detail">{form.consigner_address || "—"}</div>
                            <div className="pp-detail">📞 {form.consigner_mobile || "—"}</div>
                          </div>
                        )}
                      </div>
                      <div className="form-group">
                        <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>Consignee (Receiver)</span>
                          <button type="button" className="btn btn-sm btn-secondary" onClick={() => openPartyManager("consignee")}>+ Manage</button>
                        </label>
                        <select
                          value={(() => {
                            const index = findPartyIndex(consignees, {
                              name: form.consignee_name,
                              address: form.consignee_address,
                              mobile: form.consignee_mobile,
                            });
                            return index >= 0 ? String(index) : "";
                          })()}
                          onChange={(e) => applySelectedParty("consignee", e.target.value)}
                        >
                          <option value="">Select consignee…</option>
                          {consignees.map((party, index) => (
                            <option key={`${party.name}-${index}`} value={index}>
                              {party.name}
                            </option>
                          ))}
                        </select>
                        {form.consignee_name && (
                          <div className="party-preview">
                            <div className="pp-name">{formatPartyName(form.consignee_name)}</div>
                            <div className="pp-detail">{form.consignee_address || "—"}</div>
                            <div className="pp-detail">📞 {form.consignee_mobile || "—"}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* STEP 3 — WEIGHT & FREIGHT */}
                <div className="step-card">
                  <div className="step-card-header">
                    <div className="step-badge">3</div>
                    <div className="step-card-title">
                      <h3>Weight &amp; Freight <span className="badge-required">Required</span></h3>
                      <p>Enter shipment weight — freight amount auto-calculates from the route rate.</p>
                    </div>
                  </div>
                  <div className="step-card-body">
                    <div className="field-row">
                      <div className="form-group">
                        <label>Weight (kgs)</label>
                        <input type="number" step="1" placeholder="0" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
                        {selectedLocationConfig?.rate_per_kg && form.weight && Number(form.weight) > 0 && (
                          <div className="helper-hint info">
                            {Number(form.weight)} × ₹{Number(selectedLocationConfig.rate_per_kg).toLocaleString("en-IN")} = ₹{(Number(form.weight) * Number(selectedLocationConfig.rate_per_kg)).toLocaleString("en-IN")}
                          </div>
                        )}
                      </div>
                      <div className="form-group">
                        <label>Freight Amount (₹)</label>
                        <input type="number" step="1" placeholder="0" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} />
                        {computedFreightAmount ? (
                          <div className="helper-hint success">✓ Auto-filled — change if needed.</div>
                        ) : (
                          <div className="helper-hint">Set route rate &amp; weight to auto-fill, or type manually.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* STEP 4 — EXPENSES (OPTIONAL) */}
                <div className="step-card optional">
                  <div className="step-card-header">
                    <div className="step-badge">4</div>
                    <div className="step-card-title">
                      <h3>Expenses <span className="badge-optional">Optional</span></h3>
                      <p>Add BOM and other expenses linked to this shipment.</p>
                    </div>
                  </div>
                  <div className="step-card-body">
                    <div className="field-row">
                      <div className="form-group">
                        <label>BOM Expense (₹)</label>
                        <input type="number" step="1" placeholder="0" value={form.bom_expense} onChange={(e) => setForm({ ...form, bom_expense: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>BOM Description</label>
                        <input placeholder="What was the expense for?" value={form.bom_exp_description} onChange={(e) => setForm({ ...form, bom_exp_description: e.target.value })} />
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="form-group">
                        <label>Other Expense (₹)</label>
                        <input type="number" step="1" placeholder="0" value={form.other_expense} onChange={(e) => setForm({ ...form, other_expense: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label>Other Description</label>
                        <input placeholder="Description of expense" value={form.other_exp_description} onChange={(e) => setForm({ ...form, other_exp_description: e.target.value })} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* STEP 5 — EXTRA CHARGES (toggle pills + sub-panels) */}
                <div className="step-card optional">
                  <div className="step-card-header">
                    <div className="step-badge">5</div>
                    <div className="step-card-title">
                      <h3>
                        Extra Charges
                        <span className="badge-optional">Optional</span>
                        {extrasActive && extrasTotal > 0 && (
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#4338ca", background: "#eef0fa", padding: "2px 8px", borderRadius: 999 }}>
                            ₹{extrasTotal.toLocaleString("en-IN")}
                          </span>
                        )}
                      </h3>
                      <p>Toggle any charges that apply — packaging, delivery, pickup, or other line items.</p>
                    </div>
                  </div>
                  <div className="step-card-body">
                    <div className="extras-toggle-row">
                      <label className={`extras-toggle-pill ${form.show_packaging ? "active" : ""}`}>
                        <span className="pill-icon">📦</span>
                        <span>Box &amp; Packaging</span>
                        <input type="checkbox" checked={form.show_packaging}
                          onChange={(e) => setForm({ ...form, show_packaging: e.target.checked })} />
                      </label>
                      <label className={`extras-toggle-pill ${form.show_delivery ? "active" : ""}`}>
                        <span className="pill-icon">🚛</span>
                        <span>Delivery Charges</span>
                        <input type="checkbox" checked={form.show_delivery}
                          onChange={(e) => setForm({ ...form, show_delivery: e.target.checked })} />
                      </label>
                      <label className={`extras-toggle-pill ${form.show_pickup ? "active" : ""}`}>
                        <span className="pill-icon">🚚</span>
                        <span>Pickup Charges</span>
                        <input type="checkbox" checked={form.show_pickup}
                          onChange={(e) => setForm({ ...form, show_pickup: e.target.checked })} />
                      </label>
                      <label className={`extras-toggle-pill ${form.show_other ? "active" : ""}`}>
                        <span className="pill-icon">💰</span>
                        <span>Other Charges</span>
                        <input type="checkbox" checked={form.show_other}
                          onChange={(e) => setForm({ ...form, show_other: e.target.checked })} />
                      </label>
                      <label className={`extras-toggle-pill ${form.show_remark ? "active" : ""}`}>
                        <span className="pill-icon">📝</span>
                        <span>Remark / Note</span>
                        <input type="checkbox" checked={form.show_remark}
                          onChange={(e) => setForm({ ...form, show_remark: e.target.checked })} />
                      </label>
                    </div>

                    {/* Box & Packaging sub-panel */}
                    {form.show_packaging && (
                      <div className="extras-subsection">
                        <div className="extras-subsection-title">📦 Box &amp; Packaging</div>
                        <div className="form-group" style={{ marginBottom: 10 }}>
                          <label style={{ fontSize: 12, fontWeight: 600 }}>Packaging Type</label>
                          <select
                            value={form.packaging_mode}
                            onChange={(e) => setForm({ ...form, packaging_mode: e.target.value })}
                          >
                            <option value="box">Standard Box</option>
                            <option value="ice_box">Ice-Box (Custom Amount)</option>
                            <option value="only_boxes">Only Boxes</option>
                          </select>
                        </div>
                        {form.packaging_mode === "ice_box" ? (
                          <div className="field-row">
                            <div className="form-group" style={{ marginBottom: 10 }}>
                              <label style={{ fontSize: 12, fontWeight: 600 }}>Name / Type</label>
                              <input placeholder="e.g. Ice-Box - Small"
                                value={form.packaging_name}
                                onChange={(e) => setForm({ ...form, packaging_name: e.target.value })} />
                            </div>
                            <div className="form-group" style={{ marginBottom: 10 }}>
                              <label style={{ fontSize: 12, fontWeight: 600 }}>Amount (₹)</label>
                              <input type="number" step="1" placeholder="0"
                                value={form.packaging_amount} onChange={(e) => setForm({ ...form, packaging_amount: e.target.value })} />
                            </div>
                          </div>
                        ) : form.packaging_mode === "only_boxes" ? (
                          <div className="field-row">
                            <div className="form-group" style={{ marginBottom: 10 }}>
                              <label style={{ fontSize: 12, fontWeight: 600 }}>Number of Boxes</label>
                              <input type="number" step="1" value={form.total_boxes} onChange={(e) => setForm({ ...form, total_boxes: e.target.value })} />
                            </div>
                          </div>
                        ) : (
                          <div className="field-row">
                            <div className="form-group" style={{ marginBottom: 10 }}>
                              <label style={{ fontSize: 12, fontWeight: 600 }}>Number of Boxes</label>
                              <input type="number" step="1" value={form.boxes} onChange={(e) => setForm({ ...form, boxes: e.target.value })} />
                            </div>
                            <div className="form-group" style={{ marginBottom: 10 }}>
                              <label style={{ fontSize: 12, fontWeight: 600 }}>Rate per Box (₹)</label>
                              <input type="number" step="1" value={form.box_rate} onChange={(e) => setForm({ ...form, box_rate: e.target.value })} />
                            </div>
                          </div>
                        )}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                          <div className="helper-hint info" style={{ margin: 0 }}>
                            {form.packaging_mode === "ice_box"
                              ? <>{form.packaging_name || "Ice-Box"} = <strong>₹{Number(form.packaging_amount) || 0}</strong></>
                              : form.packaging_mode === "only_boxes"
                                ? <>Reflected in invoice Boxes column. <strong>No charge applied.</strong></>
                                : <>{Number(form.boxes) || 0} × ₹{Number(form.box_rate) || 0} = <strong>₹{(Number(form.boxes) || 0) * (Number(form.box_rate) || 0)}</strong></>}
                          </div>
                          {form.packaging_mode !== "only_boxes" && (
                            <button type="button" className="btn btn-primary btn-sm" onClick={upsertPackagingEntry}>
                              {form.packaging_edit_index !== null ? "Update Entry" : "+ Add Entry"}
                            </button>
                          )}
                        </div>
                        {form.packaging_mode !== "only_boxes" && form.packaging_entries.length > 0 && (
                          <div className="entry-list">
                            <div className="entry-list-header">Added ({form.packaging_entries.length})</div>
                            {form.packaging_entries.map((entry, i) => {
                              const amount = entry.kind === "ice_box"
                                ? (Number(entry.amount) || 0)
                                : (Number(entry.boxes) || 0) * (Number(entry.rate) || 0);
                              return (
                                <div key={i} className="entry-row">
                                  <span className="entry-row-label">{entry.kind === "ice_box" ? `Ice-Box${entry.name ? ` · ${entry.name}` : ""}` : `${entry.boxes} box × ₹${entry.rate}`}</span>
                                  <div className="entry-row-actions">
                                    <span className="entry-row-amount">₹{amount}</span>
                                    <button type="button" className="btn btn-sm btn-secondary"
                                      onClick={() => setForm({
                                        ...form,
                                        packaging_mode: entry.kind || "box",
                                        packaging_name: String(entry.name || ""),
                                        packaging_amount: String(entry.amount || ""),
                                        boxes: String(entry.boxes || "1"),
                                        box_rate: String(entry.rate || "150"),
                                        packaging_edit_index: i,
                                      })}
                                    >Edit</button>
                                    <button type="button" className="btn btn-sm btn-danger"
                                      onClick={() => setForm({
                                        ...form,
                                        packaging_entries: form.packaging_entries.filter((_, idx) => idx !== i),
                                        packaging_edit_index: form.packaging_edit_index === i ? null : form.packaging_edit_index,
                                      })}
                                    >Delete</button>
                                  </div>
                                </div>
                              );
                            })}
                            <div className="entry-subtotal">
                              Subtotal: ₹{form.packaging_entries.reduce((sum, entry) => sum + (
                                entry.kind === "ice_box"
                                  ? (Number(entry.amount) || 0)
                                  : ((Number(entry.boxes) || 0) * (Number(entry.rate) || 0))
                              ), 0).toLocaleString("en-IN")}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Delivery Charges sub-panel — mirror of Pickup */}
                    {form.show_delivery && (
                      <div className="extras-subsection">
                        <div className="extras-subsection-title">🚛 Delivery Charges</div>
                        <div className="field-row">
                          <div className="form-group" style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: 12, fontWeight: 600 }}>Rate per Delivery (₹)</label>
                            <input type="number" value={form.delivery_rate} onChange={(e) => setForm({ ...form, delivery_rate: e.target.value })} />
                          </div>
                          <div className="form-group" style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: 12, fontWeight: 600 }}>Select Person</label>
                            <select value={form.delivery_selected_name}
                              onChange={(e) => setForm({ ...form, delivery_selected_name: e.target.value })}>
                              <option value="">Choose a person…</option>
                              {deliveryRoster.map((name, i) => <option key={i} value={name}>{name}</option>)}
                            </select>
                          </div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                          <button type="button" className="btn btn-primary btn-sm" onClick={upsertDeliveryEntry}>
                            {form.delivery_edit_index !== null ? "Update Entry" : "+ Add Entry"}
                          </button>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                          <input style={{ flex: 1 }}
                            placeholder="Add new person to saved list"
                            value={form.delivery_new_name}
                            onChange={(e) => setForm({ ...form, delivery_new_name: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && form.delivery_new_name.trim()) {
                                e.preventDefault();
                                const updated = [...deliveryRoster, form.delivery_new_name.trim()];
                                setDeliveryRoster(updated);
                                localStorage.setItem("delivery_roster", JSON.stringify(updated));
                                setForm({ ...form, delivery_new_name: "" });
                              }
                            }} />
                          <button type="button" className="btn btn-secondary btn-sm"
                            onClick={() => {
                              if (form.delivery_new_name.trim()) {
                                const updated = [...deliveryRoster, form.delivery_new_name.trim()];
                                setDeliveryRoster(updated);
                                localStorage.setItem("delivery_roster", JSON.stringify(updated));
                                setForm({ ...form, delivery_new_name: "" });
                              }
                            }}>+ Save Name</button>
                        </div>
                        {form.delivery_entries.length > 0 && (
                          <div className="entry-list">
                            <div className="entry-list-header">Added ({form.delivery_entries.length})</div>
                            {form.delivery_entries.map((entry, i) => (
                              <div key={i} className="entry-row">
                                <span className="entry-row-label">Delivery · <strong>{entry.name}</strong></span>
                                <div className="entry-row-actions">
                                  <span className="entry-row-amount">₹{Number(entry.rate) || 0}</span>
                                  <button type="button" className="btn btn-sm btn-secondary"
                                    onClick={() => setForm({
                                      ...form,
                                      delivery_selected_name: entry.name,
                                      delivery_rate: String(entry.rate || "600"),
                                      delivery_edit_index: i,
                                    })}>Edit</button>
                                  <button type="button" className="btn btn-sm btn-danger"
                                    onClick={() => setForm({
                                      ...form,
                                      delivery_entries: form.delivery_entries.filter((_, idx) => idx !== i),
                                      delivery_edit_index: form.delivery_edit_index === i ? null : form.delivery_edit_index,
                                    })}>Delete</button>
                                </div>
                              </div>
                            ))}
                            <div className="entry-subtotal">
                              Subtotal: ₹{form.delivery_entries.reduce((sum, entry) => sum + (Number(entry.rate) || 0), 0).toLocaleString("en-IN")}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Pickup Charges sub-panel */}
                    {form.show_pickup && (
                      <div className="extras-subsection">
                        <div className="extras-subsection-title">🚚 Pickup Charges</div>
                        <div className="field-row">
                          <div className="form-group" style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: 12, fontWeight: 600 }}>Rate per Pickup (₹)</label>
                            <input type="number" value={form.pickup_rate} onChange={(e) => setForm({ ...form, pickup_rate: e.target.value })} />
                          </div>
                          <div className="form-group" style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: 12, fontWeight: 600 }}>Select Person</label>
                            <select value={form.pickup_selected_name}
                              onChange={(e) => setForm({ ...form, pickup_selected_name: e.target.value })}>
                              <option value="">Choose a person…</option>
                              {pickupRoster.map((name, i) => <option key={i} value={name}>{name}</option>)}
                            </select>
                          </div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                          <button type="button" className="btn btn-primary btn-sm" onClick={upsertPickupEntry}>
                            {form.pickup_edit_index !== null ? "Update Entry" : "+ Add Entry"}
                          </button>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                          <input style={{ flex: 1 }}
                            placeholder="Add new person to saved list"
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
                          <button type="button" className="btn btn-secondary btn-sm"
                            onClick={() => {
                              if (form.pickup_new_name.trim()) {
                                const updated = [...pickupRoster, form.pickup_new_name.trim()];
                                setPickupRoster(updated);
                                localStorage.setItem("pickup_roster", JSON.stringify(updated));
                                setForm({ ...form, pickup_new_name: "" });
                              }
                            }}>+ Save Name</button>
                        </div>
                        {form.pickup_entries.length > 0 && (
                          <div className="entry-list">
                            <div className="entry-list-header">Added ({form.pickup_entries.length})</div>
                            {form.pickup_entries.map((entry, i) => (
                              <div key={i} className="entry-row">
                                <span className="entry-row-label">Pickup · <strong>{entry.name}</strong></span>
                                <div className="entry-row-actions">
                                  <span className="entry-row-amount">₹{Number(entry.rate) || 0}</span>
                                  <button type="button" className="btn btn-sm btn-secondary"
                                    onClick={() => setForm({
                                      ...form,
                                      pickup_selected_name: entry.name,
                                      pickup_rate: String(entry.rate || "600"),
                                      pickup_edit_index: i,
                                    })}>Edit</button>
                                  <button type="button" className="btn btn-sm btn-danger"
                                    onClick={() => setForm({
                                      ...form,
                                      pickup_entries: form.pickup_entries.filter((_, idx) => idx !== i),
                                      pickup_edit_index: form.pickup_edit_index === i ? null : form.pickup_edit_index,
                                    })}>Delete</button>
                                </div>
                              </div>
                            ))}
                            <div className="entry-subtotal">
                              Subtotal: ₹{form.pickup_entries.reduce((sum, entry) => sum + (Number(entry.rate) || 0), 0).toLocaleString("en-IN")}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Other Charges sub-panel */}
                    {form.show_other && (
                      <div className="extras-subsection">
                        <div className="extras-subsection-title">💰 Other Charges</div>
                        <div className="field-row">
                          <div className="form-group" style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: 12, fontWeight: 600 }}>Description</label>
                            <input placeholder="What's this charge for?"
                              value={form.other_desc} onChange={(e) => setForm({ ...form, other_desc: e.target.value })} />
                          </div>
                          <div className="form-group" style={{ marginBottom: 10 }}>
                            <label style={{ fontSize: 12, fontWeight: 600 }}>Amount (₹)</label>
                            <input type="number" value={form.other_amount} onChange={(e) => setForm({ ...form, other_amount: e.target.value })} />
                          </div>
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                          <button type="button" className="btn btn-primary btn-sm" onClick={upsertOtherEntry}>
                            {form.other_edit_index !== null ? "Update Entry" : "+ Add Entry"}
                          </button>
                        </div>
                        {form.other_entries.length > 0 && (
                          <div className="entry-list">
                            <div className="entry-list-header">Added ({form.other_entries.length})</div>
                            {form.other_entries.map((entry, i) => (
                              <div key={i} className="entry-row">
                                <span className="entry-row-label">{entry.description}</span>
                                <div className="entry-row-actions">
                                  <span className="entry-row-amount">₹{Number(entry.amount) || 0}</span>
                                  <button type="button" className="btn btn-sm btn-secondary"
                                    onClick={() => setForm({
                                      ...form,
                                      other_desc: entry.description,
                                      other_amount: String(entry.amount || ""),
                                      other_edit_index: i,
                                    })}>Edit</button>
                                  <button type="button" className="btn btn-sm btn-danger"
                                    onClick={() => setForm({
                                      ...form,
                                      other_entries: form.other_entries.filter((_, idx) => idx !== i),
                                      other_edit_index: form.other_edit_index === i ? null : form.other_edit_index,
                                    })}>Delete</button>
                                </div>
                              </div>
                            ))}
                            <div className="entry-subtotal">
                              Subtotal: ₹{form.other_entries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0).toLocaleString("en-IN")}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Remark / Note sub-panel — text-only, no amount, prints in invoice */}
                    {form.show_remark && (
                      <div className="extras-subsection">
                        <div className="extras-subsection-title">📝 Remark / Note</div>
                        <div className="form-group" style={{ marginBottom: 0 }}>
                          <label style={{ fontSize: 12, fontWeight: 600 }}>This text will appear in the invoice PDF as a description-only row (no amount).</label>
                          <textarea
                            rows={3}
                            placeholder="e.g. Payment due within 15 days. Cheques in favour of Swati Tours & Transport."
                            value={form.remark}
                            onChange={(e) => setForm({ ...form, remark: e.target.value })}
                            style={{ resize: "vertical", minHeight: 70 }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* STEP 6 — PAYMENT STATUS */}
                <div className="step-card">
                  <div className="step-card-header">
                    <div className="step-badge">6</div>
                    <div className="step-card-title">
                      <h3>Payment Status</h3>
                      <p>Mark whether payment has been received for this bill.</p>
                    </div>
                  </div>
                  <div className="step-card-body">
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label>Status</label>
                      <select value={form.payment_status} onChange={(e) => setForm({ ...form, payment_status: e.target.value })}>
                        <option value="NOTPAID">Not Paid</option>
                        <option value="PAID">Paid</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* STICKY FOOTER — GRAND TOTAL + ACTIONS */}
              <div className="friendly-modal-footer">
                <div className="footer-summary">
                  <span className="label">Grand Total{extrasActive && extrasCount > 0 ? ` (incl. ${extrasCount} extra${extrasCount > 1 ? "s" : ""})` : ""}</span>
                  <span className="value">₹{grandTotal.toLocaleString("en-IN")}</span>
                </div>
                <div className="form-actions" style={{ marginTop: 0 }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">{editing ? "Save Changes" : "Create Billing"}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
        );
      })()}
      {showPartyModal && (
        <div className="modal-overlay" onClick={closePartyManager}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              Manage {partyType === "consigner" ? "Consigners" : "Consignees"}
            </h2>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button
                type="button"
                className="btn btn-sm"
                style={{ background: partyType === "consigner" ? "#4361ee" : "#ddd", color: partyType === "consigner" ? "#fff" : "#333" }}
                onClick={() => {
                  setPartyType("consigner");
                  setPartyEditingIndex(null);
                  setPartyForm({ name: "", address: "", mobile: "" });
                }}
              >
                Consigners
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{ background: partyType === "consignee" ? "#4361ee" : "#ddd", color: partyType === "consignee" ? "#fff" : "#333" }}
                onClick={() => {
                  setPartyType("consignee");
                  setPartyEditingIndex(null);
                  setPartyForm({ name: "", address: "", mobile: "" });
                }}
              >
                Consignees
              </button>
            </div>

            <form onSubmit={handleSaveParty}>
              <div className="form-group">
                <label>Name</label>
                <input
                  value={partyForm.name}
                  onChange={(e) => setPartyForm({ ...partyForm, name: e.target.value.toUpperCase() })}
                  placeholder="Name"
                  required
                />
              </div>
              <div className="form-group">
                <label>Address</label>
                <textarea
                  rows={3}
                  value={partyForm.address}
                  onChange={(e) => setPartyForm({ ...partyForm, address: e.target.value })}
                  placeholder="Address"
                />
              </div>
              <div className="form-group">
                <label>Mobile No.</label>
                <input
                  value={partyForm.mobile}
                  onChange={(e) => setPartyForm({ ...partyForm, mobile: e.target.value })}
                  placeholder="Mobile number"
                />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={closePartyManager}>Close</button>
                <button type="submit" className="btn btn-primary">{partyEditingIndex != null ? "Update" : "Add"}</button>
              </div>
            </form>

            <div style={{ marginTop: 14, borderTop: "1px solid #eee", paddingTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                Saved {partyType === "consigner" ? "Consigners" : "Consignees"}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
                {getCurrentPartyList().length === 0 ? (
                  <div style={{ fontSize: 12, color: "#888" }}>No records found.</div>
                ) : (
                  getCurrentPartyList().map((party, index) => (
                    <div key={`${party.name}-${index}`} style={{ border: "1px solid #e5e5e5", borderRadius: 8, padding: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>{formatPartyName(party.name)}</div>
                      <div style={{ fontSize: 11, color: "#555", whiteSpace: "pre-wrap" }}>{party.address || "-"}</div>
                      <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>{party.mobile || "-"}</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" className="btn btn-sm btn-secondary" onClick={() => startEditParty(index)}>Edit</button>
                        <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDeleteParty(index)}>Delete</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
