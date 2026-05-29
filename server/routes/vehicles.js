const express = require("express");
const router = express.Router();
const { supabase } = require("../config/db");

// Treat blank strings as NULL so NUMERIC / DATE columns don't choke.
function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.trim() === "" ? null : s;
}

// Map req.body → vehicles columns. The client mirrors the table layout
// (see server/sql/schema.sql), so we just whitelist and normalise here.
function buildPayload(body) {
  return {
    invoice_no:          str(body.invoice_no),
    date:                str(body.date),
    trip_date:           str(body.trip_date),
    client_name:         str(body.client_name),
    description:         str(body.description),
    rate:                num(body.rate),
    trip:                str(body.trip),
    start_km:            num(body.start_km),
    end_km:              num(body.end_km),
    total_km:            num(body.total_km),
    amount:              num(body.amount),
    expenses:            num(body.expenses),
    remark:              str(body.remark),
    description_entries: Array.isArray(body.description_entries) ? body.description_entries : [],
  };
}

function fail(res, err) {
  console.error("Vehicles route error:", err);
  res.status(500).json({ error: err.message || String(err), code: err.code, detail: err.details });
}

// GET all vehicles
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vehicles")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) { fail(res, err); }
});

// POST create vehicle
router.post("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vehicles")
      .insert(buildPayload(req.body))
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { fail(res, err); }
});

// PUT update vehicle by id
router.put("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vehicles")
      .update(buildPayload(req.body))
      .eq("id", req.params.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Vehicle not found" });
    res.json(data);
  } catch (err) { fail(res, err); }
});

// PUT upsert by invoice_no (handy when the client only knows the invoice no.,
// e.g. migrating local entries that have a Date.now() local-only id).
router.put("/upsert/:invoice_no", async (req, res) => {
  try {
    const payload = { ...buildPayload(req.body), invoice_no: req.params.invoice_no };
    const { data, error } = await supabase
      .from("vehicles")
      .upsert(payload, { onConflict: "invoice_no" })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) { fail(res, err); }
});

// DELETE vehicle
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("vehicles").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ message: "Vehicle deleted" });
  } catch (err) { fail(res, err); }
});

module.exports = router;
