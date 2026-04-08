-- One-time cleanup: drop tables created by the older schema that are
-- not used by any active route in this project.
-- Run in Supabase Dashboard → SQL Editor → New query.

DROP TABLE IF EXISTS shipments CASCADE;
DROP TABLE IF EXISTS vehicles  CASCADE;
DROP TABLE IF EXISTS customers CASCADE;
