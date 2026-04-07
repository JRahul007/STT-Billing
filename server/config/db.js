const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000, // Fail fast if Supabase unreachable (5s instead of default 60s+)
});

let dbAvailable = false;

pool.on("error", (err) => {
  console.error("Database error:", err.message);
  dbAvailable = false;
});

function isDbAvailable() {
  return dbAvailable;
}

async function getPool() {
  return pool;
}

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        address VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS shipments (
        id SERIAL PRIMARY KEY,
        tracking_number VARCHAR(50) UNIQUE NOT NULL,
        customer_id INT REFERENCES customers(id),
        origin VARCHAR(255) NOT NULL,
        destination VARCHAR(255) NOT NULL,
        weight DECIMAL(10,2),
        status VARCHAR(50) DEFAULT 'Pending',
        estimated_delivery DATE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
        vehicle_number VARCHAR(50) UNIQUE NOT NULL,
        type VARCHAR(100),
        capacity DECIMAL(10,2),
        status VARCHAR(50) DEFAULT 'Available',
        driver_name VARCHAR(255),
        driver_phone VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS billings (
        id SERIAL PRIMARY KEY,
        invoice_no VARCHAR(50) UNIQUE NOT NULL,
        date DATE NOT NULL,
        location VARCHAR(255),
        weight DECIMAL(10,2),
        total_amount DECIMAL(12,2),
        bom_expense DECIMAL(12,2),
        bom_exp_description VARCHAR(500),
        other_expense DECIMAL(12,2),
        other_exp_description VARCHAR(500),
        payment_status VARCHAR(20) DEFAULT 'NOTPAID',
        invoice_data TEXT,
        extra_data TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add columns if missing (idempotent migration)
    await pool.query(`ALTER TABLE billings ADD COLUMN IF NOT EXISTS invoice_data TEXT`);
    await pool.query(`ALTER TABLE billings ADD COLUMN IF NOT EXISTS extra_data TEXT`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        reset_token VARCHAR(255),
        reset_token_expiry TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    dbAvailable = true;
    console.log("✅ Connected to Supabase PostgreSQL & tables initialized");
  } catch (err) {
    dbAvailable = false;
    console.error("⚠️  Database unavailable:", err.message || "connection failed (firewall/network issue)");
    console.error("⚠️  Server will run in OFFLINE mode — data will be stored in client localStorage only");
  }
}

module.exports = { pool, getPool, initializeDatabase, isDbAvailable };
