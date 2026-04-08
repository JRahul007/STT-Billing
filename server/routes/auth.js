const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { supabase } = require("../config/db");
const { JWT_SECRET } = require("../middleware/auth");

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, full_name: user.full_name },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email,
    created_at: user.created_at,
  };
}

// POST /api/auth/register
router.post("/register", async (req, res) => {
  try {
    const { full_name, email, password } = req.body;
    if (!full_name || !email || !password) {
      return res.status(400).json({ error: "Full name, email and password are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const normalized = email.toLowerCase();

    const { data: existing, error: existErr } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalized)
      .maybeSingle();
    if (existErr) throw existErr;
    if (existing) return res.status(400).json({ error: "Email is already registered." });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const { data: user, error: insErr } = await supabase
      .from("users")
      .insert({ full_name, email: normalized, password: hashedPassword })
      .select()
      .single();
    if (insErr) throw insErr;

    res.status(201).json({ user: publicUser(user), token: signToken(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email.toLowerCase())
      .maybeSingle();
    if (error) throw error;
    if (!user) return res.status(400).json({ error: "Invalid email or password." });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: "Invalid email or password." });

    res.json({ user: publicUser(user), token: signToken(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });

    const normalized = email.toLowerCase();
    const { data: user, error } = await supabase
      .from("users")
      .select("id")
      .eq("email", normalized)
      .maybeSingle();
    if (error) throw error;
    if (!user) return res.status(400).json({ error: "No account found with this email." });

    const resetToken = crypto.randomInt(100000, 999999).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { error: updErr } = await supabase
      .from("users")
      .update({ reset_token: resetToken, reset_token_expiry: expiry })
      .eq("id", user.id);
    if (updErr) throw updErr;

    res.json({
      message: "Password reset code generated. Use the code to reset your password.",
      reset_code: resetToken,
      note: "In production, this code would be sent to your email.",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/reset-password
router.post("/reset-password", async (req, res) => {
  try {
    const { email, reset_code, new_password } = req.body;
    if (!email || !reset_code || !new_password) {
      return res.status(400).json({ error: "Email, reset code and new password are required." });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters." });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email.toLowerCase())
      .eq("reset_token", reset_code)
      .maybeSingle();
    if (error) throw error;
    if (!user) return res.status(400).json({ error: "Invalid reset code." });

    if (new Date() > new Date(user.reset_token_expiry)) {
      return res.status(400).json({ error: "Reset code has expired. Please request a new one." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(new_password, salt);

    const { error: updErr } = await supabase
      .from("users")
      .update({ password: hashedPassword, reset_token: null, reset_token_expiry: null })
      .eq("id", user.id);
    if (updErr) throw updErr;

    res.json({ message: "Password reset successfully. You can now login with your new password." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get("/me", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token" });
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ user: { id: decoded.id, email: decoded.email, full_name: decoded.full_name } });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

module.exports = router;
