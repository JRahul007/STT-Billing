const sql = require("mssql");
require("dotenv").config();

const config = {
  server: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
    console.log("Connected to SQL Server");
  }
  return pool;
}

async function initializeDatabase() {
  try {
    const pool = await getPool();

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'customers')
      CREATE TABLE customers (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(255) NOT NULL,
        email NVARCHAR(255),
        phone NVARCHAR(50),
        address NVARCHAR(500),
        created_at DATETIME DEFAULT GETDATE()
      )
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'shipments')
      CREATE TABLE shipments (
        id INT IDENTITY(1,1) PRIMARY KEY,
        tracking_number NVARCHAR(50) UNIQUE NOT NULL,
        customer_id INT FOREIGN KEY REFERENCES customers(id),
        origin NVARCHAR(255) NOT NULL,
        destination NVARCHAR(255) NOT NULL,
        weight DECIMAL(10,2),
        status NVARCHAR(50) DEFAULT 'Pending',
        estimated_delivery DATE,
        created_at DATETIME DEFAULT GETDATE(),
        updated_at DATETIME DEFAULT GETDATE()
      )
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'vehicles')
      CREATE TABLE vehicles (
        id INT IDENTITY(1,1) PRIMARY KEY,
        vehicle_number NVARCHAR(50) UNIQUE NOT NULL,
        type NVARCHAR(100),
        capacity DECIMAL(10,2),
        status NVARCHAR(50) DEFAULT 'Available',
        driver_name NVARCHAR(255),
        driver_phone NVARCHAR(50),
        created_at DATETIME DEFAULT GETDATE()
      )
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'billings')
      CREATE TABLE billings (
        id INT IDENTITY(1,1) PRIMARY KEY,
        invoice_no NVARCHAR(50) UNIQUE NOT NULL,
        date DATE NOT NULL,
        location NVARCHAR(255),
        weight DECIMAL(10,2),
        total_amount DECIMAL(12,2),
        bom_expense DECIMAL(12,2),
        bom_exp_description NVARCHAR(500),
        other_expense DECIMAL(12,2),
        other_exp_description NVARCHAR(500),
        payment_status NVARCHAR(20) DEFAULT 'NOTPAID',
        created_at DATETIME DEFAULT GETDATE()
      )
    `);

    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'users')
      CREATE TABLE users (
        id INT IDENTITY(1,1) PRIMARY KEY,
        full_name NVARCHAR(255) NOT NULL,
        email NVARCHAR(255) UNIQUE NOT NULL,
        password NVARCHAR(255) NOT NULL,
        reset_token NVARCHAR(255),
        reset_token_expiry DATETIME,
        created_at DATETIME DEFAULT GETDATE()
      )
    `);

    console.log("Database tables initialized");
  } catch (err) {
    console.error("Database initialization error:", err.message);
  }
}

module.exports = { sql, getPool, initializeDatabase };
