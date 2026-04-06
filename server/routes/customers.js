const express = require("express");
const router = express.Router();
const { sql, getPool } = require("../config/db");

// GET all customers
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query("SELECT * FROM customers ORDER BY created_at DESC");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single customer
router.get("/:id", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .query("SELECT * FROM customers WHERE id = @id");
    if (!result.recordset[0]) return res.status(404).json({ error: "Customer not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create customer
router.post("/", async (req, res) => {
  try {
    const { name, email, phone, address } = req.body;
    const pool = await getPool();
    const result = await pool
      .request()
      .input("name", sql.NVarChar, name)
      .input("email", sql.NVarChar, email)
      .input("phone", sql.NVarChar, phone)
      .input("address", sql.NVarChar, address)
      .query(`
        INSERT INTO customers (name, email, phone, address)
        OUTPUT INSERTED.*
        VALUES (@name, @email, @phone, @address)
      `);
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update customer
router.put("/:id", async (req, res) => {
  try {
    const { name, email, phone, address } = req.body;
    const pool = await getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("name", sql.NVarChar, name)
      .input("email", sql.NVarChar, email)
      .input("phone", sql.NVarChar, phone)
      .input("address", sql.NVarChar, address)
      .query(`
        UPDATE customers SET name=@name, email=@email, phone=@phone, address=@address
        OUTPUT INSERTED.*
        WHERE id=@id
      `);
    if (!result.recordset[0]) return res.status(404).json({ error: "Customer not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE customer
router.delete("/:id", async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input("id", sql.Int, req.params.id).query("DELETE FROM customers WHERE id=@id");
    res.json({ message: "Customer deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
