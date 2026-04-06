import { useState, useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import defaultStamp from "../defaultStamp";

const defaultLocations = ["BOM-PUNE", "PUNE-BOM", "BOM-GOA", "GOA-BOM", "IDR-BOM", "BOM-IDR"];

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
  const [locations, setLocations] = useState(() => {
    const saved = localStorage.getItem("billing_locations");
    return saved ? JSON.parse(saved) : [...defaultLocations];
  });
  const [newLocation, setNewLocation] = useState("");
  const barcodeRef = useRef(null);
  const [stampImg, setStampImg] = useState("");
  const stampInputRef = useRef(null);

  // Load stamp: localStorage first, then fallback to default stamp
  useEffect(() => {
    const saved = localStorage.getItem("stamp_image");
    setStampImg(saved || defaultStamp);
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
    weight: "",
    boxes: "1",
    contain: "water\nsample",
    rate_per_kg: "",
    box_rate: "150",
    show_packaging: false,
    // ODA Pickup
    show_oda: false,
    oda_location: "Bhosri",
    oda_person: "Ankit P",
    oda_amount: "600",
    // Pickup Charges
    show_pickup: false,
    pickup_roster: ["Ankit Yadav", "Dhiraj Maske", "Tirath Mali"],
    pickup_new_name: "",
    pickup_entries: [],
    pickup_rate: "600",
    // Other Charges
    show_other: false,
    other_desc: "",
    other_amount: "",
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
          // Restore stamp from saved invoice if available
          if (data.stamp_image) {
            setStampImg(data.stamp_image);
            localStorage.setItem("stamp_image", data.stamp_image);
            delete data.stamp_image;
          }
          setInv((prev) => ({ ...prev, ...data }));
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
  const packagingAmount = boxes * boxRate;
  const odaAmount = Number(inv.oda_amount) || 0;
  const pickupRate = Number(inv.pickup_rate) || 600;
  const pickupTotal = inv.pickup_entries.length * pickupRate;
  const otherAmount = Number(inv.other_amount) || 0;
  const totalAmount = weightAmount
    + (inv.show_packaging ? packagingAmount : 0)
    + (inv.show_oda ? odaAmount : 0)
    + (inv.show_pickup ? pickupTotal : 0)
    + (inv.show_other ? otherAmount : 0);
  const routeDisplay = inv.route ? inv.route.replace("-", " to ") : "";
  const dateObj = inv.date ? new Date(inv.date + "T00:00:00") : null;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dateStr = dateObj
    ? dateObj.getDate().toString().padStart(2, "0") + "-" + months[dateObj.getMonth()] + "-" + String(dateObj.getFullYear()).slice(-2)
    : "";
  const amtWords = totalAmount > 0 ? numberToWords(Math.floor(totalAmount)) + " Rupees Only" : "";
  /* Render barcode whenever invoice_no changes */
  useEffect(() => {
    if (barcodeRef.current && inv.invoice_no) {
      try {
        JsBarcode(barcodeRef.current, inv.invoice_no, {
          format: "CODE128",
          width: 1.8,
          height: 40,
          displayValue: false,
          margin: 2,
          background: "transparent",
        });
      } catch (e) { /* ignore */ }
    }
  }, [inv.invoice_no]);

  const addRoute = () => {
    const val = newLocation.trim().toUpperCase();
    if (val && !locations.includes(val)) {
      const updated = [...locations, val];
      setLocations(updated);
      localStorage.setItem("billing_locations", JSON.stringify(updated));
      setInv({ ...inv, route: val });
      setNewLocation("");
    }
  };

  const saveInvoiceToList = () => {
    const entry = {
      id: Date.now(),
      invoice_no: inv.invoice_no,
      date: inv.date,
      location: inv.route + (inv.client_name ? `(${inv.client_name})` : ""),
      weight: weight,
      total_amount: totalAmount,
      bom_expense: "",
      bom_exp_description: "",
      other_expense: "",
      other_exp_description: "",
      payment_status: "NOTPAID",
      invoice_data: JSON.stringify({ ...inv, stamp_image: stampImg }),
    };
    const existing = JSON.parse(localStorage.getItem("invoices") || "[]");
    const idx = existing.findIndex((e) => e.invoice_no === inv.invoice_no);
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

  const downloadPDF = async () => {
    saveInvoiceNo(inv.invoice_no);
    saveInvoiceToList();
    const el = invoiceRef.current;
    if (!el) return;

    // Replace inputs/textareas/selects with plain text spans for clean PDF capture
    const replacements = [];
    el.querySelectorAll("input.edt, textarea.edt-area, textarea.edt, select.edt-select").forEach((field) => {
      const span = document.createElement("span");
      const computed = window.getComputedStyle(field);
      span.textContent = field.tagName === "SELECT"
        ? (field.options[field.selectedIndex]?.text || "")
        : field.value;
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

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const pdfW = pdf.internal.pageSize.getWidth();
    const pdfH = (canvas.height * pdfW) / canvas.width;
    pdf.addImage(imgData, "PNG", 0, 0, pdfW, pdfH);
    pdf.save(`Invoice_${inv.invoice_no}_${dateStr || "draft"}.pdf`);
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
      `}</style>

      {/* ===== TOOLBAR ===== */}
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Create Invoice</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
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
          <div style={{ position: "relative" }}>
            <button className="btn btn-sm"
              style={{ background: (inv.show_packaging || inv.show_oda || inv.show_pickup || inv.show_other) ? "#4361ee" : "#555", color: "#fff", padding: "8px 14px", borderRadius: 8 }}
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
                      <div style={{ marginBottom: 6 }}>
                        <label style={{ fontSize: 11, color: "#555" }}>Rate per Box (₹)</label>
                        <input type="number" step="1" style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                          value={inv.box_rate} onChange={(e) => setInv({ ...inv, box_rate: e.target.value })} />
                      </div>
                      <div style={{ fontSize: 12, color: "#555" }}>
                        {boxes} box × ₹{boxRate} = <strong>₹{packagingAmount}</strong>
                      </div>
                    </div>
                  )}
                </div>

                {/* --- ODA Pickup --- */}
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #eee" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong style={{ fontSize: 13 }}>ODA Pickup Location</strong>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, cursor: "pointer" }}>
                      <input type="checkbox" checked={inv.show_oda}
                        onChange={(e) => setInv({ ...inv, show_oda: e.target.checked })} /> Enable
                    </label>
                  </div>
                  {inv.show_oda && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div>
                        <label style={{ fontSize: 11, color: "#555" }}>Location</label>
                        <input style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                          value={inv.oda_location} onChange={(e) => setInv({ ...inv, oda_location: e.target.value })} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: "#555" }}>Person Name</label>
                        <input style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                          value={inv.oda_person} onChange={(e) => setInv({ ...inv, oda_person: e.target.value })} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, color: "#555" }}>Amount (₹)</label>
                        <input type="number" style={{ width: "100%", padding: "5px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 13, marginTop: 2 }}
                          value={inv.oda_amount} onChange={(e) => setInv({ ...inv, oda_amount: e.target.value })} />
                      </div>
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
                          value="" onChange={(e) => {
                            if (e.target.value) {
                              setInv({ ...inv, pickup_entries: [...inv.pickup_entries, e.target.value] });
                            }
                          }}>
                          <option value="">-- Select name to add --</option>
                          {inv.pickup_roster.map((name, i) => (
                            <option key={i} value={name}>{name}</option>
                          ))}
                        </select>
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
                      {inv.pickup_entries.length > 0 && (
                        <div style={{ marginBottom: 4 }}>
                          <label style={{ fontSize: 11, color: "#555", marginBottom: 4, display: "block" }}>Added ({inv.pickup_entries.length})</label>
                          {inv.pickup_entries.map((name, i) => (
                            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0", fontSize: 12 }}>
                              <span>Pickup Charges (<strong>{name}</strong>)</span>
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ color: "#555" }}>₹{pickupRate}</span>
                                <span style={{ cursor: "pointer", color: "#e63946", fontWeight: "bold", fontSize: 14 }}
                                  onClick={() => setInv({ ...inv, pickup_entries: inv.pickup_entries.filter((_, idx) => idx !== i) })}>×</span>
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
          <h1>SWATI TOURS &amp; TRANSPORT</h1>
          <p className="addr">ROOM NO 4, RAM NAGIN TIWARI BHUVAN ASALFA VILLAGE, NEAR SHRI RAM APTGHATKOPAR WEST MUMBAI 400084</p>
          <p className="pan">UAM MH19D0152647 / PAN BSNPP7564G</p>
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

            {/* --- CONSIGNOR / CONSIGNEE / INVOICE / DATE HEADERS --- */}
            <tr>
              <td className="lbl">Consignor's</td>
              <td className="lbl">CONSIGNEE</td>
              <td className="lbl" style={{ textAlign: "center" }}>INVOICE No</td>
              <td className="lbl" style={{ textAlign: "center" }}>Dated</td>
            </tr>

            {/* --- CONSIGNOR / CONSIGNEE / INVOICE / DATE VALUES --- */}
            <tr>
              {/* Consignor - Fixed */}
              <td className="val" style={{ lineHeight: 1.7, padding: "10px" }}>
                <div style={{ fontWeight: "bold", fontSize: 13, marginBottom: 3 }}>SWATI TOURS &amp; TRANSPORT</div>
                <div style={{ fontSize: 10.5, color: "#444", lineHeight: 1.5 }}>
                  ROOM NO 4, RAM NAGIN TIWARI<br />
                  BHUVAN ASALFA VILLAGE, NEAR<br />
                  SHRI RAM APTGHATKOPAR WEST<br />
                  MUMBAI 400084
                </div>
              </td>

              {/* Consignee - Editable */}
              <td className="val" style={{ lineHeight: 1.7, padding: "10px" }}>
                <input className="edt" style={{ ...edt, fontSize: 14, width: "100%", marginBottom: 3 }}
                  value={inv.client_name} onChange={(e) => setInv({ ...inv, client_name: e.target.value })} />
                <textarea className="edt-area edt" style={{ ...edt, resize: "none", width: "100%", fontSize: 10.5, lineHeight: 1.5, borderBottom: "1px dashed #999", color: "#444" }}
                  rows={2} value={inv.client_address} onChange={(e) => setInv({ ...inv, client_address: e.target.value })} />
                <input className="edt" style={{ ...edt, fontSize: 10.5, width: "100%", marginTop: 2, color: "#444" }}
                  value={inv.client_phone} onChange={(e) => setInv({ ...inv, client_phone: e.target.value })} />
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
                {dateStr
                  ? <div style={{ fontWeight: "bold", fontSize: 15, color: "#222", cursor: "pointer" }}
                      onClick={() => setInv({ ...inv, date: "" })}>{dateStr}</div>
                  : <input className="edt" type="date" style={{ ...edt, fontSize: 12, width: "100%", textAlign: "center" }}
                      value={inv.date} onChange={(e) => setInv({ ...inv, date: e.target.value })} />
                }
              </td>
            </tr>
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
            <tr>
              <td className="lbl">Description of Service</td>
              <td className="lbl" style={{ textAlign: "center" }}>Boxes</td>
              <td className="lbl" style={{ textAlign: "center" }}>Contain</td>
              <td className="lbl" style={{ textAlign: "center" }}>Weight</td>
              <td className="lbl" style={{ textAlign: "center" }}>Rate/kg</td>
              <td className="lbl" style={{ textAlign: "right" }}>Amount</td>
            </tr>

            {/* --- SERVICE DESCRIPTION --- */}
            <tr>
              <td style={{ padding: "12px 10px", lineHeight: 1.8 }}>
                <strong>Bill for Providing Services for{" "}
                  <select className="edt-select" value={inv.route} onChange={(e) => setInv({ ...inv, route: e.target.value })}>
                    <option value="">--Route--</option>
                    {locations.map((loc) => <option key={loc} value={loc}>{loc.replace("-", " to ")}</option>)}
                  </select>
                  {" "}sending{"\u00A0\u00A0"}sample</strong>
              </td>
              <td></td><td></td><td></td><td></td><td></td>
            </tr>

            {/* --- WEIGHT ROW --- */}
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
              <td style={{ textAlign: "right", verticalAlign: "middle", fontWeight: "bold" }}>{weight || ""}</td>
              <td style={{ textAlign: "right", verticalAlign: "middle" }}>
                <input className="edt" type="number" step="1" style={{ ...edt, width: 50, textAlign: "right" }}
                  value={inv.rate_per_kg} onChange={(e) => setInv({ ...inv, rate_per_kg: e.target.value })} />
              </td>
              <td style={{ textAlign: "right", verticalAlign: "middle", fontWeight: "bold", fontSize: 14 }}>
                {weightAmount > 0 ? weightAmount.toFixed(0) : ""}
              </td>
            </tr>

            {/* --- BOX & PACKAGING ROW (optional) --- */}
            {inv.show_packaging && (
              <tr>
                <td style={{ padding: "8px 10px" }}>
                  <strong>Box &amp; Packaging ({boxes}-Box)</strong>
                </td>
                <td></td><td></td><td></td><td></td>
                <td style={{ textAlign: "right", verticalAlign: "middle", fontWeight: "bold", fontSize: 14 }}>
                  {packagingAmount > 0 ? packagingAmount.toFixed(0) : ""}
                </td>
              </tr>
            )}

            {/* --- ODA PICKUP ROW (optional) --- */}
            {inv.show_oda && (
              <tr>
                <td style={{ padding: "8px 10px" }}>
                  <strong>{inv.oda_location} Pickup-ODA Location ({inv.oda_person})</strong>
                </td>
                <td></td><td></td><td></td><td></td>
                <td style={{ textAlign: "right", verticalAlign: "middle", fontWeight: "bold", fontSize: 14 }}>
                  {odaAmount > 0 ? odaAmount.toFixed(0) : ""}
                </td>
              </tr>
            )}

            {/* --- PICKUP CHARGES ROWS (optional, one per person) --- */}
            {inv.show_pickup && inv.pickup_entries.map((name, i) => (
              <tr key={`pickup-${i}`}>
                <td style={{ padding: "8px 10px" }}>
                  <strong>Pickup Charges ({name})</strong>
                </td>
                <td></td><td></td><td></td><td></td>
                <td style={{ textAlign: "right", verticalAlign: "middle", fontWeight: "bold", fontSize: 14 }}>
                  {pickupRate}
                </td>
              </tr>
            ))}

            {/* --- OTHER CHARGES ROW (optional) --- */}
            {inv.show_other && inv.other_desc && (
              <tr>
                <td style={{ padding: "8px 10px" }}>
                  <strong>{inv.other_desc}</strong>
                </td>
                <td></td><td></td><td></td><td></td>
                <td style={{ textAlign: "right", verticalAlign: "middle", fontWeight: "bold", fontSize: 14 }}>
                  {otherAmount > 0 ? otherAmount.toFixed(0) : ""}
                </td>
              </tr>
            )}

            {/* --- SPACER --- */}
            <tr><td style={{ height: 25 }}></td><td></td><td></td><td></td><td></td><td></td></tr>
            <tr><td style={{ height: 25 }}></td><td></td><td></td><td></td><td></td><td></td></tr>
            <tr><td style={{ height: 25 }}></td><td></td><td></td><td></td><td></td><td></td></tr>

            {/* --- TOTAL ROW --- */}
            <tr style={{ background: "#f5f5f5" }}>
              <td colSpan={5} style={{ fontWeight: "bold", fontSize: 14, borderTop: "2px solid #222", padding: "8px 10px" }}>
                Total
              </td>
              <td style={{ textAlign: "right", fontWeight: "bold", fontSize: 16, borderTop: "2px solid #222", padding: "8px 10px", color: "#b71c1c" }}>
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
                <div style={{ fontWeight: "bold", fontSize: 13, marginBottom: 4 }}>For Swati Tours &amp; Transport</div>
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
                    <div style={{ borderBottom: "1px dashed #999", minHeight: 18 }}></div>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>Stamp / Sign</div>
                    <div style={{ minHeight: 18 }}></div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>Date</div>
                    <div style={{ borderBottom: "1px dashed #999", minHeight: 18 }}></div>
                  </div>
                </div>
              </td>
              <td colSpan={3} style={{ padding: 0, verticalAlign: "top" }}>
                <div style={{ padding: "8px 10px 5px", fontWeight: "bold", fontSize: 13, background: "#f5f5f5", borderBottom: "1px solid #333" }}>
                  Bank Details
                </div>
                <div style={{ padding: "8px 10px", fontSize: 11.5, lineHeight: 1.8 }}>
                  <div><span style={{ color: "#555" }}>Banker Name:</span> <strong>Bank of India</strong></div>
                  <div><span style={{ color: "#555" }}>Account Holder:</span> <strong>Swati Tours and Transport</strong></div>
                  <div><span style={{ color: "#555" }}>Account No:</span> <strong>061320110001257</strong></div>
                  <div><span style={{ color: "#555" }}>IFSC:</span> <strong>BKID0000613</strong></div>
                  <div><span style={{ color: "#555" }}>Branch:</span> <strong>Uttam Nagar, Pune</strong></div>
                </div>
              </td>
            </tr>

          </tbody>
        </table>
      </div>
    </div>
  );
}
