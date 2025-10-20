// index.js (CommonJS, works on Render)
// Minimal Express API with CORS + Supabase and a GET /api/list route.

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// ----- App & middleware -----
const app = express();

// Wide-open CORS for now (you already gate by Render env var).
app.use(cors({ origin: (_origin, cb) => cb(null, true), credentials: false }));
app.use(express.json());

// ----- Health -----
app.get(["/health", "/api/health"], (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    time: new Date().toISOString(),
  });
});

// ----- Supabase -----
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

// Helper: try table "items", then fallback "felma_items".
async function fetchItemsFromSupabase() {
  if (!supabase) return [];
  // 1) try "items"
  let { data, error } = await supabase.from("items").select("*");
  if (!error && Array.isArray(data)) return data;

  // 2) fallback "felma_items"
  const r2 = await supabase.from("felma_items").select("*");
  if (!r2.error && Array.isArray(r2.data)) return r2.data;

  // 3) last resort: empty list (prevents UI 404s)
  return [];
}

// ----- List routes (UI calls /api/list) -----
app.get(["/api/list", "/api/items", "/items"], async (req, res) => {
  try {
    const rows = await fetchItemsFromSupabase();
    // UI expects an array; return [] if none.
    res.status(200).json(rows ?? []);
  } catch (e) {
    // Do NOT 404 — return empty list to keep UI running.
    res.status(200).json([]);
  }
});

// Root
app.get("/", (_req, res) => res.type("text").send("Felma backend OK"));

// Start server
app.listen(PORT, () => {
  console.log(`Felma backend listening on ${PORT}`);
});
