import { useState, useEffect, useMemo } from "react";
import JsBarcode from "jsbarcode";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { getDefaultStamp } from "../defaultStamp";

const STORAGE_KEY = "vehicle_entries";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

const getNextVehicleInvoiceNo = () => {
  const key = "vehicle_invoice_counter";
  return "V-" + String(parseInt(localStorage.getItem(key) || "1000", 10) + 1);
};
const saveVehicleInvoiceNo = (num) => {
  const n = num.replace("V-", "");
  localStorage.setItem("vehicle_invoice_counter", String(parseInt(n) || 1000));
};

const fmtDate = (d) => {
  if (!d) return "";
  const obj = new Date(d);
  return obj.getDate().toString().padStart(2, "0") + "-" + MONTH_NAMES[obj.getMonth()] + "-" + String(obj.getFullYear()).slice(-2);
};

const emptyForm = {
  invoice_no: "",
  date: "",        // bill date (beside invoice no.)
  trip_date: "",   // trip date (in description table)
  description: "",
  rate: "",
  trip: "",
  start_km: "",
  end_km: "",
  amount: "",
  remark: "",
  expenses: "",
  client_name: "",
};

export default function Vehicle() {
  const RECORDS_PER_PAGE = 10;
  const [entries, setEntries] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [filterClient, setFilterClient] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      setEntries(Array.isArray(saved) ? saved : []);
    } catch {
      setEntries([]);
    }
  }, []);

  const saveAll = (list) => {
    setEntries(list);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  };

  const handleChange = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === "rate" || field === "trip") {
        const rate = parseFloat(field === "rate" ? value : next.rate) || 0;
        const trip = parseFloat(field === "trip" ? value : next.trip) || 0;
        if (rate && trip) next.amount = (rate * trip).toString();
      }
      return next;
    });
  };

  const openAdd = () => {
    setEditing(null);
    const today = new Date().toISOString().slice(0, 10);
    setForm({ ...emptyForm, date: today, trip_date: today, invoice_no: getNextVehicleInvoiceNo() });
    setShowModal(true);
  };

  const openEdit = (entry) => {
    setEditing(entry);
    setForm({ ...emptyForm, ...entry });
    setShowModal(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const rate = parseFloat(form.rate) || 0;
    const trip = parseFloat(form.trip) || 0;
    const payload = { ...form, amount: form.amount || (rate && trip ? (rate * trip).toString() : "") };
    if (editing) {
      const updated = entries.map((en) => (en.id === editing.id ? { ...en, ...payload } : en));
      saveAll(updated);
    } else {
      saveVehicleInvoiceNo(payload.invoice_no);
      const newEntry = { id: Date.now(), ...payload };
      saveAll([newEntry, ...entries]);
    }
    setShowModal(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const handleDelete = (id) => {
    if (!window.confirm("Delete this vehicle entry?")) return;
    saveAll(entries.filter((en) => en.id !== id));
  };

  // --- Download Invoice PDF (mirror replica of Billing invoice) ---
  const downloadInvoicePDF = async (en) => {
    const billDateStr = fmtDate(en.date);
    const tripDateStr = fmtDate(en.trip_date || en.date);
    const totalAmt = Number(en.amount) || 0;
    const amtWords = totalAmt > 0 ? numberToWords(Math.floor(totalAmt)) + " Rupees Only" : "";
    const stampBase64 = localStorage.getItem("stamp_image") || await getDefaultStamp();

    let barcodeDataUrl = "";
    try {
      const barcodeCanvas = document.createElement("canvas");
      JsBarcode(barcodeCanvas, en.invoice_no || "0000", { format: "CODE128", width: 1.8, height: 40, displayValue: false, margin: 2, background: "transparent" });
      barcodeDataUrl = barcodeCanvas.toDataURL("image/png");
    } catch (e) { /* ignore */ }

    // Styles matching billing invoice exactly
    const lbl = "border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#222; letter-spacing:0.5px;";
    const cell = "border:1px solid #333; padding:6px 10px; vertical-align:top; font-size:13px; background:transparent;";
    const empty = "border:1px solid #333; font-size:13px;";

    const container = document.createElement("div");
    container.style.cssText = "position:fixed; left:-9999px; top:0; z-index:-1;";
    container.innerHTML = `
<div style="width:800px; background:#fff; color:#000; font-family:'Courier New',Courier,monospace; font-size:13px; border:2px solid #222; position:relative;">
  <!-- Watermark STT logo -->
  <div style="position:absolute; top:0; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; pointer-events:none; z-index:0;">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="500" height="500" style="opacity:0.45;">
      <defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#f7850a"/><stop offset="100%" stop-color="#e06800"/></linearGradient><linearGradient id="blue" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4355db"/><stop offset="100%" stop-color="#2d3cb8"/></linearGradient><linearGradient id="brown" x1="100%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#9b3e1c"/><stop offset="100%" stop-color="#6d2b12"/></linearGradient></defs>
      <rect width="200" height="200" rx="40" fill="url(#bg)"/>
      <circle cx="72" cy="100" r="60" fill="none" stroke="url(#blue)" stroke-width="13" stroke-dasharray="310 68" stroke-dashoffset="-34" stroke-linecap="round"/>
      <circle cx="72" cy="100" r="46" fill="none" stroke="url(#brown)" stroke-width="9" stroke-dasharray="230 60" stroke-dashoffset="80" stroke-linecap="round"/>
      <text x="105" y="120" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="52" font-weight="900" font-style="italic" fill="#ffffff" letter-spacing="2">STT</text>
    </svg>
  </div>

  <!-- HEADER (same as billing) -->
  <div style="text-align:center; padding:14px 20px 10px; border-bottom:3px double #222; background:linear-gradient(180deg,#fafafa 0%,#fff 100%); position:relative; z-index:1;">
    <h1 style="font-size:20px; font-weight:bold; letter-spacing:3px; color:#b71c1c; margin:0 0 4px; font-family:'Courier New',Courier,monospace;">SWATI TOURS &amp; TRANSPORT</h1>
    <p style="font-size:11px; line-height:1.5; margin:0; color:#333;">A-902, DREAM CARNIVAL, NEAR PNG JEWELLERS, CHAROLI, PUNE-412105</p>
    <p style="font-size:11px; margin:3px 0 0; color:#333;">Contact: 8291301603 &nbsp;|&nbsp; Email: pune.stt@gmail.com</p>
    <p style="font-size:11.5px; font-weight:bold; margin-top:3px; color:#222;">UAM MH19D0152647 / PAN BSNPP7564G</p>
  </div>

  <!-- NAME / INVOICE NO / DATE (same 4-col layout as billing) -->
  <table style="width:100%; border-collapse:collapse; position:relative; z-index:1;">
    <colgroup><col style="width:65%"/><col style="width:15%"/><col style="width:20%"/></colgroup>
    <tbody>
      <tr>
        <td style="${lbl}">Name</td>
        <td style="${lbl} text-align:center;">INVOICE No</td>
        <td style="${lbl} text-align:center;">Date</td>
      </tr>
      <tr>
        <td style="${cell} padding:12px 10px; line-height:1.7;">
          <strong style="font-size:14px; text-transform:uppercase;">M/s ${en.client_name || "-"}</strong>
        </td>
        <td style="${cell} text-align:center; vertical-align:middle; padding:6px 4px;">
          ${barcodeDataUrl ? `<img src="${barcodeDataUrl}" style="max-width:100%; height:auto;" />` : ""}
          <div style="font-weight:bold; font-size:22px; color:#b71c1c; letter-spacing:1px; margin-top:2px;">${en.invoice_no || ""}</div>
        </td>
        <td style="${cell} text-align:center; vertical-align:middle; padding:10px;">
          <div style="font-weight:bold; font-size:15px; color:#222;">${billDateStr}</div>
        </td>
      </tr>
    </tbody>
  </table>

  <!-- DESCRIPTION TABLE (same 6-col layout as billing) -->
  <table style="width:100%; border-collapse:collapse; border-top:none; position:relative; z-index:1;">
    <colgroup><col style="width:12%"/><col style="width:24%"/><col style="width:12%"/><col style="width:8%"/><col style="width:12%"/><col style="width:12%"/><col style="width:20%"/></colgroup>
    <tbody>
      <tr>
        <td style="${lbl} text-align:center;">Trip Date</td>
        <td style="${lbl}">Description</td>
        <td style="${lbl} text-align:center;">Rate</td>
        <td style="${lbl} text-align:center;">Trip</td>
        <td style="${lbl} text-align:center;">Start(km)</td>
        <td style="${lbl} text-align:center;">End(km)</td>
        <td style="${lbl} text-align:center;">Amount</td>
      </tr>
      <tr>
        <td style="${cell} text-align:center; vertical-align:middle; font-weight:bold;">${tripDateStr}</td>
        <td style="${cell} padding:12px 10px; line-height:1.8;"><strong>${en.description || ""}</strong></td>
        <td style="${cell} text-align:center; vertical-align:middle;">${en.rate || ""}</td>
        <td style="${cell} text-align:center; vertical-align:middle;">${en.trip || ""}</td>
        <td style="${cell} text-align:center; vertical-align:middle;">${en.start_km || ""}</td>
        <td style="${cell} text-align:center; vertical-align:middle;">${en.end_km || ""}</td>
        <td style="${cell} text-align:center; vertical-align:middle; font-weight:bold; font-size:14px;">${totalAmt > 0 ? totalAmt.toFixed(0) : ""}</td>
      </tr>
      ${en.remark ? `<tr>
        <td style="${empty}"></td>
        <td style="${cell} padding:8px 10px;"><span style="color:#444; font-size:12px;">Remark: ${en.remark}</span></td>
        <td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td>
      </tr>` : ""}
      <tr><td style="${empty} height:25px;"></td><td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td></tr>
      <tr><td style="${empty} height:25px;"></td><td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td></tr>
      <tr><td style="${empty} height:25px;"></td><td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td><td style="${empty}"></td></tr>

      <!-- TOTAL ROW (same as billing) -->
      <tr style="background:#f5f5f5;">
        <td colspan="6" style="border:1px solid #333; font-weight:bold; font-size:14px; border-top:2px solid #222; padding:8px 10px;">Total</td>
        <td style="border:1px solid #333; text-align:center; font-weight:bold; font-size:16px; border-top:2px solid #222; padding:8px 10px; color:#b71c1c;">\u20B9 ${totalAmt.toFixed(2)}</td>
      </tr>

      <!-- AMOUNT IN WORDS + SIGNATURE (same as billing) -->
      <tr>
        <td colspan="4" style="border:1px solid #333; padding:10px; vertical-align:top; line-height:1.6; font-size:13px;">
          <span style="font-size:12px; color:#222; font-weight:bold;">Amount Chargeable (in words)</span><br/>
          <strong style="font-size:15px; color:#111;">${amtWords}</strong>
        </td>
        <td colspan="3" style="border:1px solid #333; text-align:right; vertical-align:top; padding:10px; font-size:13px;">
          <strong style="font-size:13px;">For Swati Tours &amp; Transport</strong><br/>
          ${stampBase64 ? `<img src="${stampBase64}" style="width:120px; height:auto; opacity:0.9; margin-top:4px;" />` : ""}
        </td>
      </tr>

      <!-- RECEIVED BY + BANK DETAILS (same as billing) -->
      <tr>
        <td colspan="4" style="border:1px solid #333; padding:0; vertical-align:top; font-size:13px;">
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
            <div><span style="color:#555;">Branch:</span> <strong>Vishrantwadi, Pune</strong></div>
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
    pdf.save(`Vehicle_Invoice_${en.invoice_no}_${billDateStr || "draft"}.pdf`);
  };

  // --- Filters ---
  const availableClients = useMemo(() => {
    const s = new Set();
    entries.forEach((en) => { if (en.client_name) s.add(en.client_name); });
    return Array.from(s).sort();
  }, [entries]);

  const availableYears = useMemo(() => {
    const s = new Set();
    entries.forEach((en) => { if (en.date) s.add(new Date(en.date).getFullYear()); });
    return Array.from(s).sort((a, b) => b - a);
  }, [entries]);

  const filteredEntries = useMemo(() => {
    return entries.filter((en) => {
      if (filterClient && en.client_name !== filterClient) return false;
      if (en.date) {
        const d = new Date(en.date);
        if (filterYear && d.getFullYear() !== parseInt(filterYear)) return false;
        if (filterMonth && (d.getMonth() + 1) !== parseInt(filterMonth)) return false;
      } else if (filterYear || filterMonth) {
        return false;
      }
      return true;
    });
  }, [entries, filterClient, filterMonth, filterYear]);

  const totalAmount = useMemo(() =>
    filteredEntries.reduce((sum, en) => sum + (parseFloat(en.amount) || 0), 0),
  [filteredEntries]);

  const totalExpenses = useMemo(() =>
    filteredEntries.reduce((sum, en) => sum + (parseFloat(en.expenses) || 0), 0),
  [filteredEntries]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / RECORDS_PER_PAGE));
  const paginatedEntries = useMemo(() => {
    const start = (currentPage - 1) * RECORDS_PER_PAGE;
    return filteredEntries.slice(start, start + RECORDS_PER_PAGE);
  }, [filteredEntries, currentPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterClient, filterMonth, filterYear]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pageNumbers = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Vehicle Records</h1>
        <button className="btn btn-primary" style={{ padding: "8px 20px", borderRadius: 8, fontSize: 14 }}
          onClick={openAdd}>+ Add Vehicle Entry</button>
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
            <label style={{ fontSize: 13, fontWeight: 600 }}>Client:</label>
            <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }}>
              <option value="">All Clients</option>
              {availableClients.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button className="btn btn-sm btn-secondary"
            onClick={() => { setFilterClient(""); setFilterMonth(""); setFilterYear(""); }}>
            Reset
          </button>
          <span style={{ fontSize: 13, color: "#666", marginLeft: "auto" }}>
            {filteredEntries.length} of {entries.length} records | Amount: ₹{totalAmount.toLocaleString("en-IN")} | Expenses: ₹{totalExpenses.toLocaleString("en-IN")}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Invoice No.</th>
              <th>Date</th>
              <th>Client Name</th>
              <th>Amount</th>
              <th>Trip</th>
              <th>Rate</th>
              <th>Start (km)</th>
              <th>End (km)</th>
              <th>Remark</th>
              <th>Expenses</th>
              <th style={{ textAlign: "center" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ textAlign: "center", padding: 30, color: "#999" }}>
                  No vehicle entries yet. Click "+ Add Vehicle Entry" to get started.
                </td>
              </tr>
            ) : (
              paginatedEntries.map((en) => (
                <tr key={en.id}>
                  <td style={{ fontWeight: 600, color: "#4361ee" }}>{en.invoice_no}</td>
                  <td>{en.date}</td>
                  <td>{en.client_name}</td>
                  <td style={{ fontWeight: 600 }}>{en.amount ? `₹${Number(en.amount).toLocaleString("en-IN")}` : ""}</td>
                  <td>{en.trip}</td>
                  <td>{en.rate ? `₹${en.rate}` : ""}</td>
                  <td>{en.start_km}</td>
                  <td>{en.end_km}</td>
                  <td>{en.remark}</td>
                  <td>{en.expenses ? `₹${Number(en.expenses).toLocaleString("en-IN")}` : ""}</td>
                  <td style={{ textAlign: "center" }}>
                    <div className="btn-group" style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                      <button className="btn btn-sm" style={{ background: "#0d6efd", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 12 }}
                        onClick={() => openEdit(en)}>Edit</button>
                      <button className="btn btn-sm" style={{ background: "#dc2626", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 12 }}
                        onClick={() => handleDelete(en.id)}>Delete</button>
                      <button className="btn btn-sm" style={{ background: "#16a34a", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 12 }}
                        onClick={() => downloadInvoicePDF(en)}>Invoice</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {filteredEntries.length > 0 && (
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

      {/* Add/Edit Modal */}
      {showModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: 20,
        }}>
          <div style={{
            background: "#fff", borderRadius: 12, padding: 24, width: "100%", maxWidth: 720,
            maxHeight: "90vh", overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700 }}>{editing ? "Edit Vehicle Entry" : "Add Vehicle Entry"}</h2>
              <button style={{ background: "transparent", border: "none", fontSize: 24, cursor: "pointer", color: "#666" }}
                onClick={() => { setShowModal(false); setEditing(null); }}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Invoice No.</label>
                  <input value={form.invoice_no}
                    onChange={(e) => handleChange("invoice_no", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Bill Date *</label>
                  <input type="date" required value={form.date}
                    onChange={(e) => handleChange("date", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Trip Date</label>
                  <input type="date" value={form.trip_date}
                    onChange={(e) => handleChange("trip_date", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Client Name</label>
                  <input value={form.client_name}
                    onChange={(e) => handleChange("client_name", e.target.value)}
                    placeholder="e.g. XYZ PVT LTD"
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Description</label>
                  <input value={form.description}
                    onChange={(e) => handleChange("description", e.target.value)}
                    placeholder="e.g. Mumbai to Pune trip"
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Rate (₹)</label>
                  <input type="number" step="0.01" value={form.rate}
                    onChange={(e) => handleChange("rate", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Trip</label>
                  <input value={form.trip}
                    onChange={(e) => handleChange("trip", e.target.value)}
                    placeholder="e.g. 2, 1A, Round Trip"
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Start (km)</label>
                  <input type="number" step="0.01" value={form.start_km}
                    onChange={(e) => handleChange("start_km", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>End (km)</label>
                  <input type="number" step="0.01" value={form.end_km}
                    onChange={(e) => handleChange("end_km", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>
                    Amount (₹) <span style={{ fontWeight: 400, color: "#888" }}>(auto = rate × trip)</span>
                  </label>
                  <input type="number" step="0.01" value={form.amount}
                    onChange={(e) => handleChange("amount", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Expenses (₹)</label>
                  <input type="number" step="0.01" value={form.expenses}
                    onChange={(e) => handleChange("expenses", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Remark</label>
                  <textarea rows={2} value={form.remark}
                    onChange={(e) => handleChange("remark", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, resize: "vertical" }} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
                <button type="button" className="btn btn-sm btn-secondary"
                  style={{ padding: "8px 18px", borderRadius: 8, fontSize: 14 }}
                  onClick={() => { setShowModal(false); setEditing(null); }}>Cancel</button>
                <button type="submit" className="btn btn-primary"
                  style={{ padding: "8px 20px", borderRadius: 8, fontSize: 14 }}>
                  {editing ? "Update" : "Save"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
