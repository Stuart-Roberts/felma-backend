// index.js — Felma backend (Render + Supabase)

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

// --- CORS (allow your UI) ---
const ORIGIN = process.env.CORS_ORIGIN || "https://felma-ui.onrender.com";
app.use(cors({ origin: ORIGIN }));
app.use(express.json({ limit: "1mb" }));

// --- Supabase (service key required) ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service_role on Render

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("SUPABASE_URL or SUPABASE_KEY not set; API will fail.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

// --- Health ---
app.get("/", (_req, res) => res.send("Felma backend OK"));

// --- List items ( newest first ) ---
app.get("/api/list", async (_req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// --- Get one item by id ---
app.get("/api/items/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return res.status(404).json({ error: "Not found" });
  res.json(data);
});

// --- Save ranking sliders for an item ---
app.post("/api/items/:id/rank", async (req, res) => {
  const { id } = req.params;
  let { impact, energy, frequency, ease } = req.body || {};

  // coerce to 1–10 integers
  const clamp = (n) => Math.max(1, Math.min(10, parseInt(n || 0, 10)));
  impact = clamp(impact);
  energy = clamp(energy);
  frequency = clamp(frequency);
  ease = clamp(ease);

  // simple average for now (you can change the formula later)
  const avg = Math.round((impact + energy + frequency + ease) / 4);

  const { data, error } = await supabase
    .from("items")
    .update({
      impact,
      energy,
      frequency,
      ease,
      rank: avg,           // legacy name you already had
      priority_rank: avg   // newer name some rows use
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// --- Start server ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Felma server running on http://0.0.0.0:${PORT}`);
});
