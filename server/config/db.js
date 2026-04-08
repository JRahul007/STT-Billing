const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env. " +
      "Get them from your Supabase dashboard → Settings → API."
  );
}

// Server-side client uses the service role key — bypasses RLS.
// Never expose this key to the browser.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Smoke-test the connection on boot. Talks over HTTPS (port 443),
// so it works through firewalls that block raw Postgres ports.
async function pingDatabase() {
  const { error } = await supabase.from("users").select("id", { count: "exact", head: true });
  if (error) throw error;
}

module.exports = { supabase, pingDatabase };
