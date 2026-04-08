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
