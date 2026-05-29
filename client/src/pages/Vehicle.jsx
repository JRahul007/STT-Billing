import { useState, useEffect, useMemo } from "react";
import JsBarcode from "jsbarcode";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { getDefaultStamp } from "../defaultStamp";
import { getVehicles, createVehicle, updateVehicle, upsertVehicleByInvoice, deleteVehicle } from "../services/api";

const STORAGE_KEY = "vehicle_entries";
const CLIENTS_STORAGE_KEY = "vehicle_clients";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const emptyClientForm = { id: null, name: "", contact: "", address: "", gstin: "", email: "" };

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
  rate: "",
  trip: "",
  amount: "",
  expenses: "",
  client_name: "",
  // Each entry: { trip_date, description, total_km, start_km, end_km, remark }.
  // Replaces the old single trip_date/description/start_km/end_km/remark.
  description_entries: [],
};

const emptyDescriptionEntry = {
  trip_date: "",
  description: "",
  total_km: "",
  start_km: "",
  end_km: "",
  remark: "",
  rate: "",
  trip: "",
  amount: "",
};

// Rehydrate description_entries from a saved record, falling back to the legacy
// single fields so older entries continue to render correctly.
const normalizeDescriptionEntries = (en) => {
  if (Array.isArray(en?.description_entries) && en.description_entries.length > 0) {
    return en.description_entries.map((d) => ({
      trip_date:   String(d?.trip_date   ?? ""),
      description: String(d?.description ?? ""),
      total_km:    String(d?.total_km    ?? ""),
      start_km:    String(d?.start_km    ?? ""),
      end_km:      String(d?.end_km      ?? ""),
      remark:      String(d?.remark      ?? ""),
      rate:        String(d?.rate        ?? ""),
      trip:        String(d?.trip        ?? ""),
      amount:      String(d?.amount      ?? ""),
    }));
  }
  // Legacy single-row → wrap as one entry, inheriting top-level rate/trip/amount.
  const hasLegacy = en && (en.description || en.trip_date || en.start_km || en.end_km || en.remark || en.rate || en.amount);
  if (!hasLegacy) return [];
  return [{
    trip_date:   String(en.trip_date   ?? ""),
    description: String(en.description ?? ""),
    total_km:    String(en.total_km    ?? ""),
    start_km:    String(en.start_km    ?? ""),
    end_km:      String(en.end_km      ?? ""),
    remark:      String(en.remark      ?? ""),
    rate:        String(en.rate        ?? ""),
    trip:        String(en.trip        ?? ""),
    amount:      String(en.amount      ?? ""),
  }];
};

const sumTotalKm = (entries) =>
  (entries || []).reduce((s, d) => s + (parseFloat(d.total_km) || 0), 0);

const sumEntryAmount = (entries) =>
  (entries || []).reduce((s, d) => s + (parseFloat(d.amount) || 0), 0);

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

  // --- Vehicle clients master (separate from vehicle entries) ---
  const [clients, setClients] = useState([]);
  const [showClientModal, setShowClientModal] = useState(false);
  const [clientForm, setClientForm] = useState(emptyClientForm);

  // Load: prefer Supabase, fall back to localStorage. Any local-only rows that
  // aren't yet on the server are merged in so the UI keeps showing them; they
  // get pushed up the next time the user edits / saves them.
  const loadEntries = async () => {
    let localList = [];
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      localList = Array.isArray(saved) ? saved : [];
    } catch { localList = []; }
    try {
      const res = await getVehicles();
      const apiList = Array.isArray(res.data) ? res.data : [];
      const apiInvoiceNos = new Set(apiList.map((v) => v.invoice_no));
      const localOnly = localList.filter((v) => v.invoice_no && !apiInvoiceNos.has(v.invoice_no));
      const merged = [...apiList, ...localOnly];
      setEntries(merged);
      // Keep localStorage in sync so we can still render when offline.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (e) {
      // API unavailable → render local entries only.
      setEntries(localList);
    }
  };

  useEffect(() => {
    loadEntries();
    try {
      const savedClients = JSON.parse(localStorage.getItem(CLIENTS_STORAGE_KEY) || "[]");
      setClients(Array.isArray(savedClients) ? savedClients : []);
    } catch {
      setClients([]);
    }
  }, []);

  // Mirror writes to localStorage so the offline fallback stays current.
  const saveAll = (list) => {
    setEntries(list);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  };

  const saveClients = (list) => {
    setClients(list);
    localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(list));
  };

  // Look up a client record by its name (case-insensitive). Used to enrich the PDF
  // with contact + address when available.
  const findClient = (name) => {
    if (!name) return null;
    const target = String(name).trim().toLowerCase();
    return clients.find((c) => (c.name || "").trim().toLowerCase() === target) || null;
  };

  const openClientManager = () => {
    setClientForm(emptyClientForm);
    setShowClientModal(true);
  };

  const handleClientSubmit = (e) => {
    e.preventDefault();
    const name = (clientForm.name || "").trim();
    if (!name) {
      alert("Client name is required.");
      return;
    }
    // Prevent duplicate names (case-insensitive) when adding a new client
    const dupe = clients.find((c) =>
      (c.name || "").trim().toLowerCase() === name.toLowerCase() && c.id !== clientForm.id
    );
    if (dupe) {
      alert("A client with this name already exists.");
      return;
    }
    if (clientForm.id) {
      const updated = clients.map((c) => (c.id === clientForm.id
        ? {
            ...c, name,
            contact: clientForm.contact || "",
            address: clientForm.address || "",
            gstin:   (clientForm.gstin   || "").toUpperCase(),
            email:   clientForm.email   || "",
          }
        : c));
      saveClients(updated);
    } else {
      const newClient = {
        id: Date.now(),
        name,
        contact: clientForm.contact || "",
        address: clientForm.address || "",
        gstin:   (clientForm.gstin   || "").toUpperCase(),
        email:   clientForm.email   || "",
      };
      saveClients([newClient, ...clients]);
    }
    setClientForm(emptyClientForm);
  };

  const handleClientEdit = (client) => {
    setClientForm({
      id: client.id,
      name: client.name || "",
      contact: client.contact || "",
      address: client.address || "",
      gstin:   client.gstin   || "",
      email:   client.email   || "",
    });
  };

  const handleClientDelete = (id) => {
    if (!window.confirm("Delete this client? Existing vehicle entries that used this client will keep the name on file.")) return;
    saveClients(clients.filter((c) => c.id !== id));
    if (clientForm.id === id) setClientForm(emptyClientForm);
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
    setForm({
      ...emptyForm,
      date: today,
      invoice_no: getNextVehicleInvoiceNo(),
      description_entries: [{ ...emptyDescriptionEntry, trip_date: today }],
    });
    setShowModal(true);
  };

  const openEdit = (entry) => {
    setEditing(entry);
    setForm({
      ...emptyForm,
      ...entry,
      description_entries: normalizeDescriptionEntries(entry),
    });
    setShowModal(true);
  };

  const addDescriptionEntry = () => {
    setForm((prev) => ({
      ...prev,
      description_entries: [
        ...(prev.description_entries || []),
        { ...emptyDescriptionEntry, trip_date: prev.date || new Date().toISOString().slice(0, 10) },
      ],
    }));
  };

  const removeDescriptionEntry = (idx) => {
    setForm((prev) => ({
      ...prev,
      description_entries: (prev.description_entries || []).filter((_, i) => i !== idx),
    }));
  };

  const updateDescriptionEntry = (idx, field, value) => {
    setForm((prev) => ({
      ...prev,
      description_entries: (prev.description_entries || []).map((d, i) => {
        if (i !== idx) return d;
        const next = { ...d, [field]: value };
        // Auto-fill total_km from start/end if user hasn't typed it manually.
        if (field === "start_km" || field === "end_km") {
          const sk = parseFloat(field === "start_km" ? value : next.start_km) || 0;
          const ek = parseFloat(field === "end_km"   ? value : next.end_km)   || 0;
          if (sk && ek && ek >= sk) next.total_km = String(ek - sk);
        }
        // Auto-fill the entry's amount from rate × trip when both are numeric.
        if (field === "rate" || field === "trip") {
          const r = parseFloat(field === "rate" ? value : next.rate) || 0;
          const t = parseFloat(field === "trip" ? value : next.trip) || 0;
          if (r && t) next.amount = String(r * t);
        }
        return next;
      }),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const descEntries = (form.description_entries || []).filter((d) => (
      d.description?.trim() || d.trip_date || d.total_km || d.start_km || d.end_km || d.remark
        || d.rate || d.trip || d.amount
    ));
    // Sync legacy single-value fields from the first entry so old views / exports
    // (and any unmigrated server columns) still see something useful.
    const first = descEntries[0] || emptyDescriptionEntry;
    // Grand total = sum of every entry's amount. The top-level amount is now
    // the computed total of the multi-row description block, not an input.
    const grandTotal = sumEntryAmount(descEntries);
    const payload = {
      ...form,
      description_entries: descEntries,
      trip_date:   first.trip_date,
      description: first.description,
      start_km:    first.start_km,
      end_km:      first.end_km,
      remark:      first.remark,
      rate:        first.rate,
      trip:        first.trip,
      total_km:    String(sumTotalKm(descEntries) || ""),
      amount:      String(grandTotal || ""),
    };
    if (editing) {
      // Update path. If the editing record has a Supabase numeric id (small int)
      // try PUT /:id; otherwise (or on failure) fall back to upsert by invoice_no
      // so a previously local-only entry gets pushed up to the server.
      try {
        const hasNumericId = typeof editing.id === "number" && editing.id < 1e12;
        const res = hasNumericId
          ? await updateVehicle(editing.id, payload)
          : await upsertVehicleByInvoice(payload.invoice_no, payload);
        const saved = res.data;
        const updated = entries.map((en) => (en.id === editing.id ? saved : en));
        saveAll(updated);
      } catch (e) {
        // Offline / API down: persist locally only so the UI doesn't lose work.
        const updated = entries.map((en) => (en.id === editing.id ? { ...en, ...payload } : en));
        saveAll(updated);
      }
    } else {
      saveVehicleInvoiceNo(payload.invoice_no);
      try {
        const res = await createVehicle(payload);
        const saved = res.data;
        saveAll([saved, ...entries]);
      } catch (e) {
        const newEntry = { id: Date.now(), ...payload };
        saveAll([newEntry, ...entries]);
      }
    }
    setShowModal(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this vehicle entry?")) return;
    const target = entries.find((en) => en.id === id);
    const hasNumericId = target && typeof target.id === "number" && target.id < 1e12;
    if (hasNumericId) {
      try { await deleteVehicle(id); } catch (e) { /* fall back to local removal */ }
    }
    saveAll(entries.filter((en) => en.id !== id));
  };

  // --- Download Invoice PDF (older billing-style format) ---
  const downloadInvoicePDF = async (en) => {
    const descEntries = normalizeDescriptionEntries(en);
    // Grand total = sum of every entry's amount (per-row pricing). Falls back
    // to top-level en.amount for legacy records that never had per-entry rates.
    const totalAmt = sumEntryAmount(descEntries) || Number(en.amount) || 0;
    const amtWords = totalAmt > 0 ? numberToWords(Math.floor(totalAmt)) + " Rupees Only" : "";
    const stampBase64 = localStorage.getItem("stamp_image") || await getDefaultStamp();
    // Prefer the user-uploaded logo, otherwise fetch the bundled /logo.svg
    // and inline it as a data URL so html2canvas can rasterise it reliably.
    const fetchSvgAsDataUrl = async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return "";
        const text = await res.text();
        return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(text)));
      } catch { return ""; }
    };
    const logoBase64 = localStorage.getItem("app_logo") || await fetchSvgAsDataUrl("/logo.svg");
    const clientRecord = findClient(en.client_name);
    const billDateStr = fmtDate(en.date);
    const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const nl2br = (s) => escHtml(s).replace(/\n/g, "<br/>");

    // Barcode for the INVOICE No cell (matches the older billing PDF).
    let barcodeDataUrl = "";
    try {
      const barcodeCanvas = document.createElement("canvas");
      JsBarcode(barcodeCanvas, en.invoice_no || "0000", { format: "CODE128", width: 1.8, height: 40, displayValue: false, margin: 2, background: "transparent" });
      barcodeDataUrl = barcodeCanvas.toDataURL("image/png");
    } catch (e) { /* ignore */ }

    // Shared cell styles to keep the table compact and consistent.
    // color:#000 keeps body text crisp on the watermark + after JPEG compression.
    const lbl   = "border:1px solid #333; padding:6px 10px; font-weight:bold; font-size:12px; background:rgba(245,245,245,0.6); color:#000; letter-spacing:0.5px;";
    const cell  = "border:1px solid #333; padding:6px 10px; vertical-align:top; font-size:13px; background:transparent; color:#000;";
    const empty = "border:1px solid #333; font-size:13px;";

    const container = document.createElement("div");
    container.style.cssText = "position:fixed; left:-9999px; top:0; z-index:-1;";
    container.innerHTML = `
<div style="width:800px; background:#fff; color:#000; font-family:'Courier New',Courier,monospace; font-size:13px; position:relative;">

  <!-- =========================================================
       HEADER (separate from body): full-width orange band with
       white STT badge on the left and SWATI TOURS AND TRANSPORT
       text. Address + Contact / Email sit underneath, still
       OUTSIDE the bordered body box.
       ========================================================= -->
  <div style="background:linear-gradient(180deg,#f7850a 0%,#e06800 100%); padding:12px 24px; display:flex; align-items:center; justify-content:center; gap:16px;">
    ${logoBase64 ? `<img src="${logoBase64}" style="width:68px; height:68px; object-fit:contain; flex-shrink:0;" />` : ""}
    <h1 style="font-size:26px; font-weight:bold; letter-spacing:3px; color:#ffffff; margin:0; font-family:'Courier New',Courier,monospace;">SWATI TOURS AND TRANSPORT</h1>
  </div>
  <div style="text-align:center; padding:8px 24px 3px; font-size:11.5px; color:#000; font-weight:600;">A-902, DREAM CARNIVAL, NEAR PNG JEWELLERS, CHAROLI, PUNE-412105.</div>
  <div style="text-align:center; padding:2px 24px 3px; font-size:11.5px; color:#000; font-weight:600;">
    <strong>Contact:</strong> 8291301603 &nbsp;|&nbsp; <strong>Email:</strong> pune.stt@gmail.com
  </div>
  <div style="text-align:center; padding:2px 24px 10px; font-size:11.5px; color:#000; font-weight:bold;">
    UAM MH19D0152647 / PAN BSNPP7564G
  </div>

  <!-- Separator between header and body -->
  <div style="height:0; border-bottom:3px double #222; margin:0 24px;"></div>

  <!-- =========================================================
       BODY: bordered on all 4 sides, centered with side margins.
       Watermark sits behind only the body, not the header.
       ========================================================= -->
  <div style="margin:10px 24px 24px; padding:0; border:2px solid #222; position:relative;">

    <!-- Watermark behind body content -->
    <div style="position:absolute; top:0; left:0; right:0; bottom:0; display:flex; align-items:center; justify-content:center; pointer-events:none; z-index:0;">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="460" height="460" style="opacity:0.45;">
        <defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#f7850a"/><stop offset="100%" stop-color="#e06800"/></linearGradient><linearGradient id="blue" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4355db"/><stop offset="100%" stop-color="#2d3cb8"/></linearGradient><linearGradient id="brown" x1="100%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#9b3e1c"/><stop offset="100%" stop-color="#6d2b12"/></linearGradient></defs>
        <rect width="200" height="200" rx="40" fill="url(#bg)"/>
        <circle cx="72" cy="100" r="60" fill="none" stroke="url(#blue)" stroke-width="13" stroke-dasharray="310 68" stroke-dashoffset="-34" stroke-linecap="round"/>
        <circle cx="72" cy="100" r="46" fill="none" stroke="url(#brown)" stroke-width="9" stroke-dasharray="230 60" stroke-dashoffset="80" stroke-linecap="round"/>
        <text x="105" y="120" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="52" font-weight="900" font-style="italic" fill="#ffffff" letter-spacing="2">STT</text>
      </svg>
    </div>

    <!-- Name / INVOICE No / Date block (older billing layout) -->
    <table style="width:100%; border-collapse:collapse; position:relative; z-index:1;">
      <colgroup><col style="width:65%"/><col style="width:15%"/><col style="width:20%"/></colgroup>
      <tbody>
        <tr>
          <td style="${lbl}">Name</td>
          <td style="${lbl} text-align:center;">INVOICE No</td>
          <td style="${lbl} text-align:center;">Date</td>
        </tr>
        <tr>
          <td style="${cell} padding:12px 10px; line-height:1.6;">
            <strong style="font-size:14px; text-transform:uppercase; color:#000;">M/s ${escHtml(en.client_name || "-")}</strong>
            ${clientRecord && clientRecord.address ? `<div style="font-size:11.5px; color:#000; margin-top:3px; line-height:1.45;">${escHtml(clientRecord.address)}</div>` : ""}
            ${clientRecord && clientRecord.contact ? `<div style="font-size:11.5px; color:#000; margin-top:2px;">Contact: ${escHtml(clientRecord.contact)}</div>` : ""}
          </td>
          <td style="${cell} text-align:center; vertical-align:middle; padding:6px 4px;">
            ${barcodeDataUrl ? `<img src="${barcodeDataUrl}" style="max-width:100%; height:auto;" />` : ""}
            <div style="font-weight:bold; font-size:22px; color:#b71c1c; letter-spacing:1px; margin-top:2px;">${escHtml(en.invoice_no || "")}</div>
          </td>
          <td style="${cell} text-align:center; vertical-align:middle; padding:10px;">
            <div style="font-weight:bold; font-size:15px; color:#222;">${billDateStr}</div>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Description table: Date | Description | Rate | Trip | Amount | Remark -->
    <table style="width:100%; border-collapse:collapse; border-top:none; position:relative; z-index:1;">
      <colgroup>
        <col style="width:10%"/>
        <col style="width:42%"/>
        <col style="width:10%"/>
        <col style="width:13%"/>
        <col style="width:12%"/>
        <col style="width:13%"/>
      </colgroup>
      <thead>
        <tr style="background:#f0f0f0;">
          <th style="border:1px solid #333; padding:7px 6px; font-size:12px; font-weight:700;">Date</th>
          <th style="border:1px solid #333; padding:7px 10px; font-size:12px; font-weight:700;">Description</th>
          <th style="border:1px solid #333; padding:7px 6px; font-size:12px; font-weight:700;">Rate</th>
          <th style="border:1px solid #333; padding:7px 6px; font-size:12px; font-weight:700;">Trip</th>
          <th style="border:1px solid #333; padding:7px 6px; font-size:12px; font-weight:700;">Amount</th>
          <th style="border:1px solid #333; padding:7px 6px; font-size:12px; font-weight:700;">Remark</th>
        </tr>
      </thead>
      <tbody>
        ${descEntries.length === 0
          ? `<tr><td style="border:1px solid #333; height:60px;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td><td style="border:1px solid #333;"></td></tr>`
          : descEntries.map((d) => {
            const tripDateStr = fmtDate(d.trip_date);
            const rate = parseFloat(d.rate)   || 0;
            const amt  = parseFloat(d.amount) || 0;
            // Append Start / End / Total km inside the Description cell when
            // present (keeps the table at 6 columns matching the reference).
            const kmParts = [
              d.start_km ? `Start km: <strong>${escHtml(d.start_km)}</strong>` : "",
              d.end_km   ? `End km: <strong>${escHtml(d.end_km)}</strong>`     : "",
              d.total_km ? `Total km: <strong>${escHtml(d.total_km)}</strong>` : "",
            ].filter(Boolean);
            const kmLine = kmParts.length
              ? `<div style="margin-top:4px; color:#000; font-size:11.5px;">${kmParts.join(" &nbsp;|&nbsp; ")}</div>`
              : "";
            return `
              <tr>
                <td style="border:1px solid #333; padding:8px 6px; font-size:12px; vertical-align:top; white-space:nowrap;">${tripDateStr}</td>
                <td style="border:1px solid #333; padding:8px 10px; font-size:12px; vertical-align:top; line-height:1.55;">
                  ${nl2br(d.description)}
                  ${kmLine}
                </td>
                <td style="border:1px solid #333; padding:8px 6px; font-size:12px; vertical-align:top; text-align:center;">${rate ? rate.toFixed(0) + "/-" : ""}</td>
                <td style="border:1px solid #333; padding:8px 6px; font-size:12px; vertical-align:top;">${escHtml(d.trip)}</td>
                <td style="border:1px solid #333; padding:8px 6px; font-size:12px; vertical-align:top; text-align:center;">${amt ? amt.toFixed(0) + "/-" : ""}</td>
                <td style="border:1px solid #333; padding:8px 6px; font-size:12px; vertical-align:top;">${escHtml(d.remark) || "NA"}</td>
              </tr>
            `;
          }).join("")}
        <tr>
          <td style="border:1px solid #333; height:24px;"></td>
          <td style="border:1px solid #333;"></td>
          <td style="border:1px solid #333;"></td>
          <td style="border:1px solid #333;"></td>
          <td style="border:1px solid #333;"></td>
          <td style="border:1px solid #333;"></td>
        </tr>

        <!-- TOTAL ROW (spans description columns; no G.TOTAL) -->
        <tr style="background:#f5f5f5;">
          <td colspan="5" style="border:1px solid #333; padding:9px 14px; font-weight:bold; font-size:14px; border-top:2px solid #222;">Total</td>
          <td style="border:1px solid #333; padding:9px 8px; font-weight:bold; font-size:13px; text-align:right; color:#b71c1c; border-top:2px solid #222; white-space:nowrap;">${totalAmt > 0 ? "&#8377;&nbsp;" + totalAmt.toFixed(2) : ""}</td>
        </tr>
      </tbody>
    </table>

    <!-- Amount Chargeable (in words) | For Swati Tours & Transport (+ stamp) -->
    <table style="width:100%; border-collapse:collapse; border-top:none; position:relative; z-index:1;">
      <colgroup><col style="width:65%"/><col style="width:35%"/></colgroup>
      <tbody>
        <tr>
          <td style="border:1px solid #333; padding:10px 14px; vertical-align:top; line-height:1.6; font-size:12px;">
            <div style="font-size:11.5px; color:#222; font-weight:bold;">Amount Chargeable (in words)</div>
            <div style="font-size:14px; font-weight:bold; margin-top:4px; color:#111;">${escHtml(amtWords)}</div>
          </td>
          <td style="border:1px solid #333; padding:10px 14px; vertical-align:top; text-align:right; font-size:12.5px;">
            <strong>For Swati Tours &amp; Transport</strong>
            ${stampBase64 ? `<div><img src="${stampBase64}" style="width:120px; height:auto; opacity:0.9; margin-top:6px;" /></div>` : `<div style="height:46px;"></div>`}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Received By | Bank Details (older labeled-box style) -->
    <table style="width:100%; border-collapse:collapse; border-top:none; position:relative; z-index:1;">
      <colgroup><col style="width:50%"/><col style="width:50%"/></colgroup>
      <tbody>
        <tr>
          <td style="border:1px solid #333; padding:0; vertical-align:top;">
            <div style="padding:8px 12px 5px; font-weight:bold; font-size:13px; background:rgba(245,245,245,0.6); border-bottom:1px solid #333;">Received By</div>
            <div style="padding:10px 14px;">
              <div style="margin-bottom:14px;">
                <div style="font-size:11px; color:#555; margin-bottom:4px;">Name</div>
                <div style="border-bottom:1px dashed #999; min-height:18px;"></div>
              </div>
              <div style="margin-bottom:14px;">
                <div style="font-size:11px; color:#555; margin-bottom:4px;">Stamp / Sign</div>
                <div style="min-height:18px;"></div>
              </div>
              <div>
                <div style="font-size:11px; color:#555; margin-bottom:4px;">Date</div>
                <div style="border-bottom:1px dashed #999; min-height:18px;"></div>
              </div>
            </div>
          </td>
          <td style="border:1px solid #333; padding:0; vertical-align:top;">
            <div style="padding:8px 12px 5px; font-weight:bold; font-size:13px; background:rgba(245,245,245,0.6); border-bottom:1px solid #333;">Bank Details</div>
            <div style="padding:10px 14px; font-size:11.5px; line-height:1.8;">
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

  </div>
</div>`;

    document.body.appendChild(container);
    await new Promise((r) => setTimeout(r, 100));

    const el = container.firstElementChild;
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#fff" });
    document.body.removeChild(container);

    // JPEG @ 0.92 + compress drops file size from ~7 MB → ~200–400 KB
    // with no visible quality loss for invoice text/tables.
    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4", compress: true });
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = (canvas.height * pdfW) / canvas.width;
    pdf.addImage(imgData, "JPEG", 0, 0, pdfW, pdfH, undefined, "FAST");
    const fileDateTag = billDateStr ? billDateStr.replace(/\//g, "-") : "draft";
    pdf.save(`STT_${en.invoice_no}_${fileDateTag}.pdf`);
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
              <th>Total KM</th>
              <th>Expenses</th>
              <th style={{ textAlign: "center" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", padding: 30, color: "#999" }}>
                  No vehicle entries yet. Click "+ Add Vehicle Entry" to get started.
                </td>
              </tr>
            ) : (
              paginatedEntries.map((en) => {
                const descEntries = normalizeDescriptionEntries(en);
                const totalKm = sumTotalKm(descEntries) || parseFloat(en.total_km) || 0;
                return (
                <tr key={en.id}>
                  <td style={{ fontWeight: 600, color: "#4361ee" }}>{en.invoice_no}</td>
                  <td>{en.date}</td>
                  <td>{en.client_name}</td>
                  <td style={{ fontWeight: 600 }}>{en.amount ? `₹${Number(en.amount).toLocaleString("en-IN")}` : ""}</td>
                  <td>{en.trip}</td>
                  <td>{en.rate ? `₹${en.rate}` : ""}</td>
                  <td>{totalKm > 0 ? Number(totalKm).toLocaleString("en-IN") : ""}</td>
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
                );
              })
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
                  <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 4 }}>
                    <span>Client Name</span>
                    <button type="button" className="btn btn-sm btn-secondary"
                      style={{ padding: "2px 10px", fontSize: 11, borderRadius: 6 }}
                      onClick={openClientManager}>+ Manage Clients</button>
                  </label>
                  {(() => {
                    // Build the dropdown list: master clients first, then legacy names from past
                    // entries that aren't yet in the master (so older data still shows correctly).
                    const masterNames = new Set(clients.map((c) => (c.name || "").trim()).filter(Boolean));
                    const legacy = entries
                      .map((en) => (en.client_name || "").trim())
                      .filter((n) => n && !masterNames.has(n));
                    const allNames = [
                      ...clients.map((c) => ({ name: c.name, source: "master" })),
                      ...Array.from(new Set(legacy)).map((name) => ({ name, source: "legacy" })),
                    ];
                    return (
                      <select value={form.client_name}
                        onChange={(e) => handleChange("client_name", e.target.value)}
                        style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}>
                        <option value="">-- Select Client --</option>
                        {allNames.map((opt) => (
                          <option key={`${opt.source}-${opt.name}`} value={opt.name}>
                            {opt.name}{opt.source === "legacy" ? " (not in master)" : ""}
                          </option>
                        ))}
                      </select>
                    );
                  })()}
                  {form.client_name && (() => {
                    const c = findClient(form.client_name);
                    return c ? (
                      <div style={{ marginTop: 6, fontSize: 11, color: "#555", lineHeight: 1.5 }}>
                        {c.contact && <span>📞 {c.contact}</span>}
                        {c.contact && c.address && <span> · </span>}
                        {c.address && <span>{c.address}</span>}
                      </div>
                    ) : null;
                  })()}
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Expenses (₹)</label>
                  <input type="number" step="0.01" value={form.expenses}
                    onChange={(e) => handleChange("expenses", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }} />
                </div>
              </div>

              {/* Description Entries — one block per trip date.
                  Rate / Trip / Amount / Remark live INSIDE each entry so each
                  trip can have its own pricing. The grand total below is the
                  sum of every entry's amount. */}
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1f2937" }}>
                    Description ({(form.description_entries || []).length} {(form.description_entries || []).length === 1 ? "trip" : "trips"})
                    {sumEntryAmount(form.description_entries) > 0 && (
                      <span style={{ marginLeft: 10, fontSize: 12, color: "#16a34a", fontWeight: 700 }}>
                        Total: ₹{sumEntryAmount(form.description_entries).toLocaleString("en-IN")}
                      </span>
                    )}
                  </div>
                  <button type="button" className="btn btn-sm btn-secondary"
                    style={{ padding: "4px 12px", fontSize: 12, borderRadius: 6 }}
                    onClick={addDescriptionEntry}>+ Add Trip</button>
                </div>
                {(form.description_entries || []).length === 0 && (
                  <div style={{ fontSize: 12, color: "#94a3b8", padding: "10px 0", textAlign: "center" }}>
                    No trips added yet. Click "+ Add Trip" to add the first one.
                  </div>
                )}
                {(form.description_entries || []).map((d, idx) => (
                  <div key={idx} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, marginBottom: 10, background: "#f9fafb" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#4338ca", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        Trip #{idx + 1}
                      </div>
                      <button type="button" className="btn btn-sm btn-danger"
                        style={{ padding: "2px 10px", fontSize: 11, borderRadius: 6 }}
                        onClick={() => removeDescriptionEntry(idx)}>Remove</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Trip Date</label>
                        <input type="date" value={d.trip_date}
                          onChange={(e) => updateDescriptionEntry(idx, "trip_date", e.target.value)}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12 }} />
                      </div>
                      <div style={{ gridColumn: "2 / -1" }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Description</label>
                        <textarea rows={4} value={d.description}
                          onChange={(e) => updateDescriptionEntry(idx, "description", e.target.value)}
                          placeholder={"Vehicle Hired for Local Trip\nVehicle Model: Ertiga\nTotal kms: Fix\nExtra kms: 0\nReference: ..."}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12, resize: "vertical", fontFamily: "inherit" }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Start (km)</label>
                        <input type="number" step="0.01" value={d.start_km}
                          onChange={(e) => updateDescriptionEntry(idx, "start_km", e.target.value)}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12 }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>End (km)</label>
                        <input type="number" step="0.01" value={d.end_km}
                          onChange={(e) => updateDescriptionEntry(idx, "end_km", e.target.value)}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12 }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>
                          Total KM <span style={{ fontWeight: 400, color: "#888" }}>(auto)</span>
                        </label>
                        <input type="number" step="0.01" value={d.total_km}
                          onChange={(e) => updateDescriptionEntry(idx, "total_km", e.target.value)}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12 }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Rate (₹)</label>
                        <input type="number" step="0.01" value={d.rate}
                          onChange={(e) => updateDescriptionEntry(idx, "rate", e.target.value)}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12 }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Trip</label>
                        <input value={d.trip}
                          onChange={(e) => updateDescriptionEntry(idx, "trip", e.target.value)}
                          placeholder="e.g. Local, Ranjangaon, 2"
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12 }} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>
                          Amount (₹) <span style={{ fontWeight: 400, color: "#888" }}>(auto = rate × trip)</span>
                        </label>
                        <input type="number" step="0.01" value={d.amount}
                          onChange={(e) => updateDescriptionEntry(idx, "amount", e.target.value)}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12 }} />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Remark</label>
                        <textarea rows={2} value={d.remark}
                          onChange={(e) => updateDescriptionEntry(idx, "remark", e.target.value)}
                          style={{ width: "100%", padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12, resize: "vertical" }} />
                      </div>
                    </div>
                  </div>
                ))}
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

      {/* Manage Clients modal — full CRUD master list.
          z-index 1100 sits above the Add Vehicle Entry modal (which is inline-styled
          at z-index 1000), so it stacks correctly when opened from inside that modal. */}
      {showClientModal && (
        <div className="modal-overlay"
          style={{ zIndex: 1100 }}
          onClick={() => { setShowClientModal(false); setClientForm(emptyClientForm); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: "92vw" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Manage Clients</h2>
                <p style={{ marginTop: 4, fontSize: 12.5, color: "#64748b" }}>
                  Add, edit, or remove vehicle clients. Only the client name is required.
                </p>
              </div>
              <button type="button" className="btn btn-sm btn-secondary"
                style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6 }}
                onClick={() => { setShowClientModal(false); setClientForm(emptyClientForm); }}>
                Close
              </button>
            </div>

            {/* Add / Edit form */}
            <form onSubmit={handleClientSubmit} style={{ background: "#f8faff", border: "1px solid #dbe3f3", borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#4338ca", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>
                {clientForm.id ? "Edit Client" : "Add New Client"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#334155", display: "block", marginBottom: 4 }}>
                    Client Name <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    required
                    placeholder="e.g. XYZ PVT LTD"
                    value={clientForm.name}
                    onChange={(e) => setClientForm((p) => ({ ...p, name: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#334155", display: "block", marginBottom: 4 }}>
                    Contact Number <span style={{ color: "#94a3b8", fontWeight: 500 }}>(optional)</span>
                  </label>
                  <input
                    placeholder="e.g. +91 9876543210"
                    value={clientForm.contact}
                    onChange={(e) => setClientForm((p) => ({ ...p, contact: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#334155", display: "block", marginBottom: 4 }}>
                    Address <span style={{ color: "#94a3b8", fontWeight: 500 }}>(optional)</span>
                  </label>
                  <input
                    placeholder="Office / billing address"
                    value={clientForm.address}
                    onChange={(e) => setClientForm((p) => ({ ...p, address: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#334155", display: "block", marginBottom: 4 }}>
                    GSTIN <span style={{ color: "#94a3b8", fontWeight: 500 }}>(optional)</span>
                  </label>
                  <input
                    placeholder="e.g. 27ABCDE1234F1Z5"
                    value={clientForm.gstin}
                    onChange={(e) => setClientForm((p) => ({ ...p, gstin: e.target.value.toUpperCase() }))}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, textTransform: "uppercase" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#334155", display: "block", marginBottom: 4 }}>
                    Email <span style={{ color: "#94a3b8", fontWeight: 500 }}>(optional)</span>
                  </label>
                  <input
                    type="email"
                    placeholder="e.g. accounts@xyz.com"
                    value={clientForm.email}
                    onChange={(e) => setClientForm((p) => ({ ...p, email: e.target.value }))}
                    style={{ width: "100%", padding: "8px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13 }}
                  />
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                {clientForm.id && (
                  <button type="button" className="btn btn-sm btn-secondary"
                    style={{ padding: "6px 14px", fontSize: 12, borderRadius: 6 }}
                    onClick={() => setClientForm(emptyClientForm)}>
                    Cancel Edit
                  </button>
                )}
                <button type="submit" className="btn btn-primary"
                  style={{ padding: "6px 16px", fontSize: 13, borderRadius: 6 }}>
                  {clientForm.id ? "Update Client" : "+ Add Client"}
                </button>
              </div>
            </form>

            {/* Saved clients list */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                Saved Clients ({clients.length})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "40vh", overflowY: "auto" }}>
                {clients.length === 0 ? (
                  <div style={{ fontSize: 13, color: "#94a3b8", padding: "20px 0", textAlign: "center" }}>
                    No clients yet. Add one above to get started.
                  </div>
                ) : (
                  clients.map((c) => (
                    <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, background: "#fff", border: "1px solid #e2e8f0" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5, color: "#0f172a" }}>{c.name}</div>
                        <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 2 }}>
                          {c.contact ? `📞 ${c.contact}` : <em style={{ color: "#cbd5e1" }}>no contact</em>}
                          {c.contact && c.address ? " · " : ""}
                          {c.address ? c.address : (c.contact ? "" : <em style={{ color: "#cbd5e1", marginLeft: 6 }}>no address</em>)}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <button type="button" className="btn btn-sm btn-secondary"
                          style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6 }}
                          onClick={() => handleClientEdit(c)}>Edit</button>
                        <button type="button" className="btn btn-sm btn-danger"
                          style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6 }}
                          onClick={() => handleClientDelete(c.id)}>Delete</button>
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
