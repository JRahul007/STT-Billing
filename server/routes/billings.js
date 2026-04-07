const express = require("express");
const router = express.Router();
const { pool, isDbAvailable } = require("../config/db");

// Middleware: short-circuit if DB is offline
function requireDb(req, res, next) {
  if (!isDbAvailable()) {
    return res.status(503).json({ error: "Database offline", offline: true });
  }
  next();
}
router.use(requireDb);

// Helper: extract extra_data JSON from request body
function extractExtraData(body) {
  const {
    show_packaging, boxes, box_rate,
    show_oda, oda_location, oda_person, oda_amount,
    show_pickup, pickup_rate, pickup_entries,
    show_other, other_desc, other_amount,
  } = body;
  return JSON.stringify({
    show_packaging: show_packaging || false,
    boxes: boxes || "1",
    box_rate: box_rate || "150",
    show_oda: show_oda || false,
    oda_location: oda_location || "",
    oda_person: oda_person || "",
    oda_amount: oda_amount || "",
    show_pickup: show_pickup || false,
    pickup_rate: pickup_rate || "600",
    pickup_entries: pickup_entries || [],
    show_other: show_other || false,
    other_desc: other_desc || "",
    other_amount: other_amount || "",
  });
}

// Helper: merge extra_data JSON back into the row for the client
function expandRow(row) {
  if (!row) return row;
  if (row.extra_data) {
    try {
      const extras = typeof row.extra_data === "string" ? JSON.parse(row.extra_data) : row.extra_data;
      return { ...row, ...extras };
    } catch (e) { /* ignore */ }
  }
  return row;
}

// GET all billings
router.get("/", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM billings ORDER BY created_at DESC");
    res.json(result.rows.map(expandRow));
  } catch (err) {
    console.error("Billings route error:", err);
    res.status(500).json({ error: err.message || String(err), code: err.code, detail: err.detail });
  }
});

// POST create billing
router.post("/", async (req, res) => {
  try {
    const { invoice_no, date, location, weight, total_amount, bom_expense, bom_exp_description, other_expense, other_exp_description, payment_status, invoice_data } = req.body;
    const extra_data = extractExtraData(req.body);
    const result = await pool.query(
      `INSERT INTO billings (invoice_no, date, location, weight, total_amount, bom_expense, bom_exp_description, other_expense, other_exp_description, payment_status, invoice_data, extra_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [invoice_no, date || null, location, weight || null, total_amount || null, bom_expense || null, bom_exp_description, other_expense || null, other_exp_description, payment_status || "NOTPAID", invoice_data || null, extra_data]
    );
    res.status(201).json(expandRow(result.rows[0]));
  } catch (err) {
    console.error("Billings route error:", err);
    res.status(500).json({ error: err.message || String(err), code: err.code, detail: err.detail });
  }
});

// PUT update billing
router.put("/:id", async (req, res) => {
  try {
    const { invoice_no, date, location, weight, total_amount, bom_expense, bom_exp_description, other_expense, other_exp_description, payment_status, invoice_data } = req.body;
    const extra_data = extractExtraData(req.body);
    const result = await pool.query(
      `UPDATE billings SET invoice_no=$1, date=$2, location=$3, weight=$4, total_amount=$5,
       bom_expense=$6, bom_exp_description=$7, other_expense=$8, other_exp_description=$9,
       payment_status=$10, invoice_data=$11, extra_data=$12 WHERE id=$13 RETURNING *`,
      [invoice_no, date || null, location, weight || null, total_amount || null, bom_expense || null, bom_exp_description, other_expense || null, other_exp_description, payment_status, invoice_data || null, extra_data, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Billing not found" });
    res.json(expandRow(result.rows[0]));
  } catch (err) {
    console.error("Billings route error:", err);
    res.status(500).json({ error: err.message || String(err), code: err.code, detail: err.detail });
  }
});

// PUT upsert by invoice_no (for saving from frontend)
router.put("/upsert/:invoice_no", async (req, res) => {
  try {
    const { date, location, weight, total_amount, bom_expense, bom_exp_description, other_expense, other_exp_description, payment_status, invoice_data } = req.body;
    const inv = req.params.invoice_no;
    const extra_data = extractExtraData(req.body);
    const existing = await pool.query("SELECT id FROM billings WHERE invoice_no=$1", [inv]);
    let result;
    if (existing.rows.length > 0) {
      result = await pool.query(
        `UPDATE billings SET date=$1, location=$2, weight=$3, total_amount=$4, bom_expense=$5,
         bom_exp_description=$6, other_expense=$7, other_exp_description=$8, payment_status=$9,
         invoice_data=$10, extra_data=$11 WHERE invoice_no=$12 RETURNING *`,
        [date || null, location, weight || null, total_amount || null, bom_expense || null, bom_exp_description, other_expense || null, other_exp_description, payment_status, invoice_data || null, extra_data, inv]
      );
    } else {
      result = await pool.query(
        `INSERT INTO billings (invoice_no, date, location, weight, total_amount, bom_expense, bom_exp_description, other_expense, other_exp_description, payment_status, invoice_data, extra_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [inv, date || null, location, weight || null, total_amount || null, bom_expense || null, bom_exp_description, other_expense || null, other_exp_description, payment_status || "NOTPAID", invoice_data || null, extra_data]
      );
    }
    res.json(expandRow(result.rows[0]));
  } catch (err) {
    console.error("Billings route error:", err);
    res.status(500).json({ error: err.message || String(err), code: err.code, detail: err.detail });
  }
});

// DELETE billing
router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM billings WHERE id=$1", [req.params.id]);
    res.json({ message: "Billing deleted" });
  } catch (err) {
    console.error("Billings route error:", err);
    res.status(500).json({ error: err.message || String(err), code: err.code, detail: err.detail });
  }
});

module.exports = router;
