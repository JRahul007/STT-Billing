const express = require("express");
const router = express.Router();
const { sql, getPool } = require("../config/db");

// GET all billings
router.get("/", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query("SELECT * FROM billings ORDER BY created_at DESC");
    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create billing
router.post("/", async (req, res) => {
  try {
    const { invoice_no, date, location, weight, total_amount, bom_expense, bom_exp_description, other_expense, other_exp_description, payment_status } = req.body;
    const pool = await getPool();
    const result = await pool
      .request()
      .input("invoice_no", sql.NVarChar, invoice_no)
      .input("date", sql.Date, date)
      .input("location", sql.NVarChar, location)
      .input("weight", sql.Decimal(10, 2), weight)
      .input("total_amount", sql.Decimal(12, 2), total_amount)
      .input("bom_expense", sql.Decimal(12, 2), bom_expense)
      .input("bom_exp_description", sql.NVarChar, bom_exp_description)
      .input("other_expense", sql.Decimal(12, 2), other_expense)
      .input("other_exp_description", sql.NVarChar, other_exp_description)
      .input("payment_status", sql.NVarChar, payment_status || "NOTPAID")
      .query(`
        INSERT INTO billings (invoice_no, date, location, weight, total_amount, bom_expense, bom_exp_description, other_expense, other_exp_description, payment_status)
        OUTPUT INSERTED.*
        VALUES (@invoice_no, @date, @location, @weight, @total_amount, @bom_expense, @bom_exp_description, @other_expense, @other_exp_description, @payment_status)
      `);
    res.status(201).json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update billing
router.put("/:id", async (req, res) => {
  try {
    const { invoice_no, date, location, weight, total_amount, bom_expense, bom_exp_description, other_expense, other_exp_description, payment_status } = req.body;
    const pool = await getPool();
    const result = await pool
      .request()
      .input("id", sql.Int, req.params.id)
      .input("invoice_no", sql.NVarChar, invoice_no)
      .input("date", sql.Date, date)
      .input("location", sql.NVarChar, location)
      .input("weight", sql.Decimal(10, 2), weight)
      .input("total_amount", sql.Decimal(12, 2), total_amount)
      .input("bom_expense", sql.Decimal(12, 2), bom_expense)
      .input("bom_exp_description", sql.NVarChar, bom_exp_description)
      .input("other_expense", sql.Decimal(12, 2), other_expense)
      .input("other_exp_description", sql.NVarChar, other_exp_description)
      .input("payment_status", sql.NVarChar, payment_status)
      .query(`
        UPDATE billings
        SET invoice_no=@invoice_no, date=@date, location=@location, weight=@weight,
            total_amount=@total_amount, bom_expense=@bom_expense, bom_exp_description=@bom_exp_description,
            other_expense=@other_expense, other_exp_description=@other_exp_description, payment_status=@payment_status
        OUTPUT INSERTED.*
        WHERE id=@id
      `);
    if (!result.recordset[0]) return res.status(404).json({ error: "Billing not found" });
    res.json(result.recordset[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE billing
router.delete("/:id", async (req, res) => {
  try {
    const pool = await getPool();
    await pool.request().input("id", sql.Int, req.params.id).query("DELETE FROM billings WHERE id=@id");
    res.json({ message: "Billing deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
