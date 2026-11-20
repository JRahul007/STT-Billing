const express = require("express");
const router = express.Router();
const { supabase } = require("../config/db");

// Clients master for the Vehicle page (Manage Clients). Table: vehicle_clients
// (see sql/vehicle_clients.sql). Mounted behind authMiddleware in index.js.

const TABLE = "vehicle_clients";

function sanitizeClientInput(body = {}) {
  const text = (v) => (v == null ? "" : String(v)).trim();
  return {
    name: text(body.name),
    contact: text(body.contact),
    address: text(body.address),
    gstin: text(body.gstin).toUpperCase(),
    email: text(body.email),
  };
}

function validateClientInput(data) {
  if (!data.name) return "Client name is required";
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return "Email address is not valid";
  return null;
}

// Case-insensitive duplicate check (the unique index enforces it too).
async function findDuplicate(name, exceptId) {
  const { data, error } = await supabase.from(TABLE).select("id, name");
  if (error) throw error;
  const target = name.trim().toLowerCase();
  return (data || []).find((c) => (c.name || "").trim().toLowerCase() === target && String(c.id) !== String(exceptId)) || null;
}

function fail(res, err) {
  // 23505 = unique_violation (two requests raced past the duplicate check)
  if (err && err.code === "23505") {
    return res.status(409).json({ error: "A client with this name already exists." });
  }
  console.error("Vehicle clients route error:", err);
  res.status(500).json({ error: err.message || String(err), code: err.code, detail: err.details });
}

router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase.from(TABLE).select("*").order("name", { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    fail(res, err);
  }
});

router.post("/", async (req, res) => {
  try {
    const payload = sanitizeClientInput(req.body);
    const validationError = validateClientInput(payload);
    if (validationError) return res.status(400).json({ error: validationError });
    if (await findDuplicate(payload.name)) {
      return res.status(409).json({ error: "A client with this name already exists." });
    }

    const { data, error } = await supabase.from(TABLE).insert(payload).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    fail(res, err);
  }
});

router.put("/:id", async (req, res) => {
  try {
    const payload = sanitizeClientInput(req.body);
    const validationError = validateClientInput(payload);
    if (validationError) return res.status(400).json({ error: validationError });
    if (await findDuplicate(payload.name, req.params.id)) {
      return res.status(409).json({ error: "A client with this name already exists." });
    }

    const { data, error } = await supabase
      .from(TABLE)
      .update(payload)
      .eq("id", req.params.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Client not found" });
    res.json(data);
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase.from(TABLE).delete().eq("id", req.params.id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: "Client not found" });
    res.json({ message: "Client deleted" });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
