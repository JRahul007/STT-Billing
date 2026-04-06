import { useState, useEffect, useMemo } from "react";
import { getBillingAnalytics, getBillings } from "../services/api";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line
} from "recharts";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Extract location from route: BOM is home, so BOM-PUNE → PUNE, IDR-BOM → IDR
function extractLocation(routeStr) {
  if (!routeStr) return null;
  // Remove client name in parentheses: "BOM-PUNE(ClientName)" → "BOM-PUNE"
  const route = routeStr.replace(/\(.*\)/, "").trim().toUpperCase();
  const parts = route.split("-");
  if (parts.length !== 2) return null;
  const [from, to] = parts;
  if (from === "BOM") return to;
  if (to === "BOM") return from;
  // If neither is BOM, return the full route
  return route;
}

function formatAmount(val) {
  if (val >= 100000) return (val / 100000).toFixed(1) + "L";
  if (val >= 1000) return (val / 1000).toFixed(1) + "K";
  return val.toFixed(0);
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 8, padding: "10px 14px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
      <p style={{ fontWeight: 600, marginBottom: 6 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontSize: 13, margin: "2px 0" }}>
          {p.name}: ₹{Number(p.value).toLocaleString("en-IN")}
        </p>
      ))}
    </div>
  );
};

export default function Dashboard() {
  const [analytics, setAnalytics] = useState(null);
  const [allBillings, setAllBillings] = useState([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState([new Date().getFullYear()]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [locationMonth, setLocationMonth] = useState(""); // "" = all months, 1-12 = specific month for location section
  const [expenseView, setExpenseView] = useState("bom_expense"); // bom_expense | other_expense
  const [selectedMonth, setSelectedMonth] = useState(""); // "" = all months, 1-12 = specific month

  useEffect(() => {
    // Try API first, fall back to localStorage
    getBillingAnalytics(selectedYear)
      .then((res) => {
        setAnalytics(res.data);
        if (res.data.availableYears && res.data.availableYears.length) {
          setAvailableYears(res.data.availableYears);
        }
      })
      .catch(() => setAnalytics(null));

    // Also load billings for location-based calculations (merge API + localStorage)
    getBillings()
      .then((res) => {
        const apiBillings = res.data || [];
        const localBillings = JSON.parse(localStorage.getItem("invoices") || "[]");
        const merged = [...apiBillings];
        const apiInvoiceNos = new Set(apiBillings.map((b) => b.invoice_no));
        localBillings.forEach((b) => {
          if (!apiInvoiceNos.has(b.invoice_no)) merged.push(b);
        });
        setAllBillings(merged);
      })
      .catch(() => {
        const localBillings = JSON.parse(localStorage.getItem("invoices") || "[]");
        setAllBillings(localBillings);
      });
  }, [selectedYear]);

  // Compute unique locations from all billings
  const locations = useMemo(() => {
    const locSet = new Set();
    allBillings.forEach((b) => {
      const loc = extractLocation(b.location);
      if (loc) locSet.add(loc);
    });
    return Array.from(locSet).sort();
  }, [allBillings]);

  // Monthly chart data from analytics API or computed from local billings
  const monthlyChartData = useMemo(() => {
    if (analytics && analytics.months) {
      return analytics.months.map((m) => ({
        name: MONTH_NAMES[m.month - 1],
        month: m.month,
        "Total Amount": m.total_amount,
        "BOM Expense": m.bom_expense,
        "Other Expense": m.other_expense,
      }));
    }
    // Fallback: compute from allBillings
    const monthData = Array.from({ length: 12 }, (_, i) => ({
      name: MONTH_NAMES[i],
      month: i + 1,
      "Total Amount": 0,
      "BOM Expense": 0,
      "Other Expense": 0,
    }));
    allBillings.forEach((b) => {
      const d = new Date(b.date);
      if (d.getFullYear() === selectedYear) {
        const mi = d.getMonth();
        monthData[mi]["Total Amount"] += parseFloat(b.total_amount || 0);
        monthData[mi]["BOM Expense"] += parseFloat(b.bom_expense || 0);
        monthData[mi]["Other Expense"] += parseFloat(b.other_expense || 0);
      }
    });
    return monthData;
  }, [analytics, allBillings, selectedYear]);

  // Location-wise monthly data - computed from allBillings (already merged API + localStorage)
  const locationChartData = useMemo(() => {
    if (!selectedLocation) return [];
    const monthData = Array.from({ length: 12 }, (_, i) => ({
      name: MONTH_NAMES[i],
      month: i + 1,
      "Total Amount": 0,
      "BOM Expense": 0,
      "Other Expense": 0,
    }));

    allBillings.forEach((b) => {
      const d = new Date(b.date);
      if (d.getFullYear() === selectedYear && extractLocation(b.location) === selectedLocation) {
        const mi = d.getMonth();
        monthData[mi]["Total Amount"] += parseFloat(b.total_amount || 0);
        monthData[mi]["BOM Expense"] += parseFloat(b.bom_expense || 0);
        monthData[mi]["Other Expense"] += parseFloat(b.other_expense || 0);
      }
    });

    return monthData;
  }, [selectedLocation, allBillings, selectedYear]);

  // Expense chart data (selected expense type by month)
  const expenseChartData = useMemo(() => {
    const label = expenseView === "bom_expense" ? "BOM Expense" : "Other Expense";
    return monthlyChartData.map((m) => ({
      name: m.name,
      [label]: m[label],
    }));
  }, [monthlyChartData, expenseView]);

  // Yearly summary totals (always full year)
  const yearlyTotals = useMemo(() => {
    return monthlyChartData.reduce(
      (acc, m) => ({
        total: acc.total + m["Total Amount"],
        bom: acc.bom + m["BOM Expense"],
        other: acc.other + m["Other Expense"],
      }),
      { total: 0, bom: 0, other: 0 }
    );
  }, [monthlyChartData]);

  // Location yearly totals
  const locationYearlyTotals = useMemo(() => {
    if (!selectedLocation || !locationChartData.length) return { total: 0, bom: 0, other: 0 };
    return locationChartData.reduce(
      (acc, m) => ({
        total: acc.total + m["Total Amount"],
        bom: acc.bom + m["BOM Expense"],
        other: acc.other + m["Other Expense"],
      }),
      { total: 0, bom: 0, other: 0 }
    );
  }, [locationChartData, selectedLocation]);

  // Location monthly totals (for selected month)
  const locationMonthlyTotals = useMemo(() => {
    if (!selectedLocation || !locationMonth || !locationChartData.length) return null;
    const m = locationChartData[parseInt(locationMonth) - 1];
    if (!m) return null;
    return { total: m["Total Amount"], bom: m["BOM Expense"], other: m["Other Expense"] };
  }, [locationChartData, locationMonth, selectedLocation]);

  // Monthly totals (for selected month)
  const monthlyTotals = useMemo(() => {
    if (!selectedMonth) return null;
    const m = monthlyChartData[parseInt(selectedMonth) - 1];
    if (!m) return null;
    return { total: m["Total Amount"], bom: m["BOM Expense"], other: m["Other Expense"] };
  }, [monthlyChartData, selectedMonth]);

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label style={{ fontSize: 14, fontWeight: 500 }}>Year:</label>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
          >
            {availableYears.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
            {!availableYears.includes(new Date().getFullYear()) && (
              <option value={new Date().getFullYear()}>{new Date().getFullYear()}</option>
            )}
          </select>
        </div>
      </div>

      {/* Yearly Summary Cards */}
      <div className="stats-grid" style={{ marginBottom: 10 }}>
        <div className="stat-card blue">
          <div className="label">Yearly Total Billing ({selectedYear})</div>
          <div className="value">₹{yearlyTotals.total.toLocaleString("en-IN")}</div>
        </div>
        <div className="stat-card orange">
          <div className="label">Yearly BOM Expense ({selectedYear})</div>
          <div className="value">₹{yearlyTotals.bom.toLocaleString("en-IN")}</div>
        </div>
        <div className="stat-card red">
          <div className="label">Yearly Other Expense ({selectedYear})</div>
          <div className="value">₹{yearlyTotals.other.toLocaleString("en-IN")}</div>
        </div>
      </div>

      {/* Monthly Filter + Monthly Summary Cards */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 14, fontWeight: 500 }}>Filter by Month:</label>
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
        >
          <option value="">-- All Months --</option>
          {MONTH_NAMES.map((name, i) => (
            <option key={i} value={i + 1}>{name}</option>
          ))}
        </select>
      </div>
      {monthlyTotals && (
        <div className="stats-grid" style={{ marginBottom: 30 }}>
          <div className="stat-card blue">
            <div className="label">{MONTH_NAMES[selectedMonth - 1]} {selectedYear} - Total Billing</div>
            <div className="value">₹{monthlyTotals.total.toLocaleString("en-IN")}</div>
          </div>
          <div className="stat-card orange">
            <div className="label">{MONTH_NAMES[selectedMonth - 1]} {selectedYear} - BOM Expense</div>
            <div className="value">₹{monthlyTotals.bom.toLocaleString("en-IN")}</div>
          </div>
          <div className="stat-card red">
            <div className="label">{MONTH_NAMES[selectedMonth - 1]} {selectedYear} - Other Expense</div>
            <div className="value">₹{monthlyTotals.other.toLocaleString("en-IN")}</div>
          </div>
        </div>
      )}

      {/* Monthly Billing Total Chart */}
      <div className="chart-card">
        <h3>Monthly Billing Total - {selectedYear}</h3>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={monthlyChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 13 }} />
            <YAxis tickFormatter={formatAmount} tick={{ fontSize: 12 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Bar dataKey="Total Amount" fill="#4361ee" radius={[6, 6, 0, 0]} />
            <Bar dataKey="BOM Expense" fill="#f77f00" radius={[6, 6, 0, 0]} />
            <Bar dataKey="Other Expense" fill="#e63946" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Expense Breakdown Section */}
      <div className="chart-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3>Monthly Expense Breakdown - {selectedYear}</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className={`btn btn-sm ${expenseView === "bom_expense" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setExpenseView("bom_expense")}
            >
              BOM Expense
            </button>
            <button
              className={`btn btn-sm ${expenseView === "other_expense" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setExpenseView("other_expense")}
            >
              Other Expense
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={expenseChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 13 }} />
            <YAxis tickFormatter={formatAmount} tick={{ fontSize: 12 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Line
              type="monotone"
              dataKey={expenseView === "bom_expense" ? "BOM Expense" : "Other Expense"}
              stroke={expenseView === "bom_expense" ? "#f77f00" : "#e63946"}
              strokeWidth={3}
              dot={{ r: 5 }}
              activeDot={{ r: 7 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Location-wise Section */}
      <div className="chart-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h3>Location-wise Monthly Billing - {selectedYear}</h3>
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14, minWidth: 150 }}
          >
            <option value="">-- Select Location --</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
        </div>
        {selectedLocation ? (
          <>
            {/* Location Yearly Summary */}
            <div className="stats-grid" style={{ marginBottom: 10 }}>
              <div className="stat-card blue">
                <div className="label">{selectedLocation} - Yearly Total ({selectedYear})</div>
                <div className="value" style={{ fontSize: 22 }}>
                  ₹{locationYearlyTotals.total.toLocaleString("en-IN")}
                </div>
              </div>
              <div className="stat-card orange">
                <div className="label">{selectedLocation} - Yearly BOM Expense</div>
                <div className="value" style={{ fontSize: 22 }}>
                  ₹{locationYearlyTotals.bom.toLocaleString("en-IN")}
                </div>
              </div>
              <div className="stat-card red">
                <div className="label">{selectedLocation} - Yearly Other Expense</div>
                <div className="value" style={{ fontSize: 22 }}>
                  ₹{locationYearlyTotals.other.toLocaleString("en-IN")}
                </div>
              </div>
            </div>

            {/* Location Month Filter */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <label style={{ fontSize: 14, fontWeight: 500 }}>Filter by Month:</label>
              <select
                value={locationMonth}
                onChange={(e) => setLocationMonth(e.target.value)}
                style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #ddd", fontSize: 14 }}
              >
                <option value="">-- All Months --</option>
                {MONTH_NAMES.map((name, i) => (
                  <option key={i} value={i + 1}>{name}</option>
                ))}
              </select>
            </div>

            {/* Location Monthly Summary */}
            {locationMonthlyTotals && (
              <div className="stats-grid" style={{ marginBottom: 20 }}>
                <div className="stat-card blue">
                  <div className="label">{selectedLocation} - {MONTH_NAMES[locationMonth - 1]} {selectedYear} Total</div>
                  <div className="value" style={{ fontSize: 22 }}>
                    ₹{locationMonthlyTotals.total.toLocaleString("en-IN")}
                  </div>
                </div>
                <div className="stat-card orange">
                  <div className="label">{selectedLocation} - {MONTH_NAMES[locationMonth - 1]} BOM Expense</div>
                  <div className="value" style={{ fontSize: 22 }}>
                    ₹{locationMonthlyTotals.bom.toLocaleString("en-IN")}
                  </div>
                </div>
                <div className="stat-card red">
                  <div className="label">{selectedLocation} - {MONTH_NAMES[locationMonth - 1]} Other Expense</div>
                  <div className="value" style={{ fontSize: 22 }}>
                    ₹{locationMonthlyTotals.other.toLocaleString("en-IN")}
                  </div>
                </div>
              </div>
            )}

            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={locationChartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 13 }} />
                <YAxis tickFormatter={formatAmount} tick={{ fontSize: 12 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar dataKey="Total Amount" fill="#4361ee" radius={[6, 6, 0, 0]} />
                <Bar dataKey="BOM Expense" fill="#f77f00" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Other Expense" fill="#e63946" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </>
        ) : (
          <div className="empty-state" style={{ padding: 40 }}>
            <p>Select a location to view monthly billing data</p>
            <p style={{ fontSize: 13, marginTop: 8, color: "#aaa" }}>
              Locations are derived from routes (e.g. BOM-PUNE / PUNE-BOM → PUNE)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
