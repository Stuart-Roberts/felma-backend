// index.js — Felma backend (Render + Supabase)
// Safe CORS + simple items routes

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

// ---- Config ----
const PORT = process.env.PORT || 10000;

// Strict allowlist: add localhost + your UI
const ALLOWED = new Set([
  "https://felma-ui.onrender.com",
  "http://localhost:5173",
  "http://localhost:5174",
]);

const app = express();

app.use(
  cors({
    origin(origin, cb) {
      // allow same-origin / curl / server-to-server
      if (!origin) return cb(null, true);
      cb(null, ALLOWED.has(origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// IMPORTANT: do NOT manually set Access-Control-Allow-Origin anywhere.
// (That’s what caused the ERR_INVALID_CHAR previously.)

app.use(express.json());

// ---- Supabase ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service or anon ok for these reads/writes

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---- Health ----
app.get("/", (_req, res) => res.status(200).send("Felma backend OK"));

// ---- List items ----
app.get("/api/list", async (_req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data || []);
});

// ---- Get single item ----
app.get("/api/items/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from("items").select("*").eq("id", id).single();

  if (error) return res.status(404).json({ error: "not_found" });
  return res.json(data);
});

// ---- Save ranking (1–10 sliders) ----
// body: { impact, energy, ease, frequency } (numbers)
// quick rank = average of the non-null sliders (rounded)
app.post("/api/items/:id/rank", async (req, res) => {
  const { id } = req.params;
  let { impact, energy, ease, frequency } = req.body || {};

  // Coerce to numbers or null
  const nums = [impact, energy, ease, frequency].map((v) =>
    v === undefined || v === null || v === "" ? null : Number(v)
  );
  [impact, energy, ease, frequency] = nums;

  const present = nums.filter((v) => typeof v === "number" && !Number.isNaN(v));
  const rank =
    present.length > 0
      ? Math.round(present.reduce((a, b) => a + b, 0) / present.length)
      : null;

  const { data, error } = await supabase
    .from("items")
    .update({ impact, energy, ease, frequency, rank })
    .eq("id", id)
    .select("*")
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`Felma server running on http://0.0.0.0:${PORT}`);
});
