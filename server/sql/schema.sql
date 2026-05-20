-- invoice_maker — Supabase schema
-- Run this once in Supabase Dashboard → SQL Editor → New query.
-- Idempotent: safe to re-run.
--
-- Only two tables are actually used by the app:
--   users    — auth (server/routes/auth.js)
--   billings — invoices (server/routes/billings.js, /dashboard/billing-analytics)

-- =====================================================================
-- users
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
  id                 BIGSERIAL PRIMARY KEY,
  full_name          TEXT        NOT NULL,
  email              TEXT        NOT NULL UNIQUE,
  password           TEXT        NOT NULL,        -- bcrypt hash
  reset_token        TEXT,                        -- 6-digit code
  reset_token_expiry TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive email lookup helper (auth.js lowercases before querying,
-- so the existing UNIQUE index already covers it; no extra index needed).

-- =====================================================================
-- billings
-- =====================================================================
-- Column notes:
--   invoice_data — stringified JSON of the full invoice (set by
--                  InvoiceCreate.jsx, read back when re-opening). TEXT
--                  because the client stores it as a string.
--   extra_data   — structured extras (packaging/oda/pickup/other) written
--                  by billings.js extractExtraData(). JSONB so we can
--                  index/query later if needed.
CREATE TABLE IF NOT EXISTS billings (
  id                    BIGSERIAL PRIMARY KEY,
  invoice_no            TEXT        NOT NULL UNIQUE,
  date                  DATE        NOT NULL,
  location              TEXT,
  weight                NUMERIC(10,2),
  total_amount          NUMERIC(12,2),
  bom_expense           NUMERIC(12,2),
  bom_exp_description   TEXT,
  other_expense         NUMERIC(12,2),
  other_exp_description TEXT,
  payment_status        TEXT        NOT NULL DEFAULT 'NOTPAID',
  invoice_data          TEXT,
  extra_data            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- /dashboard/billing-analytics filters by year on `date`,
-- and the upsert path looks rows up by invoice_no.
CREATE INDEX IF NOT EXISTS idx_billings_date       ON billings(date);
CREATE INDEX IF NOT EXISTS idx_billings_created_at ON billings(created_at DESC);

-- =====================================================================
-- billing_parties (consigner/consignee master)
-- =====================================================================
CREATE TABLE IF NOT EXISTS billing_parties (
  id          BIGSERIAL PRIMARY KEY,
  party_type  TEXT        NOT NULL CHECK (party_type IN ('consigner', 'consignee')),
  name        TEXT        NOT NULL,
  address     TEXT,
  mobile      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate names within same type (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_parties_type_name_unique
  ON billing_parties (party_type, UPPER(name));

CREATE INDEX IF NOT EXISTS idx_billing_parties_type ON billing_parties(party_type);

-- =====================================================================
-- vehicles
-- =====================================================================
-- Stores vehicle trip records. Each row = one trip entry shown
-- in the Vehicle page table. The invoice PDF is generated client-side
-- from these fields (no invoice_data blob needed).
CREATE TABLE IF NOT EXISTS vehicles (
  id              BIGSERIAL PRIMARY KEY,
  invoice_no      TEXT        NOT NULL UNIQUE,
  date            DATE        NOT NULL,               -- bill date (beside invoice no.)
  trip_date       DATE,                               -- legacy single trip date (kept for backward compat)
  client_name     TEXT,
  description     TEXT,                               -- legacy single description (kept for backward compat)
  rate            NUMERIC(12,2),
  trip            TEXT,                                -- text: can be "2", "1A", "Round Trip" etc.
  start_km        NUMERIC(12,2),                       -- legacy single start km (kept for backward compat)
  end_km          NUMERIC(12,2),                       -- legacy single end km (kept for backward compat)
  total_km        NUMERIC(12,2),                       -- aggregate KM across all description entries
  amount          NUMERIC(12,2),
  expenses        NUMERIC(12,2),
  remark          TEXT,                                -- legacy single remark (kept for backward compat)
  description_entries JSONB    NOT NULL DEFAULT '[]'::jsonb,  -- [{ trip_date, description, total_km, start_km, end_km, remark }]
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- For existing databases: idempotent column adds (Postgres ignores when present).
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS total_km            NUMERIC(12,2);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS description_entries JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_vehicles_date       ON vehicles(date);
CREATE INDEX IF NOT EXISTS idx_vehicles_client     ON vehicles(client_name);
CREATE INDEX IF NOT EXISTS idx_vehicles_created_at ON vehicles(created_at DESC);

-- =====================================================================
-- employees (master)
-- =====================================================================
-- One row per employee. Drives the dropdown on the Salary form
-- (Salary.jsx → Manage Employees modal). Salary records snapshot these
-- values at the time of generation so older slips don't change when the
-- master record is later edited.
CREATE TABLE IF NOT EXISTS employees (
  id            BIGSERIAL PRIMARY KEY,
  employee_no   TEXT        NOT NULL UNIQUE,
  name          TEXT        NOT NULL,
  designation   TEXT,
  department    TEXT,
  location      TEXT,
  pan_number    TEXT,
  joining_date  DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_created_at ON employees(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);

-- =====================================================================
-- salary_records (per-month payslip)
-- =====================================================================
-- Each row = one month's payslip for one employee. Employee details
-- (name/designation/department/location/pan/joining_date) are denormalised
-- copies so reprinting an old slip shows what was true at the time, even
-- if the employees row was later updated or deleted.
--
-- pay_month/pay_year drive the "Month (Year)" column on the Salary table
-- and the title of the PDF.
CREATE TABLE IF NOT EXISTS salary_records (
  id                 BIGSERIAL PRIMARY KEY,
  employee_no        TEXT        NOT NULL,
  name               TEXT        NOT NULL,
  designation        TEXT,
  department         TEXT,
  location           TEXT,
  pan_number         TEXT,
  joining_date       DATE,
  pay_month          SMALLINT    NOT NULL CHECK (pay_month BETWEEN 1 AND 12),
  pay_year           SMALLINT    NOT NULL CHECK (pay_year BETWEEN 2000 AND 2100),
  basic_salary       NUMERIC(12,2) NOT NULL DEFAULT 0,
  hra                NUMERIC(12,2) NOT NULL DEFAULT 0,
  conveyance         NUMERIC(12,2) NOT NULL DEFAULT 0,
  medical            NUMERIC(12,2) NOT NULL DEFAULT 0,
  special_allowance  NUMERIC(12,2) NOT NULL DEFAULT 0,
  professional_tax   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_earnings     NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay            NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One payslip per employee per pay period — prevents duplicate Apr-2026 slips
-- for the same Employee No.
CREATE UNIQUE INDEX IF NOT EXISTS idx_salary_records_emp_period_unique
  ON salary_records (employee_no, pay_year, pay_month);

CREATE INDEX IF NOT EXISTS idx_salary_records_period     ON salary_records(pay_year DESC, pay_month DESC);
CREATE INDEX IF NOT EXISTS idx_salary_records_employee   ON salary_records(employee_no);
CREATE INDEX IF NOT EXISTS idx_salary_records_created_at ON salary_records(created_at DESC);
