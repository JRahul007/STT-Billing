const express = require("express");
const router = express.Router();
const { supabase } = require("../config/db");

// Helper: extract extra_data JSON from request body
function extractExtraData(body) {
  const {
    show_packaging, packaging_mode, boxes, total_boxes, box_rate, packaging_entries,
    show_oda, oda_location, oda_person, oda_amount,
    show_pickup, pickup_rate, pickup_entries,
    show_other, other_desc, other_amount, other_entries,
    consigner_name, consigner_address, consigner_mobile,
    consignee_name, consignee_address, consignee_mobile,
  } = body;
  return {
    show_packaging: show_packaging || false,
    packaging_mode: packaging_mode || "box",
    boxes: boxes || "1",
    total_boxes: total_boxes || "1",
    box_rate: box_rate || "150",
    packaging_entries: packaging_entries || [],
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
    other_entries: other_entries || [],
    consigner_name: consigner_name || "",
    consigner_address: consigner_address || "",
    consigner_mobile: consigner_mobile || "",
    consignee_name: consignee_name || "",
    consignee_address: consignee_address || "",
    consignee_mobile: consignee_mobile || "",
  };
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

// Helper: build the column payload for insert/update
function buildPayload(body) {
  const {
    invoice_no, date, location, weight, total_amount,
    bom_expense, bom_exp_description,
    other_expense, other_exp_description,
    payment_status, invoice_data,
  } = body;
  return {
    invoice_no,
    date: date || null,
    location,
    weight: weight || null,
    total_amount: total_amount || null,
    bom_expense: bom_expense || null,
    bom_exp_description,
    other_expense: other_expense || null,
    other_exp_description,
    payment_status: payment_status || "NOTPAID",
    invoice_data: invoice_data || null,
    extra_data: extractExtraData(body),
  };
}

function fail(res, err) {
  console.error("Billings route error:", err);
  res.status(500).json({ error: err.message || String(err), code: err.code, detail: err.details });
}

// GET all billings
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("billings")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data.map(expandRow));
  } catch (err) { fail(res, err); }
});

// POST create billing
router.post("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("billings")
      .insert(buildPayload(req.body))
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(expandRow(data));
  } catch (err) { fail(res, err); }
});

// PUT update billing
router.put("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("billings")
      .update(buildPayload(req.body))
      .eq("id", req.params.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Billing not found" });
    res.json(expandRow(data));
  } catch (err) { fail(res, err); }
});

// PUT upsert by invoice_no (for saving from frontend)
router.put("/upsert/:invoice_no", async (req, res) => {
  try {
    const inv = req.params.invoice_no;
    const payload = { ...buildPayload(req.body), invoice_no: inv };
    const { data, error } = await supabase
      .from("billings")
      .upsert(payload, { onConflict: "invoice_no" })
      .select()
      .single();
    if (error) throw error;
    res.json(expandRow(data));
  } catch (err) { fail(res, err); }
});

// DELETE billing
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("billings").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ message: "Billing deleted" });
  } catch (err) { fail(res, err); }
});

module.exports = router;
