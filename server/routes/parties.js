const express = require("express");
const router = express.Router();
const { supabase } = require("../config/db");

function sanitizePartyInput(body = {}) {
  return {
    party_type: (body.party_type || "").trim().toLowerCase(),
    name: (body.name || "").trim().toUpperCase(),
    address: (body.address || "").trim(),
    mobile: (body.mobile || "").trim(),
  };
}

function validatePartyInput(data) {
  if (!["consigner", "consignee"].includes(data.party_type)) {
    return "party_type must be 'consigner' or 'consignee'";
  }
  if (!data.name) {
    return "name is required";
  }
  return null;
}

function fail(res, err) {
  console.error("Parties route error:", err);
  res.status(500).json({ error: err.message || String(err), code: err.code, detail: err.details });
}

router.get("/", async (req, res) => {
  try {
    const requestedType = (req.query.party_type || "").trim().toLowerCase();
    let query = supabase.from("billing_parties").select("*").order("name", { ascending: true });
    if (requestedType) {
      query = query.eq("party_type", requestedType);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    fail(res, err);
  }
});

router.post("/", async (req, res) => {
  try {
    const payload = sanitizePartyInput(req.body);
    const validationError = validatePartyInput(payload);
    if (validationError) return res.status(400).json({ error: validationError });

    const { data, error } = await supabase
      .from("billing_parties")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    fail(res, err);
  }
});

router.put("/:id", async (req, res) => {
  try {
    const payload = sanitizePartyInput(req.body);
    const validationError = validatePartyInput(payload);
    if (validationError) return res.status(400).json({ error: validationError });

    const { data, error } = await supabase
      .from("billing_parties")
      .update(payload)
      .eq("id", req.params.id)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Party not found" });
    res.json(data);
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("billing_parties").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ message: "Party deleted" });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
