const express = require("express");
const router = express.Router();
const { supabase } = require("../config/db");

async function countWhere(table, filters = {}) {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

// GET dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const [
      totalShipments, pendingShipments, inTransitShipments, deliveredShipments,
      totalCustomers, totalVehicles, availableVehicles,
    ] = await Promise.all([
      countWhere("shipments"),
      countWhere("shipments", { status: "Pending" }),
      countWhere("shipments", { status: "In Transit" }),
      countWhere("shipments", { status: "Delivered" }),
      countWhere("customers"),
      countWhere("vehicles"),
      countWhere("vehicles", { status: "Available" }),
    ]);

    res.json({
      totalShipments, pendingShipments, inTransitShipments, deliveredShipments,
      totalCustomers, totalVehicles, availableVehicles,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET billing analytics - monthly data for a given year
// PostgREST has no SQL aggregates, so we fetch the year's rows and aggregate in JS.
// Billing volumes are small enough that this is fine.
router.get("/billing-analytics", async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const start = `${year}-01-01`;
    const end = `${year + 1}-01-01`;

    const { data: rows, error } = await supabase
      .from("billings")
      .select("date, location, total_amount, bom_expense, other_expense")
      .gte("date", start)
      .lt("date", end);
    if (error) throw error;

    // Build full 12-month totals
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      total_amount: 0,
      bom_expense: 0,
      other_expense: 0,
    }));

    // Location-wise monthly totals: map keyed by `${location}|${month}`
    const locMap = new Map();

    for (const r of rows) {
      const m = new Date(r.date).getMonth() + 1; // 1..12
      const total = parseFloat(r.total_amount) || 0;
      const bom = parseFloat(r.bom_expense) || 0;
      const other = parseFloat(r.other_expense) || 0;

      const monthRow = months[m - 1];
      monthRow.total_amount += total;
      monthRow.bom_expense += bom;
      monthRow.other_expense += other;

      const key = `${r.location || ""}|${m}`;
      const existing = locMap.get(key) || {
        location: r.location || "",
        month: m,
        total_amount: 0,
        bom_expense: 0,
        other_expense: 0,
      };
      existing.total_amount += total;
      existing.bom_expense += bom;
      existing.other_expense += other;
      locMap.set(key, existing);
    }

    // Distinct years for dropdown — fetch all dates once
    const { data: allDates, error: yrErr } = await supabase.from("billings").select("date");
    if (yrErr) throw yrErr;
    const yearSet = new Set(allDates.map((r) => new Date(r.date).getFullYear()));
    const availableYears = [...yearSet].sort((a, b) => b - a);

    res.json({
      year,
      months,
      locationData: [...locMap.values()].sort(
        (a, b) => a.location.localeCompare(b.location) || a.month - b.month
      ),
      availableYears,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
