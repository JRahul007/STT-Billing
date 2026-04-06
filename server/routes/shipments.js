const express = require("express");
const router = express.Router();
const { sql, getPool } = require("../config/db");

// GET all shipments
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT s.*, c.name as customer_name
      FROM shipments s
      LEFT JOIN customers c ON s.customer_id = c.id
      ORDER BY s.created_at DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single shipment
router.get("/:id", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("SELECT s.*, c.name as customer_name FROM shipments s LEFT JOIN customers c ON s.customer_id = c.id WHERE s.id = @id");
    if (!result.recordset[0]) return res.status(404).json({ error: "Shipment not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create shipment
router.post("/", async (req, res) => {
  try {
    const { customer_id, origin, destination, weight, status, estimated_delivery } = req.body;
    const tracking_number = "TRK" + Date.now().toString(36).toUpperCase();
    const pool = await getPool();
    const result = await pool
      .request()
      .input("tracking_number", sql.NVarChar, tracking_number)
      .input("customer_id", sql.Int, customer_id)
      .input("origin", sql.NVarChar, origin)
      .input("destination", sql.NVarChar, destination)
      .input("weight", sql.Decimal(10, 2), weight)
      .input("status", sql.NVarChar, status || "Pending")
      .input("estimated_delivery", sql.Date, estimated_delivery)
      .query(`
        INSERT INTO shipments (tracking_number, customer_id, origin, destination, weight, status, estimated_delivery)
        OUTPUT INSERTED.*
        VALUES (@tracking_number, @customer_id, @origin, @destination, @weight, @status, @estimated_delivery)
      `);
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update shipment
router.put("/:id", async (req, res) => {
  try {
    const { origin, destination, weight, status, estimated_delivery } = req.body;
    const pool = await getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("origin", sql.NVarChar, origin)
      .input("destination", sql.NVarChar, destination)
      .input("weight", sql.Decimal(10, 2), weight)
      .input("status", sql.NVarChar, status)
      .input("estimated_delivery", sql.Date, estimated_delivery)
      .query(`
        UPDATE shipments
        SET origin=@origin, destination=@destination, weight=@weight, status=@status,
            estimated_delivery=@estimated_delivery, updated_at=GETDATE()
        OUTPUT INSERTED.*
        WHERE id=@id
      `);
    if (!result.recordset[0]) return res.status(404).json({ error: "Shipment not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE shipment
router.delete("/:id", async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input("id", sql.Int, req.params.id).query("DELETE FROM shipments WHERE id=@id");
    res.json({ message: "Shipment deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
