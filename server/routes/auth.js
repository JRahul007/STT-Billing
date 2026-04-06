const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { JWT_SECRET } = require("../middleware/auth");

// JSON file-based user storage (works without MSSQL)
const USERS_FILE = path.join(__dirname, "..", "data", "users.json");

function ensureDataDir() {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");
}

function readUsers() {
  ensureDataDir();
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
}

function writeUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

let nextId = null;
function getNextId() {
  if (nextId === null) {
    const users = readUsers();
    nextId = users.length > 0 ? Math.max(...users.map((u) => u.id)) + 1 : 1;
  }
  return nextId++;
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

    const users = readUsers();
    const existing = users.find((u) => u.email === email.toLowerCase());
    if (existing) {
      return res.status(400).json({ error: "Email is already registered." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = {
      id: getNextId(),
      full_name,
      email: email.toLowerCase(),
      password: hashedPassword,
      reset_token: null,
      reset_token_expiry: null,
      created_at: new Date().toISOString(),
    };

    users.push(user);
    writeUsers(users);

    const token = jwt.sign({ id: user.id, email: user.email, full_name: user.full_name }, JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({
      user: { id: user.id, full_name: user.full_name, email: user.email, created_at: user.created_at },
      token,
    });
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

    const users = readUsers();
    const user = users.find((u) => u.email === email.toLowerCase());

    if (!user) {
      return res.status(400).json({ error: "Invalid email or password." });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: "Invalid email or password." });
    }

    const token = jwt.sign({ id: user.id, email: user.email, full_name: user.full_name }, JWT_SECRET, { expiresIn: "7d" });

    res.json({
      user: { id: user.id, full_name: user.full_name, email: user.email, created_at: user.created_at },
      token,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    const users = readUsers();
    const user = users.find((u) => u.email === email.toLowerCase());

    if (!user) {
      return res.status(400).json({ error: "No account found with this email." });
    }

    const resetToken = crypto.randomInt(100000, 999999).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 minutes

    user.reset_token = resetToken;
    user.reset_token_expiry = expiry;
    writeUsers(users);

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

    const users = readUsers();
    const user = users.find((u) => u.email === email.toLowerCase() && u.reset_token === reset_code);

    if (!user) {
      return res.status(400).json({ error: "Invalid reset code." });
    }

    if (new Date() > new Date(user.reset_token_expiry)) {
      return res.status(400).json({ error: "Reset code has expired. Please request a new one." });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(new_password, salt);
    user.reset_token = null;
    user.reset_token_expiry = null;
    writeUsers(users);

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
