const express = require("express");
const router = express.Router();
const { sql, getPool } = require("../config/db");

// GET all vehicles
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query("SELECT * FROM vehicles ORDER BY created_at DESC");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create vehicle
router.post("/", async (req, res) => {
  try {
    const { vehicle_number, type, capacity, status, driver_name, driver_phone } = req.body;
    const pool = await getPool();
    const result = await pool
      .request()
      .input("vehicle_number", sql.NVarChar, vehicle_number)
      .input("type", sql.NVarChar, type)
      .input("capacity", sql.Decimal(10, 2), capacity)
      .input("status", sql.NVarChar, status || "Available")
      .input("driver_name", sql.NVarChar, driver_name)
      .input("driver_phone", sql.NVarChar, driver_phone)
      .query(`
        INSERT INTO vehicles (vehicle_number, type, capacity, status, driver_name, driver_phone)
        OUTPUT INSERTED.*
        VALUES (@vehicle_number, @type, @capacity, @status, @driver_name, @driver_phone)
      `);
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update vehicle
router.put("/:id", async (req, res) => {
  try {
    const { vehicle_number, type, capacity, status, driver_name, driver_phone } = req.body;
    const pool = await getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("vehicle_number", sql.NVarChar, vehicle_number)
      .input("type", sql.NVarChar, type)
      .input("capacity", sql.Decimal(10, 2), capacity)
      .input("status", sql.NVarChar, status)
      .input("driver_name", sql.NVarChar, driver_name)
      .input("driver_phone", sql.NVarChar, driver_phone)
      .query(`
        UPDATE vehicles
        SET vehicle_number=@vehicle_number, type=@type, capacity=@capacity,
            status=@status, driver_name=@driver_name, driver_phone=@driver_phone
        OUTPUT INSERTED.*
        WHERE id=@id
      `);
    if (!result.recordset[0]) return res.status(404).json({ error: "Vehicle not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE vehicle
router.delete("/:id", async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input("id", sql.Int, req.params.id).query("DELETE FROM vehicles WHERE id=@id");
    res.json({ message: "Vehicle deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
