-- =====================================================================
-- vehicle_clients — master list for Vehicle → Manage Clients
-- =====================================================================
-- Run once in Supabase Dashboard → SQL Editor. Safe to re-run.
--
-- Access model: the browser never talks to Supabase directly. All reads and
-- writes go through the Express API (/api/vehicle-clients), which checks the
-- app's login token and uses the service role key (server-side only).
-- RLS is therefore enabled with NO policies for the public `anon` and
-- `authenticated` roles: anyone holding the public anon key gets nothing,
-- while the service role (which bypasses RLS) keeps full access.

CREATE TABLE IF NOT EXISTS vehicle_clients (
  id          BIGSERIAL   PRIMARY KEY,
  name        TEXT        NOT NULL CHECK (btrim(name) <> ''),
  contact     TEXT        NOT NULL DEFAULT '',
  address     TEXT        NOT NULL DEFAULT '',
  gstin       TEXT        NOT NULL DEFAULT '',
  email       TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One client per name, ignoring case and surrounding spaces.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_clients_name_unique
  ON vehicle_clients (LOWER(btrim(name)));

-- Keep updated_at current on every edit.
CREATE OR REPLACE FUNCTION vehicle_clients_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vehicle_clients_updated_at ON vehicle_clients;
CREATE TRIGGER trg_vehicle_clients_updated_at
  BEFORE UPDATE ON vehicle_clients
  FOR EACH ROW EXECUTE FUNCTION vehicle_clients_touch_updated_at();

-- Row Level Security: deny-all for public roles (no policies are created on
-- purpose); only the server's service role can access this table.
ALTER TABLE vehicle_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE vehicle_clients FROM anon, authenticated;
REVOKE ALL ON SEQUENCE vehicle_clients_id_seq FROM anon, authenticated;
