import { useState, useEffect, useMemo } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { getDefaultStamp } from "../defaultStamp";

const STORAGE_KEY = "salary_entries";
const EMPLOYEES_STORAGE_KEY = "salary_employees";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const emptyEmployeeForm = {
  id: null,
  name: "",
  employee_no: "",
  designation: "",
  department: "",
  location: "",
  pan_number: "",
  joining_date: "",
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

const fmtDate = (d) => {
  if (!d) return "";
  const obj = new Date(d);
  return obj.getDate().toString().padStart(2, "0") + "-" + MONTH_NAMES[obj.getMonth()] + "-" + String(obj.getFullYear()).slice(-2);
};

const FULL_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "April (2026)" — used in table column + PDF title.
// Falls back to legacy free-text pay_period if month/year aren't set yet.
const fmtPayPeriod = (en) => {
  const m = parseInt(en?.pay_month);
  const y = parseInt(en?.pay_year);
  if (m >= 1 && m <= 12 && y) return `${FULL_MONTH_NAMES[m - 1]} (${y})`;
  return en?.pay_period || "";
};

const emptyForm = {
  name: "",
  employee_no: "",
  designation: "",
  department: "",
  location: "",
  pan_number: "",
  joining_date: "",
  pay_month: "",
  pay_year: String(new Date().getFullYear()),
  basic_salary: "",
  hra: "",
  conveyance: "",
  medical: "",
  special_allowance: "",
  professional_tax: "",
};

const computeTotals = (f) => {
  const basic = parseFloat(f.basic_salary) || 0;
  const hra = parseFloat(f.hra) || 0;
  const conv = parseFloat(f.conveyance) || 0;
  const med = parseFloat(f.medical) || 0;
  const special = parseFloat(f.special_allowance) || 0;
  const ptax = parseFloat(f.professional_tax) || 0;
  const totalEarnings = basic + hra + conv + med + special;
  const netPay = totalEarnings - ptax;
  return { totalEarnings, netPay };
};

export default function Salary() {
  const RECORDS_PER_PAGE = 10;
  const [entries, setEntries] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [filterMonth, setFilterMonth] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  // --- Employee master (separate from salary entries) ---
  const [employees, setEmployees] = useState([]);
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      setEntries(Array.isArray(saved) ? saved : []);
    } catch {
      setEntries([]);
    }
    try {
      const savedEmps = JSON.parse(localStorage.getItem(EMPLOYEES_STORAGE_KEY) || "[]");
      setEmployees(Array.isArray(savedEmps) ? savedEmps : []);
    } catch {
      setEmployees([]);
    }
  }, []);

  const saveAll = (list) => {
    setEntries(list);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  };

  const saveEmployees = (list) => {
    setEmployees(list);
    localStorage.setItem(EMPLOYEES_STORAGE_KEY, JSON.stringify(list));
  };

  const findEmployeeByNo = (no) => {
    if (!no) return null;
    const target = String(no).trim().toLowerCase();
    return employees.find((e) => (e.employee_no || "").trim().toLowerCase() === target) || null;
  };

  const openEmployeeManager = () => {
    setEmployeeForm(emptyEmployeeForm);
    setShowEmployeeModal(true);
  };

  const handleEmployeeSubmit = (e) => {
    e.preventDefault();
    const empNo = (employeeForm.employee_no || "").trim();
    const name = (employeeForm.name || "").trim();
    if (!empNo) { alert("Employee No is required."); return; }
    if (!name) { alert("Employee Name is required."); return; }
    const dupe = employees.find((emp) =>
      (emp.employee_no || "").trim().toLowerCase() === empNo.toLowerCase() && emp.id !== employeeForm.id
    );
    if (dupe) { alert("An employee with this Employee No already exists."); return; }
    if (employeeForm.id) {
      const updated = employees.map((emp) => (emp.id === employeeForm.id
        ? { ...emp, ...employeeForm, employee_no: empNo, name }
        : emp));
      saveEmployees(updated);
    } else {
      const newEmp = { ...employeeForm, id: Date.now(), employee_no: empNo, name };
      saveEmployees([newEmp, ...employees]);
    }
    setEmployeeForm(emptyEmployeeForm);
  };

  const handleEmployeeEdit = (emp) => {
    setEmployeeForm({
      id: emp.id,
      name: emp.name || "",
      employee_no: emp.employee_no || "",
      designation: emp.designation || "",
      department: emp.department || "",
      location: emp.location || "",
      pan_number: emp.pan_number || "",
      joining_date: emp.joining_date || "",
    });
  };

  const handleEmployeeDelete = (id) => {
    if (!window.confirm("Delete this employee? Existing salary records that used this employee will keep their details on file.")) return;
    saveEmployees(employees.filter((emp) => emp.id !== id));
    if (employeeForm.id === id) setEmployeeForm(emptyEmployeeForm);
  };

  // When user picks an Employee No in the salary form, auto-fill employee fields.
  const handleEmployeeNoChange = (value) => {
    const emp = findEmployeeByNo(value);
    setForm((prev) => ({
      ...prev,
      employee_no: value,
      name: emp ? (emp.name || "") : prev.name,
      designation: emp ? (emp.designation || "") : prev.designation,
      department: emp ? (emp.department || "") : prev.department,
      location: emp ? (emp.location || "") : prev.location,
      pan_number: emp ? (emp.pan_number || "") : prev.pan_number,
      joining_date: emp ? (emp.joining_date || "") : prev.joining_date,
    }));
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (entry) => {
    setEditing(entry);
    setForm({ ...emptyForm, ...entry });
    setShowModal(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const totals = computeTotals(form);
    const payload = {
      ...form,
      total_earnings: totals.totalEarnings.toString(),
      net_pay: totals.netPay.toString(),
    };
    if (editing) {
      const updated = entries.map((en) => (en.id === editing.id ? { ...en, ...payload } : en));
      saveAll(updated);
    } else {
      const newEntry = { id: Date.now(), ...payload };
      saveAll([newEntry, ...entries]);
    }
    setShowModal(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const handleDelete = (id) => {
    if (!window.confirm("Delete this salary record?")) return;
    saveAll(entries.filter((en) => en.id !== id));
  };

  const formTotals = computeTotals(form);

  // --- Download Salary Slip PDF ---
  const downloadSalarySlip = async (en) => {
    const totals = computeTotals(en);
    const totalEarnings = totals.totalEarnings;
    const netPay = totals.netPay;
    const netInWords = netPay > 0 ? numberToWords(Math.floor(netPay)) + " Rupees Only" : "";
    const stampBase64 = localStorage.getItem("stamp_image") || await getDefaultStamp();
    const logoBase64 = localStorage.getItem("app_logo") || "";
    const payPeriod = fmtPayPeriod(en);

    // Hide a row if it has no value — keeps the slip clean.
    const earningRow = (label, val) => {
      const v = parseFloat(val) || 0;
      if (v === 0) return "";
      return `<tr>
        <td style="padding:7px 14px; border-bottom:1px solid #e5e7eb; font-size:12px; color:#1f2937;">${label}</td>
        <td style="padding:7px 14px; border-bottom:1px solid #e5e7eb; text-align:right; font-size:12px; color:#1f2937; font-variant-numeric:tabular-nums;">${v.toFixed(2)}</td>
      </tr>`;
    };
    const ptax = parseFloat(en.professional_tax) || 0;
    const totalDeductions = ptax;

    const cellLabel = "padding:7px 14px; font-size:12px; color:#111827; border-bottom:1px solid #e5e7eb; vertical-align:top; width:22%;";
    const cellValue = "padding:7px 14px; font-size:12px; color:#111827; border-bottom:1px solid #e5e7eb; vertical-align:top; width:28%;";

    const container = document.createElement("div");
    container.style.cssText = "position:fixed; left:-9999px; top:0; z-index:-1;";
    container.innerHTML = `
<div style="width:794px; box-sizing:border-box; background:#ffffff; color:#111827; font-family:Arial,Helvetica,sans-serif; font-size:12px; border:2px solid #1f2937; position:relative;">

  <!-- WATERMARK STT logo (matches billing/vehicle invoice) -->
  <div style="position:absolute; top:0; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; pointer-events:none; z-index:0;">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="500" height="500" style="opacity:0.45;">
      <defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#f7850a"/><stop offset="100%" stop-color="#e06800"/></linearGradient><linearGradient id="blue" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4355db"/><stop offset="100%" stop-color="#2d3cb8"/></linearGradient><linearGradient id="brown" x1="100%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#9b3e1c"/><stop offset="100%" stop-color="#6d2b12"/></linearGradient></defs>
      <rect width="200" height="200" rx="40" fill="url(#bg)"/>
      <circle cx="72" cy="100" r="60" fill="none" stroke="url(#blue)" stroke-width="13" stroke-dasharray="310 68" stroke-dashoffset="-34" stroke-linecap="round"/>
      <circle cx="72" cy="100" r="46" fill="none" stroke="url(#brown)" stroke-width="9" stroke-dasharray="230 60" stroke-dashoffset="80" stroke-linecap="round"/>
      <text x="105" y="120" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="52" font-weight="900" font-style="italic" fill="#ffffff" letter-spacing="2">STT</text>
    </svg>
  </div>

  <!-- LETTERHEAD: STT logo on left, company name + address centered in remaining space -->
  <div style="display:flex; align-items:center; padding:18px 24px 16px; border-bottom:2px solid #1f2937; position:relative; z-index:1;">
    <div style="flex-shrink:0; width:80px; display:flex; justify-content:flex-start;">
      ${logoBase64 ? `<img src="${logoBase64}" style="width:72px; height:72px; object-fit:contain;" />` : ""}
    </div>
    <div style="flex:1; text-align:center; line-height:1.55;">
      <div style="font-size:22px; font-weight:700; color:#e06800; letter-spacing:0.5px;">Swati Tours &amp; Transport</div>
      <div style="font-size:11px; color:#4b5563; margin-top:3px;">A-902, Dream Carnival, Near PNG Jewellers, Charoli, Pune - 412105, Maharashtra, India</div>
      <div style="font-size:11px; color:#4b5563;">UAM: MH19D0152647</div>
    </div>
    <div style="flex-shrink:0; width:80px;"></div>
  </div>

  <!-- TITLE BAR -->
  <div style="padding:10px 24px; background:rgba(243,244,246,0.6); border-bottom:1px solid #d1d5db; text-align:center; position:relative; z-index:1;">
    <div style="font-size:13px; font-weight:600; color:#111827; letter-spacing:1px;">Payslip for the Month of ${payPeriod || "—"}</div>
  </div>

  <!-- EMPLOYEE DETAILS -->
  <table style="width:100%; border-collapse:collapse; border-bottom:1px solid #d1d5db; position:relative; z-index:1;">
    <tbody>
      <tr>
        <td style="${cellLabel}">Employee Name</td>
        <td style="${cellValue}">${en.name || "—"}</td>
        <td style="${cellLabel}">Employee No.</td>
        <td style="${cellValue}">${en.employee_no || "—"}</td>
      </tr>
      <tr>
        <td style="${cellLabel}">Designation</td>
        <td style="${cellValue}">${en.designation || "—"}</td>
        <td style="${cellLabel}">Department</td>
        <td style="${cellValue}">${en.department || "—"}</td>
      </tr>
      <tr>
        <td style="${cellLabel}">Location</td>
        <td style="${cellValue}">${en.location || "—"}</td>
        <td style="${cellLabel}">PAN Number</td>
        <td style="${cellValue}">${en.pan_number || "—"}</td>
      </tr>
      <tr>
        <td style="${cellLabel} border-bottom:none;">Date of Joining</td>
        <td style="${cellValue} border-bottom:none;" colspan="3">${en.joining_date ? fmtDate(en.joining_date) : "—"}</td>
      </tr>
    </tbody>
  </table>

  <!-- EARNINGS / DEDUCTIONS -->
  <table style="width:100%; border-collapse:collapse; position:relative; z-index:1;">
    <colgroup><col style="width:50%"/><col style="width:50%"/></colgroup>
    <thead>
      <tr style="background:#1f2937; color:#ffffff;">
        <th style="padding:9px 14px; font-size:11.5px; font-weight:600; border-right:1px solid #374151;">
          <span style="float:left;">Earnings</span>
          <span style="float:right;">Amount (₹)</span>
          <div style="clear:both;"></div>
        </th>
        <th style="padding:9px 14px; font-size:11.5px; font-weight:600;">
          <span style="float:left;">Deductions</span>
          <span style="float:right;">Amount (₹)</span>
          <div style="clear:both;"></div>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="vertical-align:top; padding:0; border-right:1px solid #d1d5db;">
          <table style="width:100%; border-collapse:collapse;">
            <tbody>
              ${earningRow("Basic Salary", en.basic_salary)}
              ${earningRow("House Rent Allowance (HRA)", en.hra)}
              ${earningRow("Conveyance Allowance", en.conveyance)}
              ${earningRow("Medical Allowance", en.medical)}
              ${earningRow("Special Allowance", en.special_allowance)}
            </tbody>
          </table>
        </td>
        <td style="vertical-align:top; padding:0;">
          <table style="width:100%; border-collapse:collapse;">
            <tbody>
              ${ptax > 0 ? `<tr>
                <td style="padding:7px 14px; font-size:12px; color:#1f2937; border-bottom:1px solid #e5e7eb;">Professional Tax</td>
                <td style="padding:7px 14px; text-align:right; font-size:12px; color:#1f2937; border-bottom:1px solid #e5e7eb; font-variant-numeric:tabular-nums;">${ptax.toFixed(2)}</td>
              </tr>` : ""}
            </tbody>
          </table>
        </td>
      </tr>
      <tr style="background:rgba(243,244,246,0.6); border-top:1px solid #d1d5db;">
        <td style="padding:9px 14px; font-size:12px; font-weight:600; color:#111827; border-right:1px solid #d1d5db; border-top:1px solid #d1d5db;">
          <span style="float:left;">Gross Earnings</span>
          <span style="float:right; font-variant-numeric:tabular-nums;">${totalEarnings.toFixed(2)}</span>
          <div style="clear:both;"></div>
        </td>
        <td style="padding:9px 14px; font-size:12px; font-weight:600; color:#111827; border-top:1px solid #d1d5db;">
          <span style="float:left;">Total Deductions</span>
          <span style="float:right; font-variant-numeric:tabular-nums;">${totalDeductions.toFixed(2)}</span>
          <div style="clear:both;"></div>
        </td>
      </tr>
    </tbody>
  </table>

  <!-- NET PAY -->
  <div style="padding:14px 24px; border-top:2px solid #1f2937; position:relative; z-index:1;">
    <div style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <div style="font-size:11px; color:#6b7280;">Net Pay for the Month</div>
        <div style="font-size:11.5px; color:#374151; margin-top:3px;">${netInWords || "—"}</div>
      </div>
      <div style="font-size:16px; font-weight:600; color:#111827; font-variant-numeric:tabular-nums;">₹ ${netPay.toFixed(2)}</div>
    </div>
  </div>

  <!-- FOOTER -->
  <div style="padding:18px 24px; border-top:1px solid #d1d5db; display:flex; justify-content:space-between; align-items:flex-end; gap:24px; position:relative; z-index:1;">
    <div style="font-size:10px; color:#9ca3af; max-width:60%; line-height:1.6;">
      This is a system-generated payslip and is valid without a manual signature.
    </div>
    <div style="text-align:right; min-width:180px;">
      <div style="font-size:11.5px; color:#1f2937;">For Swati Tours &amp; Transport</div>
      ${stampBase64 ? `<img src="${stampBase64}" style="width:110px; height:auto; margin:4px 0; opacity:0.95;" />` : `<div style="height:42px;"></div>`}
      <div style="border-top:1px solid #1f2937; margin-top:2px; padding-top:4px; font-size:11px; color:#374151;">Authorised Signatory</div>
    </div>
  </div>
</div>`;

    document.body.appendChild(container);
    await new Promise((r) => setTimeout(r, 100));

    const el = container.firstElementChild;
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#fff" });
    document.body.removeChild(container);

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfW = pdf.internal.pageSize.getWidth();
    // Center the slip with even margins on all four sides so the outer border
    // doesn't clip at the page edge — banks expect a framed body, not bleed.
    const margin = 10;
    const usableW = pdfW - margin * 2;
    const usableH = (canvas.height * usableW) / canvas.width;
    pdf.addImage(imgData, "PNG", margin, margin, usableW, usableH);
    const safeName = (en.name || "employee").replace(/[^a-z0-9]+/gi, "_");
    const periodTag = payPeriod.replace(/[^a-z0-9]+/gi, "_");
    pdf.save(`SalarySlip_${safeName}${periodTag ? `_${periodTag}` : ""}.pdf`);
  };

  // --- Filters ---
  const availableYears = useMemo(() => {
    const s = new Set();
    entries.forEach((en) => { if (en.joining_date) s.add(new Date(en.joining_date).getFullYear()); });
    return Array.from(s).sort((a, b) => b - a);
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((en) => {
      if (q) {
        const hay = `${en.name || ""} ${en.employee_no || ""} ${en.designation || ""} ${en.department || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (en.joining_date) {
        const d = new Date(en.joining_date);
        if (filterYear && d.getFullYear() !== parseInt(filterYear)) return false;
        if (filterMonth && (d.getMonth() + 1) !== parseInt(filterMonth)) return false;
      } else if (filterYear || filterMonth) {
        return false;
      }
      return true;
    });
  }, [entries, search, filterMonth, filterYear]);

  const totalNetPay = useMemo(() =>
    filteredEntries.reduce((sum, en) => sum + (parseFloat(en.net_pay) || 0), 0),
  [filteredEntries]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / RECORDS_PER_PAGE));
  const paginatedEntries = useMemo(() => {
    const start = (currentPage - 1) * RECORDS_PER_PAGE;
    return filteredEntries.slice(start, start + RECORDS_PER_PAGE);
  }, [filteredEntries, currentPage]);

  useEffect(() => { setCurrentPage(1); }, [search, filterMonth, filterYear]);
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const pageNumbers = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages]);

  const inputStyle = { width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Salary Records</h1>
        <button className="btn btn-primary" style={{ padding: "8px 20px", borderRadius: 8, fontSize: 14 }}
          onClick={openAdd}>+ Add Salary</button>
      </div>

      {/* Filter Bar */}
      <div className="chart-card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Search:</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Name / Emp No / Designation"
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, minWidth: 220 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Joining Year:</label>
            <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }}>
              <option value="">All</option>
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Joining Month:</label>
            <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13 }}>
              <option value="">All</option>
              {MONTH_NAMES.map((name, i) => <option key={i} value={i + 1}>{name}</option>)}
            </select>
          </div>
          <button className="btn btn-sm btn-secondary"
            onClick={() => { setSearch(""); setFilterMonth(""); setFilterYear(""); }}>
            Reset
          </button>
          <span style={{ fontSize: 13, color: "#666", marginLeft: "auto" }}>
            {filteredEntries.length} of {entries.length} records | Total Net Pay: ₹{totalNetPay.toLocaleString("en-IN")}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Employee Name</th>
              <th>Employee No</th>
              <th>Designation</th>
              <th>Month (Year)</th>
              <th>Net Pay</th>
              <th style={{ textAlign: "center" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 30, color: "#999" }}>
                  No salary records yet. Click "+ Add Salary" to get started.
                </td>
              </tr>
            ) : (
              paginatedEntries.map((en) => (
                <tr key={en.id}>
                  <td style={{ fontWeight: 600 }}>{en.name}</td>
                  <td>{en.employee_no}</td>
                  <td>{en.designation}</td>
                  <td>{fmtPayPeriod(en)}</td>
                  <td style={{ fontWeight: 600, color: "#16a34a" }}>{en.net_pay ? `₹${Number(en.net_pay).toLocaleString("en-IN")}` : ""}</td>
                  <td style={{ textAlign: "center" }}>
                    <div className="btn-group" style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                      <button className="btn btn-sm" style={{ background: "#0d6efd", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 12 }}
                        onClick={() => openEdit(en)}>Edit</button>
                      <button className="btn btn-sm" style={{ background: "#dc2626", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 12 }}
                        onClick={() => handleDelete(en.id)}>Delete</button>
                      <button className="btn btn-sm" style={{ background: "#16a34a", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 12 }}
                        onClick={() => downloadSalarySlip(en)}>Salary Slip</button>
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
          <button type="button" className="btn btn-sm btn-secondary"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
            style={{ minWidth: 84, opacity: currentPage === 1 ? 0.6 : 1 }}>
            Previous
          </button>
          {pageNumbers.map((page) => (
            <button key={page} type="button" className="btn btn-sm"
              onClick={() => setCurrentPage(page)}
              style={{
                minWidth: 38,
                background: currentPage === page ? "#4361ee" : "#fff",
                color: currentPage === page ? "#fff" : "#111",
                border: "1px solid #d1d5db",
                borderRadius: 8,
                fontWeight: currentPage === page ? 700 : 500,
              }}>
              {page}
            </button>
          ))}
          <button type="button" className="btn btn-sm btn-secondary"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
            style={{ minWidth: 84, opacity: currentPage === totalPages ? 0.6 : 1 }}>
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
            background: "#fff", borderRadius: 12, padding: 24, width: "100%", maxWidth: 760,
            maxHeight: "90vh", overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700 }}>{editing ? "Edit Salary" : "Add Salary"}</h2>
              <button style={{ background: "transparent", border: "none", fontSize: 24, cursor: "pointer", color: "#666" }}
                onClick={() => { setShowModal(false); setEditing(null); }}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              {/* Employee details */}
              <div style={{ fontSize: 12, fontWeight: 700, color: "#4338ca", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
                Employee Details
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
                <div>
                  <label style={{ ...labelStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Employee No *</span>
                    <button type="button" className="btn btn-sm btn-secondary"
                      style={{ padding: "2px 10px", fontSize: 11, borderRadius: 6 }}
                      onClick={openEmployeeManager}>+ Manage Employees</button>
                  </label>
                  <select required value={form.employee_no}
                    onChange={(e) => handleEmployeeNoChange(e.target.value)} style={inputStyle}>
                    <option value="">-- Select Employee No --</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.employee_no}>
                        {emp.employee_no}{emp.name ? ` — ${emp.name}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Name *</label>
                  <input required value={form.name} onChange={(e) => handleChange("name", e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Designation</label>
                  <input value={form.designation} onChange={(e) => handleChange("designation", e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Department</label>
                  <input value={form.department} onChange={(e) => handleChange("department", e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Location</label>
                  <input value={form.location} onChange={(e) => handleChange("location", e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>PAN Number</label>
                  <input value={form.pan_number} onChange={(e) => handleChange("pan_number", e.target.value.toUpperCase())} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Joining Date</label>
                  <input type="date" value={form.joining_date} onChange={(e) => handleChange("joining_date", e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Pay Month *</label>
                  <select required value={form.pay_month}
                    onChange={(e) => handleChange("pay_month", e.target.value)} style={inputStyle}>
                    <option value="">-- Select Month --</option>
                    {FULL_MONTH_NAMES.map((m, i) => (
                      <option key={i} value={i + 1}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Pay Year *</label>
                  <input required type="number" min="2000" max="2100" value={form.pay_year}
                    onChange={(e) => handleChange("pay_year", e.target.value)} placeholder="2026" style={inputStyle} />
                </div>
              </div>

              {/* Salary components */}
              <div style={{ fontSize: 12, fontWeight: 700, color: "#4338ca", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
                💰 Salary Components
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18 }}>
                <div>
                  <label style={labelStyle}>Basic Salary (₹)</label>
                  <input type="number" step="0.01" value={form.basic_salary} onChange={(e) => handleChange("basic_salary", e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>HRA (₹)</label>
                  <input type="number" step="0.01" value={form.hra} onChange={(e) => handleChange("hra", e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Conveyance Allowance (₹)</label>
                  <input type="number" step="0.01" value={form.conveyance} onChange={(e) => handleChange("conveyance", e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Medical Allowance (₹)</label>
                  <input type="number" step="0.01" value={form.medical} onChange={(e) => handleChange("medical", e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Special Allowance (₹)</label>
                  <input type="number" step="0.01" value={form.special_allowance} onChange={(e) => handleChange("special_allowance", e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Professional Tax (₹)</label>
                  <input type="number" step="0.01" value={form.professional_tax} onChange={(e) => handleChange("professional_tax", e.target.value)} style={inputStyle} />
                </div>
              </div>

              {/* Calculated summary */}
              <div style={{
                background: "#f8faff", border: "1px solid #dbe3f3", borderRadius: 10, padding: 14,
                display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 18,
              }}>
                <div>
                  <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>Total Earnings</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#0d6efd" }}>
                    ₹{formTotals.totalEarnings.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>Net Pay (Earnings − Professional Tax)</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#16a34a" }}>
                    ₹{formTotals.netPay.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
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

      {/* Manage Employees modal — full CRUD master list.
          z-index 1100 sits above the Add Salary modal (z-index 1000) so it
          stacks correctly when opened from inside that modal. */}
      {showEmployeeModal && (
        <div
          style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1100, padding: 20,
          }}
          onClick={() => { setShowEmployeeModal(false); setEmployeeForm(emptyEmployeeForm); }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 12, padding: 24, width: "100%", maxWidth: 720, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Manage Employees</h2>
                <p style={{ marginTop: 4, fontSize: 12.5, color: "#64748b" }}>
                  Add, edit, or remove employees. Employee No and Name are required.
                </p>
              </div>
              <button type="button" className="btn btn-sm btn-secondary"
                style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6 }}
                onClick={() => { setShowEmployeeModal(false); setEmployeeForm(emptyEmployeeForm); }}>
                Close
              </button>
            </div>

            {/* Add / Edit form */}
            <form onSubmit={handleEmployeeSubmit}
              style={{ background: "#f8faff", border: "1px solid #dbe3f3", borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#4338ca", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
                {employeeForm.id ? "Edit Employee" : "Add New Employee"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={labelStyle}>Employee No <span style={{ color: "#dc2626" }}>*</span></label>
                  <input required value={employeeForm.employee_no}
                    onChange={(e) => setEmployeeForm((p) => ({ ...p, employee_no: e.target.value }))}
                    placeholder="e.g. EMP-001" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Name <span style={{ color: "#dc2626" }}>*</span></label>
                  <input required value={employeeForm.name}
                    onChange={(e) => setEmployeeForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Full name" style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Designation</label>
                  <input value={employeeForm.designation}
                    onChange={(e) => setEmployeeForm((p) => ({ ...p, designation: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Department</label>
                  <input value={employeeForm.department}
                    onChange={(e) => setEmployeeForm((p) => ({ ...p, department: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Location</label>
                  <input value={employeeForm.location}
                    onChange={(e) => setEmployeeForm((p) => ({ ...p, location: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>PAN Number</label>
                  <input value={employeeForm.pan_number}
                    onChange={(e) => setEmployeeForm((p) => ({ ...p, pan_number: e.target.value.toUpperCase() }))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Joining Date</label>
                  <input type="date" value={employeeForm.joining_date}
                    onChange={(e) => setEmployeeForm((p) => ({ ...p, joining_date: e.target.value }))} style={inputStyle} />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                {employeeForm.id && (
                  <button type="button" className="btn btn-sm btn-secondary"
                    style={{ padding: "6px 14px", fontSize: 12, borderRadius: 6 }}
                    onClick={() => setEmployeeForm(emptyEmployeeForm)}>
                    Cancel Edit
                  </button>
                )}
                <button type="submit" className="btn btn-primary"
                  style={{ padding: "6px 16px", fontSize: 13, borderRadius: 6 }}>
                  {employeeForm.id ? "Update Employee" : "+ Add Employee"}
                </button>
              </div>
            </form>

            {/* Saved employees list */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                Saved Employees ({employees.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "40vh", overflowY: "auto" }}>
                {employees.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#94a3b8", padding: "20px 0", textAlign: "center" }}>
                    No employees yet. Add one above to get started.
                  </div>
                ) : (
                  employees.map((emp) => (
                    <div key={emp.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, background: "#fff", border: "1px solid #e2e8f0" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5, color: "#0f172a" }}>
                          {emp.employee_no} <span style={{ color: "#64748b", fontWeight: 500 }}>· {emp.name}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>
                          {[emp.designation, emp.department, emp.location].filter(Boolean).join(" · ") || <em style={{ color: "#cbd5e1" }}>no designation/department/location</em>}
                        </div>
                        <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>
                          {emp.pan_number ? `PAN: ${emp.pan_number}` : <em style={{ color: "#cbd5e1" }}>no PAN</em>}
                          {emp.joining_date ? ` · Joined: ${fmtDate(emp.joining_date)}` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button type="button" className="btn btn-sm btn-secondary"
                          style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6 }}
                          onClick={() => handleEmployeeEdit(emp)}>Edit</button>
                        <button type="button" className="btn btn-sm btn-danger"
                          style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6 }}
                          onClick={() => handleEmployeeDelete(emp.id)}>Delete</button>
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
