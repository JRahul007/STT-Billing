const express = require("express");
const router = express.Router();
const { sql, getPool } = require("../config/db");

// GET dashboard stats
router.get("/stats", async (req, res) => {
  try {
    const pool = await getPool();

    const shipments = await pool.request().query("SELECT COUNT(*) as total FROM shipments");
    const pending = await pool.request().query("SELECT COUNT(*) as total FROM shipments WHERE status='Pending'");
    const inTransit = await pool.request().query("SELECT COUNT(*) as total FROM shipments WHERE status='In Transit'");
    const delivered = await pool.request().query("SELECT COUNT(*) as total FROM shipments WHERE status='Delivered'");
    const customers = await pool.request().query("SELECT COUNT(*) as total FROM customers");
    const vehicles = await pool.request().query("SELECT COUNT(*) as total FROM vehicles");
    const availableVehicles = await pool.request().query("SELECT COUNT(*) as total FROM vehicles WHERE status='Available'");

    res.json({
      totalShipments: shipments.recordset[0].total,
      pendingShipments: pending.recordset[0].total,
      inTransitShipments: inTransit.recordset[0].total,
      deliveredShipments: delivered.recordset[0].total,
      totalCustomers: customers.recordset[0].total,
      totalVehicles: vehicles.recordset[0].total,
      availableVehicles: availableVehicles.recordset[0].total,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET billing analytics - monthly data for a given year
router.get("/billing-analytics", async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const pool = await getPool();

    // Monthly totals: total_amount, bom_expense, other_expense
    const monthlyResult = await pool
      .request()
      .input("year", sql.Int, year)
      .query(`
        SELECT
          MONTH(date) as month,
          ISNULL(SUM(total_amount), 0) as total_amount,
          ISNULL(SUM(bom_expense), 0) as bom_expense,
          ISNULL(SUM(other_expense), 0) as other_expense
        FROM billings
        WHERE YEAR(date) = @year
        GROUP BY MONTH(date)
        ORDER BY MONTH(date)
      `);

    // Build full 12-month array
    const months = [];
    for (let m = 1; m <= 12; m++) {
      const row = monthlyResult.recordset.find((r) => r.month === m);
      months.push({
        month: m,
        total_amount: row ? parseFloat(row.total_amount) : 0,
        bom_expense: row ? parseFloat(row.bom_expense) : 0,
        other_expense: row ? parseFloat(row.other_expense) : 0,
      });
    }

    // Location-wise monthly totals
    const locationResult = await pool
      .request()
      .input("year2", sql.Int, year)
      .query(`
        SELECT
          location,
          MONTH(date) as month,
          ISNULL(SUM(total_amount), 0) as total_amount,
          ISNULL(SUM(bom_expense), 0) as bom_expense,
          ISNULL(SUM(other_expense), 0) as other_expense
        FROM billings
        WHERE YEAR(date) = @year2
        GROUP BY location, MONTH(date)
        ORDER BY location, MONTH(date)
      `);

    // Get distinct years for dropdown
    const yearsResult = await pool
      .request()
      .query("SELECT DISTINCT YEAR(date) as yr FROM billings ORDER BY yr DESC");

    res.json({
      year,
      months,
      locationData: locationResult.recordset.map((r) => ({
        ...r,
        total_amount: parseFloat(r.total_amount),
        bom_expense: parseFloat(r.bom_expense),
        other_expense: parseFloat(r.other_expense),
      })),
      availableYears: yearsResult.recordset.map((r) => r.yr),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
