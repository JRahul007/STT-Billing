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
  trip_date       DATE,                               -- actual trip date (in description)
  client_name     TEXT,
  description     TEXT,
  rate            NUMERIC(12,2),
  trip            TEXT,                                -- text: can be "2", "1A", "Round Trip" etc.
  start_km        NUMERIC(12,2),
  end_km          NUMERIC(12,2),
  amount          NUMERIC(12,2),
  expenses        NUMERIC(12,2),
  remark          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_date       ON vehicles(date);
CREATE INDEX IF NOT EXISTS idx_vehicles_client     ON vehicles(client_name);
CREATE INDEX IF NOT EXISTS idx_vehicles_created_at ON vehicles(created_at DESC);
