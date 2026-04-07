const express = require("express");
const router = express.Router();
const { pool, isDbAvailable } = require("../config/db");

router.use((req, res, next) => {
  if (!isDbAvailable()) {
    return res.status(503).json({ error: "Database offline", offline: true });
  }
  next();
});

// GET dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const [shipments, pending, inTransit, delivered, customers, vehicles, availableVehicles] = await Promise.all([
      pool.query("SELECT COUNT(*) as total FROM shipments"),
      pool.query("SELECT COUNT(*) as total FROM shipments WHERE status='Pending'"),
      pool.query("SELECT COUNT(*) as total FROM shipments WHERE status='In Transit'"),
      pool.query("SELECT COUNT(*) as total FROM shipments WHERE status='Delivered'"),
      pool.query("SELECT COUNT(*) as total FROM customers"),
      pool.query("SELECT COUNT(*) as total FROM vehicles"),
      pool.query("SELECT COUNT(*) as total FROM vehicles WHERE status='Available'"),
    ]);

    res.json({
      totalShipments: parseInt(shipments.rows[0].total),
      pendingShipments: parseInt(pending.rows[0].total),
      inTransitShipments: parseInt(inTransit.rows[0].total),
      deliveredShipments: parseInt(delivered.rows[0].total),
      totalCustomers: parseInt(customers.rows[0].total),
      totalVehicles: parseInt(vehicles.rows[0].total),
      availableVehicles: parseInt(availableVehicles.rows[0].total),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET billing analytics - monthly data for a given year
router.get("/billing-analytics", async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();

    // Monthly totals
    const monthlyResult = await pool.query(
      `SELECT
         EXTRACT(MONTH FROM date)::int as month,
         COALESCE(SUM(total_amount), 0) as total_amount,
         COALESCE(SUM(bom_expense), 0) as bom_expense,
         COALESCE(SUM(other_expense), 0) as other_expense
       FROM billings
       WHERE EXTRACT(YEAR FROM date) = $1
       GROUP BY EXTRACT(MONTH FROM date)
       ORDER BY EXTRACT(MONTH FROM date)`,
      [year]
    );

    // Build full 12-month array
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const row = monthlyResult.rows.find((r) => r.month === m);
      months.push({
        month: m,
        total_amount: row ? parseFloat(row.total_amount) : 0,
        bom_expense: row ? parseFloat(row.bom_expense) : 0,
        other_expense: row ? parseFloat(row.other_expense) : 0,
      });
    }

    // Location-wise monthly totals
    const locationResult = await pool.query(
      `SELECT
         location,
         EXTRACT(MONTH FROM date)::int as month,
         COALESCE(SUM(total_amount), 0) as total_amount,
         COALESCE(SUM(bom_expense), 0) as bom_expense,
         COALESCE(SUM(other_expense), 0) as other_expense
       FROM billings
       WHERE EXTRACT(YEAR FROM date) = $1
       GROUP BY location, EXTRACT(MONTH FROM date)
       ORDER BY location, EXTRACT(MONTH FROM date)`,
      [year]
    );

    // Distinct years for dropdown
    const yearsResult = await pool.query(
      "SELECT DISTINCT EXTRACT(YEAR FROM date)::int as yr FROM billings ORDER BY yr DESC"
    );

    res.json({
      year,
      months,
      locationData: locationResult.rows.map((r) => ({
        ...r,
        total_amount: parseFloat(r.total_amount),
        bom_expense: parseFloat(r.bom_expense),
        other_expense: parseFloat(r.other_expense),
      })),
      availableYears: yearsResult.rows.map((r) => r.yr),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
