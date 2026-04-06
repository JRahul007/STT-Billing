const express = require("express");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const dashboardRoutes = require("./routes/dashboard");
const billingRoutes = require("./routes/billings");
const { authMiddleware } = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Public routes (no auth required)
app.use("/api/auth", authRoutes);

// Protected routes (auth required)
app.use("/api/dashboard", authMiddleware, dashboardRoutes);
app.use("/api/billings", authMiddleware, billingRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date() });
});

// Start server
async function start() {
  // Try to initialize DB, but don't block startup if MSSQL is unavailable
  try {
    const { initializeDatabase } = require("./config/db");
    await initializeDatabase();
  } catch (err) {
    console.log("MSSQL not available - running with file-based auth and localStorage fallback");
  }
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start();
