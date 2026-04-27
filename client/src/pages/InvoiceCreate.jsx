import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import JsBarcode from "jsbarcode";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import defaultStamp, { getDefaultStamp } from "../defaultStamp";

const defaultLocations = [
  { route: "BOM-PUNE", rate_per_kg: "" },
  { route: "PUNE-BOM", rate_per_kg: "" },
  { route: "BOM-GOA", rate_per_kg: "" },
  { route: "GOA-BOM", rate_per_kg: "" },
  { route: "IDR-BOM", rate_per_kg: "" },
  { route: "BOM-IDR", rate_per_kg: "" },
];

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

function normalizePackagingEntries(inv) {
  if (Array.isArray(inv?.packaging_entries) && inv.packaging_entries.length > 0) {
    return inv.packaging_entries
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
  if (inv?.show_packaging) {
    return [{
      kind: "box",
      name: "",
      boxes: String(inv?.boxes || "1"),
      rate: String(inv?.box_rate || "150"),
      amount: "",
    }];
  }
  return [];
}

function normalizeDeliveryEntries(inv) {
  if (!Array.isArray(inv?.delivery_entries)) return [];
  return inv.delivery_entries
    .map((entry) => {
      if (typeof entry === "string") {
        return { name: entry, rate: String(inv?.delivery_rate || "600") };
      }
      return {
        name: String(entry?.name || entry?.person || ""),
        rate: String(entry?.rate ?? inv?.delivery_rate ?? "600"),
      };
    })
    .filter((entry) => entry.name.trim());
}

function normalizePickupEntries(inv) {
  if (!Array.isArray(inv?.pickup_entries)) return [];
  return inv.pickup_entries
    .map((entry) => {
      if (typeof entry === "string") {
        return { name: entry, rate: String(inv?.pickup_rate || "600") };
      }
      return {
        name: String(entry?.name || entry?.person || ""),
        rate: String(entry?.rate ?? inv?.pickup_rate ?? "600"),
      };
    })
    .filter((entry) => entry.name.trim());
}

function normalizeOtherEntries(inv) {
  if (Array.isArray(inv?.other_entries) && inv.other_entries.length > 0) {
    return inv.other_entries
      .map((entry) => ({
        description: String(entry?.description || entry?.desc || ""),
        amount: String(entry?.amount ?? ""),
      }))
      .filter((entry) => entry.description.trim() || Number(entry.amount) > 0);
  }
  if (inv?.show_other && inv?.other_desc) {
    return [{
      description: String(inv.other_desc || ""),
      amount: String(inv.other_amount || ""),
    }];
  }
  return [];
}

function getLegacyExtraFields(source) {
  const packagingEntries = normalizePackagingEntries(source);
  const pickupEntries = normalizePickupEntries(source);
  const otherEntries = normalizeOtherEntries(source);
  const firstBoxPackaging = packagingEntries.find((entry) => entry.kind !== "ice_box") || {};
  return {
    box_rate: firstBoxPackaging.rate ? String(firstBoxPackaging.rate) : "150",
    pickup_rate: pickupEntries[0]?.rate ? String(pickupEntries[0].rate) : "600",
    other_desc: otherEntries[0]?.description ? String(otherEntries[0].description) : "",
    other_amount: otherEntries[0]?.amount ? String(otherEntries[0].amount) : "",
  };
}

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

const getNextInvoiceNo = () => {
  const key = "invoice_counter";
  return String(parseInt(localStorage.getItem(key) || "1629", 10) + 1);
};
const saveInvoiceNo = (num) => localStorage.setItem("invoice_counter", String(num));

export default function InvoiceCreate() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const autoDownload = searchParams.get("autodownload");
  const invoiceDateInputRef = useRef(null);
  const [locations, setLocations] = useState(() => {
    const saved = localStorage.getItem("billing_locations");
    return saved ? normalizeLocations(JSON.parse(saved)) : [...defaultLocations];
  });
  const [newLocation, setNewLocation] = useState("");
  const barcodeRef = useRef(null);
  const [stampImg, setStampImg] = useState("");
  const stampInputRef = useRef(null);

  // Load stamp: localStorage first, then bundled /stamp_image.png, then SVG fallback
  useEffect(() => {
    const saved = localStorage.getItem("stamp_image");
    if (saved) {
      setStampImg(saved);
      return;
    }
    setStampImg(defaultStamp);
    getDefaultStamp().then((url) => setStampImg(url));
  }, []);

  const handleStampUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result;
      localStorage.setItem("stamp_image", base64);
      setStampImg(base64);
    };
    reader.readAsDataURL(file);
  };

  const [inv, setInv] = useState({
    invoice_no: "",
    date: "",
    route: "",
    client_name: "Equinox Labs Pvt.Ltd",
    client_address: " Center, R65, TTC, Rabale, Navi Mumbai, Maharashtra 400701",
    client_phone: "+91 7588712196",
    consigner_name: "SWATI TOURS & TRANSPORT",
    consigner_address: "A-902, DREAM CARNIVAL, NEAR PNG JEWELLERS, CHAROLI, PUNE-412105",
    consigner_mobile: "+91 8291301603",
    consignee_name: "Equinox Labs Pvt.Ltd",
    consignee_address: " Center, R65, TTC, Rabale, Navi Mumbai, Maharashtra 400701",
    consignee_mobile: "+91 7588712196",
    weight: "",
    boxes: "1",
    contain: "water\nsample",
    rate_per_kg: "",
    box_rate: "150",
    show_packaging: false,
    packaging_mode: "box",
    packaging_name: "",
    packaging_amount: "",
    packaging_entries: [],
    packaging_edit_index: null,
    // Delivery Charges (list of {name, rate})
    show_delivery: false,
    delivery_roster: ["Ankit P", "Ravi K", "Suresh M"],
    delivery_new_name: "",
    delivery_entries: [],
    delivery_selected_name: "",
    delivery_edit_index: null,
    delivery_rate: "600",
    // Pickup Charges
    show_pickup: false,
    pickup_roster: ["Ankit Yadav", "Dhiraj Maske", "Tirath Mali"],
    pickup_new_name: "",
    pickup_entries: [],
    pickup_selected_name: "",
    pickup_edit_index: null,
    pickup_rate: "600",
    // Other Charges
    show_other: false,
    other_desc: "",
    other_amount: "",
    other_entries: [],
    other_edit_index: null,
    // Remark / Note — text-only line shown in invoice description column (no amount)
    show_remark: false,
    remark: "",
    // Editable header & footer fields
    company_name: "SWATI TOURS & TRANSPORT",
    company_address: "A-902, DREAM CARNIVAL, NEAR PNG JEWELLERS, CHAROLI, PUNE-412105",
    company_contact: "Contact: 8291301603 | Email: pune.stt@gmail.com",
    company_pan: "UAM MH19D0152647 / PAN BSNPP7564G",
    service_desc: "Bill for Providing Services for",
    service_suffix: "sending\u00A0\u00A0sample",
    signature_label: "For Swati Tours & Transport",
    bank_name: "Bank of India",
    bank_account_holder: "Swati Tours and Transport",
    bank_account_no: "061320110001257",
    bank_ifsc: "BKID0000613",
    bank_branch: "Vishrantwadi, Pune",
    received_name: "",
    received_date: "",
    // Monthly Billing Invoice
    is_monthly: false,
    monthly_amount: "",
    monthly_from: "",
    monthly_to: "",
  });

  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      // Check if opening a saved invoice from billing
      const saved = localStorage.getItem("open_invoice");
      if (saved) {
        try {
          const data = JSON.parse(saved);
          // Ignore any stamp baked into a previously-saved invoice — old bills carry the
          // old stamp inside their JSON, and we don't want them to overwrite localStorage
          // (or the screen) with the outdated image. The current stamp loaded above by
          // getDefaultStamp() / localStorage stays in effect.
          if (data.stamp_image) delete data.stamp_image;
          setInv((prev) => ({
            ...prev,
            ...data,
            consignee_name: data.consignee_name || data.client_name || prev.consignee_name,
            consignee_address: data.consignee_address || data.client_address || prev.consignee_address,
            consignee_mobile: data.consignee_mobile || data.client_phone || prev.consignee_mobile,
          }));
        } catch (e) { /* ignore */ }
        localStorage.removeItem("open_invoice");
      } else {
        setInv((prev) => ({ ...prev, invoice_no: getNextInvoiceNo() }));
      }
    }
  }, []);

  const weight = Number(inv.weight) || 0;
  const rate = Number(inv.rate_per_kg) || 0;
  const boxes = Number(inv.boxes) || 0;
  const boxRate = Number(inv.box_rate) || 150;
  const weightAmount = weight * rate;
  const packagingEntries = normalizePackagingEntries(inv);
  const packagingAmount = packagingEntries.reduce((sum, entry) => sum + (
    entry.kind === "ice_box"
      ? (Number(entry.amount) || 0)
      : ((Number(entry.boxes) || 0) * (Number(entry.rate) || 0))
  ), 0);
  const deliveryEntries = normalizeDeliveryEntries(inv);
  const deliveryTotal = deliveryEntries.reduce((sum, entry) => sum + (Number(entry.rate) || 0), 0);
  const pickupEntries = normalizePickupEntries(inv);
  const pickupTotal = pickupEntries.reduce((sum, entry) => sum + (Number(entry.rate) || 0), 0);
  const otherEntries = normalizeOtherEntries(inv);
  const otherAmount = otherEntries.reduce((sum, entry) => sum + (Number(entry.amount) || 0), 0);
  const monthlyAmount = Number(inv.monthly_amount) || 0;
  const baseAmount = inv.is_monthly ? monthlyAmount : weightAmount;
  const totalAmount = baseAmount
    + (inv.show_packaging ? packagingAmount : 0)
    + (inv.show_delivery ? deliveryTotal : 0)
    + (inv.show_pickup ? pickupTotal : 0)
    + (inv.show_other ? otherAmount : 0);

  // Monthly label helpers
  const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const monthlyLabel = (() => {
    const src = inv.monthly_from || inv.monthly_to;
    if (!src) return "";
    const d = new Date(src + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    return `${MONTH_FULL[d.getMonth()].toUpperCase()} ${d.getFullYear()}`;
  })();
  const fmtDMY = (s) => {
    if (!s) return "";
    const d = new Date(s + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}-${mm}-${d.getFullYear()}`;
  };
  const normalizedServiceDesc = (inv.service_desc || "").trim();
  const routeDisplay = inv.route ? inv.route.replace("-", " to ") : "";
  const safeRouteFileName = (inv.route || "LOCATION")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim() || "LOCATION";
  const safeClientFileName = (inv.consignee_name || inv.client_name || "CLIENT")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim() || "CLIENT";
  const [routeStart = "", routeEnd = ""] = routeDisplay.split(/\s+to\s+/i);
  const servicePdfLine1 = [normalizedServiceDesc, routeStart].filter(Boolean).join(" ").trim();
  const servicePdfLine2 = [
    routeEnd ? `to ${routeEnd}` : "",
    (inv.service_suffix || "").trim(),
  ].filter(Boolean).join(" ").trim();
  const dateObj = inv.date ? new Date(inv.date + "T00:00:00") : null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateStr = dateObj
    ? dateObj.getDate().toString().padStart(2, "0") + "-" + months[dateObj.getMonth()] + "-" + String(dateObj.getFullYear()).slice(-2)
    : "";
  const amtWords = totalAmount > 0 ? numberToWords(Math.floor(totalAmount)) + " Rupees Only" : "";
  /* Render barcode whenever invoice_no or layout (monthly toggle) changes */
  useEffect(() => {
    if (barcodeRef.current && inv.invoice_no) {
      try {
        JsBarcode(barcodeRef.current, String(inv.invoice_no), {
          format: "CODE128",
          width: 1.6,
          height: 36,
          displayValue: false,
          margin: 2,
          background: "transparent",
        });
      } catch (e) { /* ignore */ }
    }
  }, [inv.invoice_no, inv.is_monthly]);

  /* Monthly mode: auto-set invoice_no as STT/MM/YY based on month being billed */
  useEffect(() => {
    if (!inv.is_monthly) return;
    const src = inv.monthly_from || inv.monthly_to;
    if (!src) return;
    const d = new Date(src + "T00:00:00");
    if (isNaN(d.getTime())) return;
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    const expected = `STT/${mm}/${yy}`;
    if (inv.invoice_no !== expected) {
      setInv((prev) => ({ ...prev, invoice_no: expected }));
    }
  }, [inv.is_monthly, inv.monthly_from, inv.monthly_to]);

  // Auto-download PDF when navigated from Billing with ?autodownload param
  const autoDownloadDone = useRef(false);
  useEffect(() => {
    if (autoDownload && inv.invoice_no && !autoDownloadDone.current) {
      autoDownloadDone.current = true;
      // Wait for barcode and layout to fully render
      const timer = setTimeout(async () => {
        await downloadPDF();
        navigate("/billing", { replace: true });
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [autoDownload, inv.invoice_no]);

  const addRoute = () => {
    const val = newLocation.trim().toUpperCase();
    if (val && !locations.some((loc) => loc.route === val)) {
      const updated = [...locations, { route: val, rate_per_kg: "" }];
      setLocations(updated);
      localStorage.setItem("billing_locations", JSON.stringify(updated));
      setInv({ ...inv, route: val });
      setNewLocation("");
    }
  };

  const upsertPackagingEntry = () => {
    const nextEntry = inv.packaging_mode === "ice_box"
      ? {
        kind: "ice_box",
        name: inv.packaging_name.trim(),
        boxes: "",
        rate: "",
        amount: String(inv.packaging_amount || "").trim(),
      }
      : {
        kind: "box",
        name: "",
        boxes: String(inv.boxes || "").trim(),
        rate: String(inv.box_rate || "").trim(),
        amount: "",
      };
    if (
      (nextEntry.kind === "ice_box" && (!nextEntry.name || !nextEntry.amount))
      || (nextEntry.kind === "box" && (!nextEntry.boxes || !nextEntry.rate))
    ) return;
    const nextEntries = [...packagingEntries];
    if (inv.packaging_edit_index !== null) nextEntries[inv.packaging_edit_index] = nextEntry;
    else nextEntries.push(nextEntry);
    setInv({
      ...inv,
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
    const nextEntry = {
      name: inv.pickup_selected_name.trim(),
      rate: String(inv.pickup_rate || "").trim(),
    };
    if (!nextEntry.name || !nextEntry.rate) return;
    const nextEntries = [...pickupEntries];
    if (inv.pickup_edit_index !== null) nextEntries[inv.pickup_edit_index] = nextEntry;
    else nextEntries.push(nextEntry);
    setInv({
      ...inv,
      pickup_entries: nextEntries,
      pickup_selected_name: "",
      pickup_rate: "600",
      pickup_edit_index: null,
    });
  };

  const upsertDeliveryEntry = () => {
    const nextEntry = {
      name: (inv.delivery_selected_name || "").trim(),
      rate: String(inv.delivery_rate || "").trim(),
    };
    if (!nextEntry.name || !nextEntry.rate) return;
    const nextEntries = [...deliveryEntries];
    if (inv.delivery_edit_index !== null) nextEntries[inv.delivery_edit_index] = nextEntry;
    else nextEntries.push(nextEntry);
    setInv({
      ...inv,
      delivery_entries: nextEntries,
      delivery_selected_name: "",
      delivery_rate: "600",
      delivery_edit_index: null,
    });
  };

  const upsertOtherEntry = () => {
    const nextEntry = {
      description: inv.other_desc.trim(),
      amount: String(inv.other_amount || "").trim(),
    };
    if (!nextEntry.description || !nextEntry.amount) return;
    const nextEntries = [...otherEntries];
    if (inv.other_edit_index !== null) nextEntries[inv.other_edit_index] = nextEntry;
    else nextEntries.push(nextEntry);
    setInv({
      ...inv,
      other_entries: nextEntries,
      other_desc: "",
      other_amount: "",
      other_edit_index: null,
    });
  };

  const saveInvoiceToList = () => {
    const existing = JSON.parse(localStorage.getItem("invoices") || "[]");
    const idx = existing.findIndex((e) => e.invoice_no === inv.invoice_no);
    const prev = idx >= 0 ? existing[idx] : {};
    const legacyFields = getLegacyExtraFields(inv);
    const entry = {
      ...prev,
      id: prev.id || Date.now(),
      invoice_no: inv.invoice_no,
      date: inv.date,
      location: inv.route + ((inv.consignee_name || inv.client_name) ? `(${inv.consignee_name || inv.client_name})` : ""),
      consigner_name: (inv.consigner_name || "").toUpperCase(),
      consigner_address: inv.consigner_address || "",
      consigner_mobile: inv.consigner_mobile || "",
      consignee_name: (inv.consignee_name || inv.client_name || "").toUpperCase(),
      consignee_address: inv.consignee_address || inv.client_address || "",
      consignee_mobile: inv.consignee_mobile || inv.client_phone || "",
      weight: weight,
      total_amount: Math.round(totalAmount),
      // Extra charges fields
      show_packaging: inv.show_packaging || false,
      boxes: inv.boxes || "1",
      box_rate: legacyFields.box_rate,
      packaging_entries: packagingEntries,
      show_delivery: inv.show_delivery || false,
      delivery_entries: deliveryEntries,
      delivery_rate: inv.delivery_rate || "600",
      show_pickup: inv.show_pickup || false,
      pickup_entries: pickupEntries,
      pickup_rate: legacyFields.pickup_rate,
      show_other: inv.show_other || false,
      other_desc: legacyFields.other_desc,
      other_amount: legacyFields.other_amount,
      other_entries: otherEntries,
      show_remark: inv.show_remark || Boolean(inv.remark),
      remark: inv.remark || "",
      payment_status: prev.payment_status || "NOTPAID",
      invoice_data: JSON.stringify({ ...inv, stamp_image: stampImg }),
    };
    if (idx >= 0) existing[idx] = entry;
    else existing.unshift(entry);
    localStorage.setItem("invoices", JSON.stringify(existing));
  };

  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    saveInvoiceNo(inv.invoice_no);
    saveInvoiceToList();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handlePrint = () => { handleSave(); window.print(); };

  const invoiceRef = useRef(null);

  const openInvoiceDatePicker = () => {
    const input = invoiceDateInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
    input.focus();
    input.click();
  };

  const downloadPDF = async () => {
    saveInvoiceNo(inv.invoice_no);
    saveInvoiceToList();
    const el = invoiceRef.current;
    if (!el) return;

    const serviceCell = el.querySelector(".service-description-cell");
    let servicePdfPreview = null;
    let serviceEditable = null;
    if (serviceCell) {
      serviceEditable = serviceCell.querySelector(".service-editable");
      servicePdfPreview = document.createElement("div");
      servicePdfPreview.style.cssText = "font-weight:bold; font-size:13px; line-height:1.45; white-space:pre-wrap;";
      servicePdfPreview.innerHTML = `${servicePdfLine1 || "&nbsp;"}<br/>${servicePdfLine2 || "&nbsp;"}`;
      if (serviceEditable) serviceEditable.style.display = "none";
      serviceCell.appendChild(servicePdfPreview);
    }

    // Replace inputs/textareas/selects with plain text spans for clean PDF capture
    const replacements = [];
    el.querySelectorAll("input.edt, textarea.edt-area, textarea.edt, select.edt-select").forEach((field) => {
      const span = document.createElement("span");
      const computed = window.getComputedStyle(field);
      if (field.tagName === "SELECT") {
        span.textContent = field.options[field.selectedIndex]?.text || "";
      } else if (field.tagName === "INPUT" && field.type === "date") {
        span.textContent = fmtDMY(field.value);
      } else {
        span.textContent = field.value;
      }
      const isFullWidth = computed.width === field.parentNode.clientWidth + "px" ||
        field.style.width === "100%";
      span.style.cssText = `
        font-family: ${computed.fontFamily};
        font-size: ${computed.fontSize};
        font-weight: ${computed.fontWeight};
        color: ${computed.color};
        letter-spacing: ${computed.letterSpacing};
        text-align: ${computed.textAlign};
        white-space: pre-wrap;
        display: ${isFullWidth ? "block" : "inline-block"};
        width: ${isFullWidth ? "100%" : "auto"};
      `;
      field.parentNode.insertBefore(span, field);
      field.style.display = "none";
      replacements.push({ field, span });
    });

    await new Promise((r) => setTimeout(r, 50));

    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#fff" });

    // Restore original inputs
    replacements.forEach(({ field, span }) => {
      field.style.display = "";
      span.remove();
    });
    if (servicePdfPreview) servicePdfPreview.remove();
    if (serviceEditable) serviceEditable.style.display = "";

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = (canvas.height * pdfW) / canvas.width;
    pdf.addImage(imgData, "PNG", 0, 0, pdfW, pdfH);
    const fileName = inv.is_monthly
      ? `${safeClientFileName}_${inv.invoice_no}.pdf`
      : `${safeRouteFileName}_${inv.invoice_no}_${dateStr || "draft"}.pdf`;
    pdf.save(fileName);
  };

  const edt = {
    background: "transparent", border: "none", borderBottom: "1px dashed #999",
    outline: "none", fontFamily: "'Courier New', Courier, monospace", fontWeight: "bold",
    fontSize: 13, padding: "2px 4px",
  };

  return (
    <div>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .main-content { margin-left: 0 !important; padding: 0 !important; }
          .sidebar { display: none !important; }
          body { background: #fff !important; }
          .inv-page { box-shadow: none !important; margin: 0 !important; }
          .edt { border-bottom: none !important; }
          .edt-select { -webkit-appearance: none; appearance: none; border: none !important; background: transparent !important; }
          .edt-area { border: none !important; }
        }
        .inv-page {
          width: 800px; margin: 0 auto; background: #fff; color: #000;
          font-family: 'Courier New', Courier, monospace; font-size: 13px;
          box-shadow: 0 2px 20px rgba(0,0,0,0.12); border: 2px solid #222;
        }
        /* Header */
        .inv-head { text-align: center; padding: 14px 20px 10px; border-bottom: 3px double #222; background: linear-gradient(180deg, #fafafa 0%, #fff 100%); }
        .inv-head h1 { font-size: 20px; font-weight: bold; letter-spacing: 3px; color: #b71c1c; margin: 0 0 4px; font-family: 'Courier New', Courier, monospace; }
        .inv-head .addr { font-size: 11px; line-height: 1.5; margin: 0; color: #333; }
        .inv-head .pan { font-size: 11.5px; font-weight: bold; margin-top: 3px; color: #222; }
        /* Table */
        .it { width: 100%; border-collapse: collapse; position: relative; z-index: 1; }
        .it td { border: 1px solid #333; padding: 6px 10px; vertical-align: top; font-size: 13px; background: transparent; }
        .it .lbl { font-weight: bold; font-size: 12px; background: rgba(245,245,245,0.6); color: #222; letter-spacing: 0.5px; }
        .it .val { font-size: 13px; }
        .edt-select {
          background: transparent; border: none; border-bottom: 1px dashed #999;
          outline: none; font-family: 'Courier New', Courier, monospace;
          font-weight: bold; font-size: 13px; padding: 2px 0; cursor: pointer;
        }
        .monthly-range {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 13px;
        }
      `}</style>

      {/* ===== TOOLBAR ===== */}
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Create Invoice</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            style={{ padding: "8px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 13, width: 180 }}
            placeholder="Add route e.g. NGP-BOM"
            value={newLocation}
            onChange={(e) => setNewLocation(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRoute(); } }}
          />
          <button className="btn btn-sm" style={{ background: "#444", color: "#fff", padding: "8px 14px", borderRadius: 8 }} onClick={addRoute}>+ Route</button>
          <input ref={stampInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleStampUpload} />
          <button className="btn btn-sm" style={{ background: stampImg ? "#28a745" : "#e63946", color: "#fff", padding: "8px 14px", borderRadius: 8 }}
            onClick={() => stampInputRef.current.click()}>{stampImg ? "Stamp Uploaded" : "Upload Stamp"}</button>
          <button className="btn btn-sm"
            style={{ background: inv.is_monthly ? "#6366f1" : "#555", color: "#fff", padding: "8px 14px", borderRadius: 8 }}
            onClick={() => setInv({ ...inv, is_monthly: !inv.is_monthly })}>
            {inv.is_monthly ? "Monthly ✓" : "Monthly Bill"}
          </button>
          <div style={{ position: "relative" }}>
            <button className="btn btn-sm"
              style={{ background: (inv.show_packaging || inv.show_delivery || inv.show_pickup || inv.show_other) ? "#4361ee" : "#555", color: "#fff", padding: "8px 14px", borderRadius: 8 }}
              onClick={() => setInv({ ...inv, showExtrasDropdown: !inv.showExtrasDropdown })}>
              Extra Charges ▾
            </button>
            {inv.showExtrasDropdown && (
              <div style={{ position: "absolute", top: "110%", right: 0, background: "#fff", border: "1px solid #ddd", borderRadius: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.18)", padding: 0, zIndex: 50, width: 340, maxHeight: "70vh", overflowY: "auto" }}>

                {/* --- Box & Packaging --- */}
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong style={{ fontSize: 13 }}>Box &amp; Packaging</strong>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox" checked={inv.show_packaging}
                        onChange={(e) => setInv({ ...inv, show_packaging: e.target.checked })} /> Enable
                    </label>
                  </div>
                  {inv.show_packaging && (
                    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: 11, color: "#555" }}>Packaging Type</label>
                          <select style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                            value={inv.packaging_mode} onChange={(e) => setInv({ ...inv, packaging_mode: e.target.value })}>
                            <option value="box">Box & Packaging</option>
                            <option value="ice_box">Box & Packaging (Ice-Box)</option>
                          </select>
                        </div>
                        {inv.packaging_mode === "ice_box" ? (
                          <>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: 11, color: "#555" }}>Name / Type</label>
                              <input style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                                placeholder="Ice-Box - Small"
                                value={inv.packaging_name} onChange={(e) => setInv({ ...inv, packaging_name: e.target.value })} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: 11, color: "#555" }}>Amount (₹)</label>
                              <input type="number" step="1" style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                                value={inv.packaging_amount} onChange={(e) => setInv({ ...inv, packaging_amount: e.target.value })} />
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: 11, color: "#555" }}>Boxes</label>
                              <input type="number" step="1" style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                                value={inv.boxes} onChange={(e) => setInv({ ...inv, boxes: e.target.value })} />
                            </div>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: 11, color: "#555" }}>Rate per Box (₹)</label>
                              <input type="number" step="1" style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                                value={inv.box_rate} onChange={(e) => setInv({ ...inv, box_rate: e.target.value })} />
                            </div>
                          </>
                        )}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                        <button type="button" className="btn btn-sm" style={{ background: "#4361ee", color: "#fff", padding: "4px 12px", borderRadius: 6, fontSize: 11 }}
                          onClick={upsertPackagingEntry}>
                          {inv.packaging_edit_index !== null ? "Update Entry" : "Add Entry"}
                        </button>
                      </div>
                      <div style={{ fontSize: 12, color: "#555" }}>
                        {inv.packaging_mode === "ice_box"
                          ? <span>{inv.packaging_name || "Ice-Box"} = <strong>₹{Number(inv.packaging_amount) || 0}</strong></span>
                          : <span>{Number(inv.boxes) || 0} box × ₹{Number(inv.box_rate) || 0} = <strong>₹{(Number(inv.boxes) || 0) * (Number(inv.box_rate) || 0)}</strong></span>}
                      </div>
                      {packagingEntries.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <label style={{ fontSize: 11, color: "#555", marginBottom: 4, display: "block" }}>Added ({packagingEntries.length})</label>
                          {packagingEntries.map((entry, i) => {
                            const amount = entry.kind === "ice_box"
                              ? (Number(entry.amount) || 0)
                              : (Number(entry.boxes) || 0) * (Number(entry.rate) || 0);
                            return (
                              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 12, gap: 8 }}>
                                <span>{entry.kind === "ice_box" ? `Box & Packaging (Ice-Box${entry.name ? ` - ${entry.name}` : ""})` : `${entry.boxes} box × ₹${entry.rate}`}</span>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ color: "#555" }}>₹{amount}</span>
                                  <button type="button" className="btn btn-sm" style={{ background: "#f3f4f6", color: "#111", padding: "2px 8px", borderRadius: 6, fontSize: 11 }}
                                    onClick={() => setInv({ ...inv, packaging_mode: entry.kind || "box", packaging_name: String(entry.name || ""), packaging_amount: String(entry.amount || ""), boxes: String(entry.boxes || "1"), box_rate: String(entry.rate || "150"), packaging_edit_index: i })}>
                                    Edit
                                  </button>
                                  <button type="button" className="btn btn-sm" style={{ background: "#fee2e2", color: "#b91c1c", padding: "2px 8px", borderRadius: 6, fontSize: 11 }}
                                    onClick={() => setInv({ ...inv, packaging_entries: packagingEntries.filter((_, idx) => idx !== i), packaging_edit_index: inv.packaging_edit_index === i ? null : inv.packaging_edit_index })}>
                                    Delete
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* --- Delivery Charges (multi-entry, mirrors Pickup Charges) --- */}
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong style={{ fontSize: 13 }}>Delivery Charges</strong>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox" checked={inv.show_delivery}
                        onChange={(e) => setInv({ ...inv, show_delivery: e.target.checked })} /> Enable
                    </label>
                  </div>
                  {inv.show_delivery && (
                    <div>
                      <div style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 11, color: "#555" }}>Rate per Delivery (₹)</label>
                        <input type="number" style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                          value={inv.delivery_rate} onChange={(e) => setInv({ ...inv, delivery_rate: e.target.value })} />
                      </div>

                      <div style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 11, color: "#555" }}>Select Person</label>
                        <select style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                          value={inv.delivery_selected_name} onChange={(e) => setInv({ ...inv, delivery_selected_name: e.target.value })}>
                          <option value="">-- Select name to add --</option>
                          {(inv.delivery_roster || []).map((name, i) => (
                            <option key={i} value={name}>{name}</option>
                          ))}
                        </select>
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                        <button type="button" className="btn btn-sm" style={{ background: "#4361ee", color: "#fff", padding: "4px 12px", borderRadius: 6, fontSize: 11 }}
                          onClick={upsertDeliveryEntry}>
                          {inv.delivery_edit_index !== null ? "Update Entry" : "Add Entry"}
                        </button>
                      </div>

                      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                        <input style={{ flex: 1, padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12 }}
                          placeholder="Add new name to list"
                          value={inv.delivery_new_name || ""}
                          onChange={(e) => setInv({ ...inv, delivery_new_name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && (inv.delivery_new_name || "").trim()) {
                              e.preventDefault();
                              setInv({ ...inv, delivery_roster: [...(inv.delivery_roster || []), inv.delivery_new_name.trim()], delivery_new_name: "" });
                            }
                          }} />
                        <button className="btn btn-sm" style={{ background: "#444", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 11 }}
                          onClick={() => {
                            if ((inv.delivery_new_name || "").trim()) {
                              setInv({ ...inv, delivery_roster: [...(inv.delivery_roster || []), inv.delivery_new_name.trim()], delivery_new_name: "" });
                            }
                          }}>+ Name</button>
                      </div>

                      {deliveryEntries.length > 0 && (
                        <div style={{ marginBottom: 4 }}>
                          <label style={{ fontSize: 11, color: "#555", marginBottom: 4, display: "block" }}>Added ({deliveryEntries.length})</label>
                          {deliveryEntries.map((entry, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 12 }}>
                              <span>Delivery Charges (<strong>{entry.name}</strong>)</span>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ color: "#555" }}>₹{entry.rate}</span>
                                <button type="button" className="btn btn-sm" style={{ background: "#f3f4f6", color: "#111", padding: "2px 8px", borderRadius: 6, fontSize: 11 }}
                                  onClick={() => setInv({ ...inv, delivery_selected_name: entry.name, delivery_rate: String(entry.rate || "600"), delivery_edit_index: i })}>
                                  Edit
                                </button>
                                <button type="button" className="btn btn-sm" style={{ background: "#fee2e2", color: "#b91c1c", padding: "2px 8px", borderRadius: 6, fontSize: 11 }}
                                  onClick={() => setInv({ ...inv, delivery_entries: deliveryEntries.filter((_, idx) => idx !== i), delivery_edit_index: inv.delivery_edit_index === i ? null : inv.delivery_edit_index })}>
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                          <div style={{ borderTop: "1px solid #eee", marginTop: 4, paddingTop: 4, fontSize: 12, fontWeight: "bold" }}>
                            Total: ₹{deliveryEntries.reduce((sum, entry) => sum + (Number(entry.rate) || 0), 0)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* --- Pickup Charges --- */}
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong style={{ fontSize: 13 }}>Pickup Charges</strong>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox" checked={inv.show_pickup}
                        onChange={(e) => setInv({ ...inv, show_pickup: e.target.checked })} /> Enable
                    </label>
                  </div>
                  {inv.show_pickup && (
                    <div>
                      {/* Rate per pickup */}
                      <div style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 11, color: "#555" }}>Rate per Pickup (₹)</label>
                        <input type="number" style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                          value={inv.pickup_rate} onChange={(e) => setInv({ ...inv, pickup_rate: e.target.value })} />
                      </div>

                      {/* Select from roster */}
                      <div style={{ marginBottom: 8 }}>
                        <label style={{ fontSize: 11, color: "#555" }}>Select Person</label>
                        <select style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                          value={inv.pickup_selected_name} onChange={(e) => setInv({ ...inv, pickup_selected_name: e.target.value })}>
                          <option value="">-- Select name to add --</option>
                          {inv.pickup_roster.map((name, i) => (
                            <option key={i} value={name}>{name}</option>
                          ))}
                        </select>
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                        <button type="button" className="btn btn-sm" style={{ background: "#4361ee", color: "#fff", padding: "4px 12px", borderRadius: 6, fontSize: 11 }}
                          onClick={upsertPickupEntry}>
                          {inv.pickup_edit_index !== null ? "Update Entry" : "Add Entry"}
                        </button>
                      </div>

                      {/* Add new name to roster */}
                      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                        <input style={{ flex: 1, padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12 }}
                          placeholder="Add new name to list"
                          value={inv.pickup_new_name}
                          onChange={(e) => setInv({ ...inv, pickup_new_name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && inv.pickup_new_name.trim()) {
                              e.preventDefault();
                              setInv({ ...inv, pickup_roster: [...inv.pickup_roster, inv.pickup_new_name.trim()], pickup_new_name: "" });
                            }
                          }} />
                        <button className="btn btn-sm" style={{ background: "#444", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 11 }}
                          onClick={() => {
                            if (inv.pickup_new_name.trim()) {
                              setInv({ ...inv, pickup_roster: [...inv.pickup_roster, inv.pickup_new_name.trim()], pickup_new_name: "" });
                            }
                          }}>+ Name</button>
                      </div>

                      {/* Added entries */}
                      {pickupEntries.length > 0 && (
                        <div style={{ marginBottom: 4 }}>
                          <label style={{ fontSize: 11, color: "#555", marginBottom: 4, display: "block" }}>Added ({pickupEntries.length})</label>
                          {pickupEntries.map((entry, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 12 }}>
                              <span>Pickup Charges (<strong>{entry.name}</strong>)</span>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ color: "#555" }}>₹{entry.rate}</span>
                                <button type="button" className="btn btn-sm" style={{ background: "#f3f4f6", color: "#111", padding: "2px 8px", borderRadius: 6, fontSize: 11 }}
                                  onClick={() => setInv({ ...inv, pickup_selected_name: entry.name, pickup_rate: String(entry.rate || "600"), pickup_edit_index: i })}>
                                  Edit
                                </button>
                                <button type="button" className="btn btn-sm" style={{ background: "#fee2e2", color: "#b91c1c", padding: "2px 8px", borderRadius: 6, fontSize: 11 }}
                                  onClick={() => setInv({ ...inv, pickup_entries: pickupEntries.filter((_, idx) => idx !== i), pickup_edit_index: inv.pickup_edit_index === i ? null : inv.pickup_edit_index })}>
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                          <div style={{ borderTop: "1px solid #eee", marginTop: 4, paddingTop: 4, fontSize: 12, fontWeight: "bold" }}>
                            Total: ₹{pickupTotal}
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
                      <input type="checkbox" checked={inv.show_other}
                        onChange={(e) => setInv({ ...inv, show_other: e.target.checked })} /> Enable
                    </label>
                  </div>
                  {inv.show_other && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div>
                        <label style={{ fontSize: 11, color: "#555" }}>Description</label>
                        <input style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                          placeholder="Enter description"
                          value={inv.other_desc} onChange={(e) => setInv({ ...inv, other_desc: e.target.value })} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: "#555" }}>Amount (₹)</label>
                        <input type="number" style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                          value={inv.other_amount} onChange={(e) => setInv({ ...inv, other_amount: e.target.value })} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button type="button" className="btn btn-sm" style={{ background: "#4361ee", color: "#fff", padding: "4px 12px", borderRadius: 6, fontSize: 11 }}
                          onClick={upsertOtherEntry}>
                          {inv.other_edit_index !== null ? "Update Entry" : "Add Entry"}
                        </button>
                      </div>
                      {otherEntries.length > 0 && (
                        <div style={{ marginBottom: 4 }}>
                          <label style={{ fontSize: 11, color: "#555", marginBottom: 4, display: "block" }}>Added ({otherEntries.length})</label>
                          {otherEntries.map((entry, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 12 }}>
                              <span>{entry.description}</span>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ color: "#555" }}>₹{entry.amount}</span>
                                <button type="button" className="btn btn-sm" style={{ background: "#f3f4f6", color: "#111", padding: "2px 8px", borderRadius: 6, fontSize: 11 }}
                                  onClick={() => setInv({ ...inv, other_desc: entry.description, other_amount: String(entry.amount || ""), other_edit_index: i })}>
                                  Edit
                                </button>
                                <button type="button" className="btn btn-sm" style={{ background: "#fee2e2", color: "#b91c1c", padding: "2px 8px", borderRadius: 6, fontSize: 11 }}
                                  onClick={() => setInv({ ...inv, other_entries: otherEntries.filter((_, idx) => idx !== i), other_edit_index: inv.other_edit_index === i ? null : inv.other_edit_index })}>
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* --- Remark / Note (text-only line shown in invoice description) --- */}
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong style={{ fontSize: 13 }}>Remark / Note</strong>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox" checked={!!inv.show_remark}
                        onChange={(e) => setInv({ ...inv, show_remark: e.target.checked })} /> Enable
                    </label>
                  </div>
                  {inv.show_remark && (
                    <div>
                      <label style={{ fontSize: 11, color: "#555" }}>Shows in invoice PDF as a description-only row (no amount).</label>
                      <textarea
                        rows={3}
                        placeholder="e.g. Payment due within 15 days. Cheques in favour of Swati Tours & Transport."
                        style={{ width: "100%", padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 4, resize: "vertical", fontFamily: "inherit" }}
                        value={inv.remark || ""}
                        onChange={(e) => setInv({ ...inv, remark: e.target.value })}
                      />
                    </div>
                  )}
                </div>

                {/* --- Done --- */}
                <div style={{ padding: "10px 16px" }}>
                  <button className="btn btn-sm" style={{ width: "100%", background: "#4361ee", color: "#fff", padding: "8px", borderRadius: 6, fontSize: 13 }}
                    onClick={() => setInv({ ...inv, showExtrasDropdown: false })}>Done</button>
                </div>
              </div>
            )}
          </div>
          <button className="btn btn-sm" style={{ background: saved ? "#28a745" : "#28a745", color: "#fff", padding: "8px 14px", borderRadius: 8, transition: "all 0.2s" }}
            onClick={handleSave}>{saved ? "Saved !" : "Save"}</button>
          <button className="btn btn-sm" style={{ background: "#e63946", color: "#fff", padding: "8px 14px", borderRadius: 8 }}
            onClick={downloadPDF}>Download PDF</button>
          <button className="btn btn-primary" style={{ padding: "8px 20px", borderRadius: 8, fontSize: 14 }} onClick={handlePrint}>Print Invoice</button>
        </div>
      </div>

      {/* ===== INVOICE ===== */}
      <div className="inv-scroll-wrap" style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <div className="inv-page" ref={invoiceRef} style={{ position: "relative" }}>
        {/* Watermark logo - full background */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          pointerEvents: "none", zIndex: 0,
        }}>
          <img src="/logo.svg" alt="" style={{ width: "60%", height: "auto", opacity: 0.18 }} />
        </div>

        {/* HEADER */}
        <div className="inv-head" style={{ position: "relative", zIndex: 1 }}>
          <h1>
            <input className="edt" style={{ ...edt, fontSize: 20, fontWeight: "bold", letterSpacing: 3, color: "#b71c1c", textAlign: "center", width: "100%", borderBottom: "none", fontFamily: "'Courier New', Courier, monospace" }}
              value={inv.company_name} onChange={(e) => setInv({ ...inv, company_name: e.target.value.toUpperCase() })} />
          </h1>
          <textarea className="edt-area edt" style={{ ...edt, resize: "none", width: "100%", fontSize: 11, lineHeight: 1.5, textAlign: "center", color: "#333", borderBottom: "none" }}
            rows={2} value={inv.company_address} onChange={(e) => setInv({ ...inv, company_address: e.target.value })} />
          <input className="edt" style={{ ...edt, fontSize: 11, textAlign: "center", width: "100%", color: "#333", marginTop: 3, borderBottom: "none" }}
            value={inv.company_contact || ""} onChange={(e) => setInv({ ...inv, company_contact: e.target.value })} />
          <input className="edt" style={{ ...edt, fontSize: 11.5, fontWeight: "bold", textAlign: "center", width: "100%", color: "#222", marginTop: 3, borderBottom: "none" }}
            value={inv.company_pan} onChange={(e) => setInv({ ...inv, company_pan: e.target.value })} />
        </div>

        {/* MAIN TABLE */}
        <table className="it" style={{ position: "relative", zIndex: 1 }}>
          <colgroup>
            <col style={{ width: "32%" }} />
            <col style={{ width: "33%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "20%" }} />
          </colgroup>
          <tbody>

            {/* --- HEADERS: normal vs monthly --- */}
            {inv.is_monthly ? (
              <tr>
                <td className="lbl" colSpan={2}>M/s</td>
                <td className="lbl" style={{ textAlign: "center" }}>INVOICE No</td>
                <td className="lbl" style={{ textAlign: "center" }}>Date</td>
              </tr>
            ) : (
              <tr>
                <td className="lbl">Consignor's</td>
                <td className="lbl">CONSIGNEE</td>
                <td className="lbl" style={{ textAlign: "center" }}>INVOICE No</td>
                <td className="lbl" style={{ textAlign: "center" }}>Date</td>
              </tr>
            )}

            {/* --- VALUES: normal vs monthly --- */}
            {inv.is_monthly ? (
              <tr>
                {/* M/s - client name spanning both party columns, compact */}
                <td className="val" colSpan={2} style={{ lineHeight: 1.35, padding: "6px 10px", verticalAlign: "middle" }}>
                  <input className="edt" style={{ ...edt, fontSize: 13, width: "100%", marginBottom: 2, textTransform: "uppercase", fontWeight: "bold" }}
                    value={inv.consignee_name} onChange={(e) => setInv({ ...inv, consignee_name: e.target.value.toUpperCase(), client_name: e.target.value })} />
                  <input className="edt" style={{ ...edt, fontSize: 10.5, width: "100%", color: "#444", borderBottom: "1px dashed #bbb" }}
                    value={inv.consignee_address} onChange={(e) => setInv({ ...inv, consignee_address: e.target.value, client_address: e.target.value })} />
                  <input className="edt" style={{ ...edt, fontSize: 10.5, width: "100%", marginTop: 1, color: "#444" }}
                    value={inv.consignee_mobile} onChange={(e) => setInv({ ...inv, consignee_mobile: e.target.value, client_phone: e.target.value })} />
                </td>

                {/* Invoice No with Barcode */}
                <td style={{ textAlign: "center", verticalAlign: "middle", padding: "4px" }}>
                  <svg ref={barcodeRef} style={{ display: "block", margin: "0 auto", maxWidth: "100%" }}></svg>
                  <input
                    className="edt"
                    style={{ ...edt, fontSize: 17, color: "#b71c1c", letterSpacing: 0.5, marginTop: 2, textAlign: "center", width: "100%", borderBottom: "none" }}
                    value={inv.invoice_no}
                    onChange={(e) => setInv({ ...inv, invoice_no: e.target.value })}
                    readOnly
                  />
                </td>

                {/* Date */}
                <td style={{ textAlign: "center", verticalAlign: "middle", padding: "4px 6px", position: "relative" }}>
                  <button
                    type="button"
                    onClick={openInvoiceDatePicker}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      width: "100%",
                      padding: 0,
                      fontFamily: "'Courier New', Courier, monospace",
                      fontWeight: "bold",
                      fontSize: 13,
                      color: dateStr ? "#b71c1c" : "#666",
                    }}
                  >
                    {dateStr || "Select Date"}
                  </button>
                  <input
                    ref={invoiceDateInputRef}
                    type="date"
                    value={inv.date}
                    onChange={(e) => setInv({ ...inv, date: e.target.value })}
                    style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1, inset: 0 }}
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                </td>
              </tr>
            ) : (
              <tr>
                {/* Consignor - Fixed */}
                <td className="val" style={{ lineHeight: 1.7, padding: "10px" }}>
                  <input className="edt" style={{ ...edt, fontSize: 14, width: "100%", marginBottom: 3, textTransform: "uppercase", fontWeight: "bold" }}
                    value={inv.consigner_name} onChange={(e) => setInv({ ...inv, consigner_name: e.target.value.toUpperCase() })} />
                  <textarea className="edt-area edt" style={{ ...edt, resize: "none", width: "100%", fontSize: 10.5, lineHeight: 1.5, borderBottom: "1px dashed #999", color: "#444" }}
                    rows={2} value={inv.consigner_address} onChange={(e) => setInv({ ...inv, consigner_address: e.target.value })} />
                  <input className="edt" style={{ ...edt, fontSize: 10.5, width: "100%", marginTop: 2, color: "#444" }}
                    value={inv.consigner_mobile} onChange={(e) => setInv({ ...inv, consigner_mobile: e.target.value })} />
                </td>

                {/* Consignee - Editable */}
                <td className="val" style={{ lineHeight: 1.7, padding: "10px" }}>
                  <input className="edt" style={{ ...edt, fontSize: 14, width: "100%", marginBottom: 3, textTransform: "uppercase", fontWeight: "bold" }}
                    value={inv.consignee_name} onChange={(e) => setInv({ ...inv, consignee_name: e.target.value.toUpperCase(), client_name: e.target.value })} />
                  <textarea className="edt-area edt" style={{ ...edt, resize: "none", width: "100%", fontSize: 10.5, lineHeight: 1.5, borderBottom: "1px dashed #999", color: "#444" }}
                    rows={2} value={inv.consignee_address} onChange={(e) => setInv({ ...inv, consignee_address: e.target.value, client_address: e.target.value })} />
                  <input className="edt" style={{ ...edt, fontSize: 10.5, width: "100%", marginTop: 2, color: "#444" }}
                    value={inv.consignee_mobile} onChange={(e) => setInv({ ...inv, consignee_mobile: e.target.value, client_phone: e.target.value })} />
                </td>

                {/* Invoice No with Barcode */}
                <td style={{ textAlign: "center", verticalAlign: "middle", padding: "6px 4px" }}>
                  <svg ref={barcodeRef}></svg>
                  <input
                    className="edt"
                    style={{ ...edt, fontSize: 22, color: "#b71c1c", letterSpacing: 1, marginTop: 2, textAlign: "center", width: "100%", borderBottom: "none" }}
                    value={inv.invoice_no}
                    onChange={(e) => setInv({ ...inv, invoice_no: e.target.value })}
                  />
                </td>

                {/* Date */}
                <td style={{ textAlign: "center", verticalAlign: "middle", padding: 10, position: "relative" }}>
                  <button
                    type="button"
                    onClick={openInvoiceDatePicker}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      width: "100%",
                      padding: 0,
                      fontFamily: "'Courier New', Courier, monospace",
                      fontWeight: "bold",
                      fontSize: 15,
                      color: dateStr ? "#b71c1c" : "#666",
                    }}
                  >
                    {dateStr || "Select Date"}
                  </button>
                  <input
                    ref={invoiceDateInputRef}
                    type="date"
                    value={inv.date}
                    onChange={(e) => setInv({ ...inv, date: e.target.value })}
                    style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1, inset: 0 }}
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* DESCRIPTION TABLE */}
        <table className="it" style={{ borderTop: "none", position: "relative", zIndex: 1 }}>
          <colgroup>
            <col style={{ width: "32%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "20%" }} />
          </colgroup>
          <tbody>

            {/* --- DESCRIPTION HEADERS --- */}
            {inv.is_monthly ? (
              <tr>
                <td className="lbl" colSpan={5}>Description of Service</td>
                <td className="lbl" style={{ textAlign: "center" }}>Amount</td>
              </tr>
            ) : (
              <tr>
                <td className="lbl">Description of Service</td>
                <td className="lbl" style={{ textAlign: "center" }}>Boxes</td>
                <td className="lbl" style={{ textAlign: "center" }}>Contain</td>
                <td className="lbl" style={{ textAlign: "center" }}>Weight</td>
                <td className="lbl" style={{ textAlign: "center" }}>Rate/kg</td>
                <td className="lbl" style={{ textAlign: "center" }}>Amount</td>
              </tr>
            )}

            {/* --- SERVICE DESCRIPTION / MONTHLY BILL --- */}
            {inv.is_monthly ? (
              <tr>
                <td colSpan={5} style={{ padding: "14px 12px", lineHeight: 1.9, verticalAlign: "top" }}>
                  <div style={{ fontWeight: "bold", fontSize: 14, marginBottom: 10 }}>
                    Bill for Providing Services for The Month Of{" "}
                    <span style={{ color: "#b71c1c" }}>{monthlyLabel || "—"}</span>
                  </div>
                  <div className="monthly-range">
                    <strong>From</strong>
                    <input className="edt" type="date" style={{ ...edt, fontSize: 12, width: 150 }}
                      value={inv.monthly_from}
                      onChange={(e) => setInv({ ...inv, monthly_from: e.target.value })} />
                    <strong style={{ marginLeft: 8 }}>To</strong>
                    <input className="edt" type="date" style={{ ...edt, fontSize: 12, width: 150 }}
                      value={inv.monthly_to}
                      onChange={(e) => setInv({ ...inv, monthly_to: e.target.value })} />
                  </div>
                </td>
                <td style={{ textAlign: "center", verticalAlign: "middle" }}>
                  <input className="edt" type="number" step="0.01"
                    style={{ ...edt, width: "90%", fontSize: 14, textAlign: "center", fontWeight: "bold" }}
                    value={inv.monthly_amount}
                    onChange={(e) => setInv({ ...inv, monthly_amount: e.target.value })}
                    placeholder="0" />
                </td>
              </tr>
            ) : (
              <>
                <tr>
                  <td className="service-description-cell" style={{ padding: "12px 10px", lineHeight: 1.8 }}>
                    <strong className="service-editable" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div>
                        <input className="edt" style={{ ...edt, width: "100%", fontSize: 13, borderBottom: "none" }}
                          value={inv.service_desc}
                          onChange={(e) => setInv({ ...inv, service_desc: e.target.value })}
                        />
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                        <select className="edt-select" value={inv.route} onChange={(e) => setInv({ ...inv, route: e.target.value })}>
                          <option value="">--Route--</option>
                          {locations.map((loc) => (
                            <option key={loc.route} value={loc.route}>
                              {loc.route.replace("-", " to ")}
                            </option>
                          ))}
                        </select>
                        <input className="edt" style={{ ...edt, width: 140, fontSize: 13, borderBottom: "none" }}
                          value={inv.service_suffix} onChange={(e) => setInv({ ...inv, service_suffix: e.target.value })} />
                      </div>
                    </strong>
                  </td>
                  <td></td><td></td><td></td><td></td><td></td>
                </tr>

                <tr>
                  <td style={{ padding: "8px 10px" }}>
                    <strong>Weight</strong>{"\u00A0\u00A0"}
                    <input className="edt" type="number" step="0.01" style={{ ...edt, width: 50, textAlign: "center" }}
                      value={inv.weight} onChange={(e) => setInv({ ...inv, weight: e.target.value })} />
                    {"\u00A0"}kgs
                  </td>
                  <td style={{ textAlign: "center", verticalAlign: "middle" }}>
                    <input className="edt" style={{ ...edt, width: 30, textAlign: "center" }}
                      value={inv.boxes} onChange={(e) => setInv({ ...inv, boxes: e.target.value })} />
                  </td>
                  <td style={{ verticalAlign: "middle" }}>
                    <textarea className="edt-area edt" style={{ ...edt, resize: "none", width: "100%", fontSize: 12, textAlign: "center" }}
                      rows={2} value={inv.contain} onChange={(e) => setInv({ ...inv, contain: e.target.value })} />
                  </td>
                  <td style={{ textAlign: "center", verticalAlign: "middle", fontWeight: "bold" }}>{weight || ""}</td>
                  <td style={{ textAlign: "center", verticalAlign: "middle" }}>
                    <input className="edt" type="number" step="1" style={{ ...edt, width: 50, textAlign: "center" }}
                      value={inv.rate_per_kg} onChange={(e) => setInv({ ...inv, rate_per_kg: e.target.value })} />
                  </td>
                  <td style={{ textAlign: "center", verticalAlign: "middle", fontWeight: "bold", fontSize: 14 }}>
                    {weightAmount > 0 ? weightAmount.toFixed(0) : ""}
                  </td>
                </tr>
              </>
            )}

            {/* --- BOX & PACKAGING ROW (optional) --- */}
            {inv.show_packaging && packagingEntries.map((entry, i) => (
              <tr key={`packaging-${i}`}>
                <td colSpan={inv.is_monthly ? 5 : 1} style={{ padding: "8px 10px" }}>
                  <strong>{entry.kind === "ice_box" ? `Box & Packaging (Ice-Box${entry.name ? ` - ${entry.name}` : ""})` : `Box & Packaging (${entry.boxes}-Box)`}</strong>
                </td>
                {!inv.is_monthly && (<><td></td><td></td><td></td><td></td></>)}
                <td style={{ textAlign: "center", verticalAlign: "middle", fontWeight: "bold", fontSize: 14 }}>
                  {(entry.kind === "ice_box"
                    ? (Number(entry.amount) || 0)
                    : (((Number(entry.boxes) || 0) * (Number(entry.rate) || 0)) || 0)
                  ).toFixed(0)}
                </td>
              </tr>
            ))}

            {/* --- DELIVERY CHARGES ROWS (optional, one per person) --- */}
            {inv.show_delivery && deliveryEntries.map((entry, i) => (
              <tr key={`delivery-${i}`}>
                <td colSpan={inv.is_monthly ? 5 : 1} style={{ padding: "8px 10px" }}>
                  <strong>Delivery Charges ({entry.name})</strong>
                </td>
                {!inv.is_monthly && (<><td></td><td></td><td></td><td></td></>)}
                <td style={{ textAlign: "center", verticalAlign: "middle", fontWeight: "bold", fontSize: 14 }}>
                  {Number(entry.rate) || 0}
                </td>
              </tr>
            ))}

            {/* --- PICKUP CHARGES ROWS (optional, one per person) --- */}
            {inv.show_pickup && pickupEntries.map((entry, i) => (
              <tr key={`pickup-${i}`}>
                <td colSpan={inv.is_monthly ? 5 : 1} style={{ padding: "8px 10px" }}>
                  <strong>Pickup Charges ({entry.name})</strong>
                </td>
                {!inv.is_monthly && (<><td></td><td></td><td></td><td></td></>)}
                <td style={{ textAlign: "center", verticalAlign: "middle", fontWeight: "bold", fontSize: 14 }}>
                  {Number(entry.rate) || 0}
                </td>
              </tr>
            ))}

            {/* --- OTHER CHARGES ROW (optional) --- */}
            {inv.show_other && otherEntries.map((entry, i) => (
              <tr key={`other-${i}`}>
                <td colSpan={inv.is_monthly ? 5 : 1} style={{ padding: "8px 10px" }}>
                  <strong>{entry.description}</strong>
                </td>
                {!inv.is_monthly && (<><td></td><td></td><td></td><td></td></>)}
                <td style={{ textAlign: "center", verticalAlign: "middle", fontWeight: "bold", fontSize: 14 }}>
                  {(Number(entry.amount) || 0).toFixed(0)}
                </td>
              </tr>
            ))}

            {/* --- REMARK / NOTE ROW (optional, description only — no amount) --- */}
            {inv.show_remark && (inv.remark || "").trim() && (
              <tr>
                <td colSpan={inv.is_monthly ? 5 : 1} style={{ padding: "8px 10px", verticalAlign: "top" }}>
                  <div style={{ fontSize: 11, fontWeight: "bold", color: "#444", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Remark
                  </div>
                  <div style={{ fontSize: 12.5, color: "#222", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {inv.remark}
                  </div>
                </td>
                {!inv.is_monthly && (<><td></td><td></td><td></td><td></td></>)}
                <td style={{ textAlign: "center", verticalAlign: "middle" }}></td>
              </tr>
            )}

            {/* --- SPACER --- */}
            {inv.is_monthly ? (
              <>
                <tr><td colSpan={5} style={{ height: 25 }}></td><td></td></tr>
                <tr><td colSpan={5} style={{ height: 25 }}></td><td></td></tr>
                <tr><td colSpan={5} style={{ height: 25 }}></td><td></td></tr>
              </>
            ) : (
              <>
                <tr><td style={{ height: 25 }}></td><td></td><td></td><td></td><td></td><td></td></tr>
                <tr><td style={{ height: 25 }}></td><td></td><td></td><td></td><td></td><td></td></tr>
                <tr><td style={{ height: 25 }}></td><td></td><td></td><td></td><td></td><td></td></tr>
              </>
            )}

            {/* --- TOTAL ROW --- */}
            <tr style={{ background: "#f5f5f5" }}>
              <td colSpan={5} style={{ fontWeight: "bold", fontSize: 14, borderTop: "2px solid #222", padding: "8px 10px" }}>
                Total
              </td>
              <td style={{ textAlign: "center", fontWeight: "bold", fontSize: 16, borderTop: "2px solid #222", padding: "8px 10px", color: "#b71c1c" }}>
                {totalAmount > 0 ? `\u20B9 ${totalAmount.toFixed(2)}` : ""}
              </td>
            </tr>

            {/* --- AMOUNT IN WORDS + SIGNATURE --- */}
            <tr>
              <td colSpan={3} style={{ padding: "10px", verticalAlign: "top", lineHeight: 1.6 }}>
                <div style={{ fontSize: 12, color: "#222", fontWeight: "bold", marginBottom: 2 }}>Amount Chargeable (in words)</div>
                <strong style={{ fontSize: 15, color: "#111" }}>{amtWords || ""}</strong>
              </td>
              <td colSpan={3} style={{ textAlign: "right", verticalAlign: "top", padding: "10px" }}>
                <div style={{ fontWeight: "bold", fontSize: 13, marginBottom: 4 }}>
                  <input className="edt" style={{ ...edt, fontSize: 13, textAlign: "right", width: "100%", borderBottom: "none" }}
                    value={inv.signature_label} onChange={(e) => setInv({ ...inv, signature_label: e.target.value })} />
                </div>
                {stampImg && <img src={stampImg} alt="Stamp" style={{ width: 120, height: "auto", opacity: 0.9, marginTop: 4 }} />}
              </td>
            </tr>

            {/* --- RECEIVED BY + BANK DETAILS --- */}
            <tr>
              <td colSpan={3} style={{ padding: 0, verticalAlign: "top" }}>
                <div style={{ padding: "8px 10px 5px", fontWeight: "bold", fontSize: 13, background: "#f5f5f5", borderBottom: "1px solid #333" }}>
                  Received By
                </div>
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>Name</div>
                    <input className="edt" style={{ ...edt, width: "100%", fontSize: 12 }}
                      value={inv.received_name} onChange={(e) => setInv({ ...inv, received_name: e.target.value })} />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>Stamp / Sign</div>
                    <div style={{ minHeight: 18 }}></div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>Date</div>
                    <input className="edt" style={{ ...edt, width: "100%", fontSize: 12 }}
                      value={inv.received_date} onChange={(e) => setInv({ ...inv, received_date: e.target.value })} />
                  </div>
                </div>
              </td>
              <td colSpan={3} style={{ padding: 0, verticalAlign: "top" }}>
                <div style={{ padding: "8px 10px 5px", fontWeight: "bold", fontSize: 13, background: "#f5f5f5", borderBottom: "1px solid #333" }}>
                  Bank Details
                </div>
                <div style={{ padding: "8px 10px", fontSize: 11.5, lineHeight: 1.8 }}>
                  <div><span style={{ color: "#555" }}>Banker Name:</span>{" "}
                    <input className="edt" style={{ ...edt, fontSize: 11.5, width: 160 }}
                      value={inv.bank_name} onChange={(e) => setInv({ ...inv, bank_name: e.target.value })} />
                  </div>
                  <div><span style={{ color: "#555" }}>Account Holder:</span>{" "}
                    <input className="edt" style={{ ...edt, fontSize: 11.5, width: 200 }}
                      value={inv.bank_account_holder} onChange={(e) => setInv({ ...inv, bank_account_holder: e.target.value })} />
                  </div>
                  <div><span style={{ color: "#555" }}>Account No:</span>{" "}
                    <input className="edt" style={{ ...edt, fontSize: 11.5, width: 160 }}
                      value={inv.bank_account_no} onChange={(e) => setInv({ ...inv, bank_account_no: e.target.value })} />
                  </div>
                  <div><span style={{ color: "#555" }}>IFSC:</span>{" "}
                    <input className="edt" style={{ ...edt, fontSize: 11.5, width: 140 }}
                      value={inv.bank_ifsc} onChange={(e) => setInv({ ...inv, bank_ifsc: e.target.value })} />
                  </div>
                  <div><span style={{ color: "#555" }}>Branch:</span>{" "}
                    <input className="edt" style={{ ...edt, fontSize: 11.5, width: 160 }}
                      value={inv.bank_branch} onChange={(e) => setInv({ ...inv, bank_branch: e.target.value })} />
                  </div>
                </div>
              </td>
            </tr>

          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}
