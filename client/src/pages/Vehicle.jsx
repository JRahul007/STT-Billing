import { useState, useEffect, useMemo } from "react";

const STORAGE_KEY = "vehicle_entries";

const emptyForm = {
  date: "",
  description: "",
  rate: "",
  trip: "",
  start_km: "",
  end_km: "",
  amount: "",
  remark: "",
  bill_no: "",
  client_name: "",
};

export default function Vehicle() {
  const [entries, setEntries] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [filterClient, setFilterClient] = useState("");
  const [filterMonth, setFilterMonth] = useState("");
  const [filterYear, setFilterYear] = useState("");

  // Load entries from localStorage
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      setEntries(Array.isArray(saved) ? saved : []);
    } catch {
      setEntries([]);
    }
  }, []);

  // Persist to localStorage whenever entries change
  const saveAll = (list) => {
    setEntries(list);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  };

  // Auto-calculate amount when rate * trip changes, if user hasn't manually entered one
  const computeAmount = (f) => {
    const rate = parseFloat(f.rate) || 0;
    const trip = parseFloat(f.trip) || 0;
    if (rate && trip) return (rate * trip).toString();
    return f.amount;
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
    setForm({ ...emptyForm, date: new Date().toISOString().slice(0, 10) });
    setShowModal(true);
  };

  const openEdit = (entry) => {
    setEditing(entry);
    setForm({ ...emptyForm, ...entry });
    setShowModal(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { ...form, amount: form.amount || computeAmount(form) };
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
    if (!window.confirm("Delete this vehicle entry?")) return;
    saveAll(entries.filter((en) => en.id !== id));
  };

  // Derived filter options
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

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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
            Showing {filteredEntries.length} of {entries.length} | Total: ₹{totalAmount.toLocaleString("en-IN")}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Rate</th>
              <th>Trip</th>
              <th>Start (km)</th>
              <th>End (km)</th>
              <th>Amount</th>
              <th>Remark</th>
              <th>Bill No.</th>
              <th>Client Name</th>
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
              filteredEntries.map((en) => (
                <tr key={en.id}>
                  <td>{en.date}</td>
                  <td>{en.description}</td>
                  <td>{en.rate ? `₹${en.rate}` : ""}</td>
                  <td>{en.trip}</td>
                  <td>{en.start_km}</td>
                  <td>{en.end_km}</td>
                  <td style={{ fontWeight: 600 }}>{en.amount ? `₹${Number(en.amount).toLocaleString("en-IN")}` : ""}</td>
                  <td>{en.remark}</td>
                  <td>{en.bill_no}</td>
                  <td>{en.client_name}</td>
                  <td style={{ textAlign: "center" }}>
                    <div className="btn-group" style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                      <button className="btn btn-sm" style={{ background: "#0d6efd", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 12 }}
                        onClick={() => openEdit(en)}>Edit</button>
                      <button className="btn btn-sm" style={{ background: "#dc2626", color: "#fff", padding: "4px 10px", borderRadius: 6, fontSize: 12 }}
                        onClick={() => handleDelete(en.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

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
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Date *</label>
                  <input type="date" required value={form.date}
                    onChange={(e) => handleChange("date", e.target.value)}
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
                  <input type="number" step="0.01" value={form.trip}
                    onChange={(e) => handleChange("trip", e.target.value)}
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
                  <label style={{ fontSize: 12, fontWeight: 600, color: "#555", display: "block", marginBottom: 4 }}>Bill No.</label>
                  <input value={form.bill_no}
                    onChange={(e) => handleChange("bill_no", e.target.value)}
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
