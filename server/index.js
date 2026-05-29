const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const dashboardRoutes = require("./routes/dashboard");
const billingRoutes = require("./routes/billings");
const partyRoutes = require("./routes/parties");
const vehicleRoutes = require("./routes/vehicles");
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
app.use("/api/parties", authMiddleware, partyRoutes);
app.use("/api/vehicles", authMiddleware, vehicleRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date() });
});

// Serve client build in production
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

// Start server
async function start() {
  try {
    const { pingDatabase } = require("./config/db");
    await pingDatabase();
    console.log("✅ Connected to Supabase");
  } catch (err) {
    console.error("❌ Supabase connection failed:", err.message);
    console.error("   Check SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env,");
    console.error("   and make sure you've run server/sql/schema.sql in the Supabase SQL editor.");
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

start();
