// index.js (CommonJS)
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;

// --- CORS: allow everything for the pilot (safe on a dev backend) ---
const app = express();
app.use(cors()); // no manual headers; no origin list = allow all
app.use(express.json());

// --- Supabase client (write-capable) ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.ADMIN_KEY || process.env.SUPABASE_KEY; // either is fine

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY/SUPABASE_KEY env vars");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// --- Shared router; we will mount it at `/` and at `/api` ---
const r = express.Router();

// health
r.get("/health", (_req, res) => {
  res.json({ ok: true, service: "felma-backend", time: new Date().toISOString() });
});

// list items
r.get("/items", async (_req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data); // array is simplest for the UI
});

// single item
r.get("/item/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from("items").select("*").eq("id", id).single();
  if (error) return res.status(404).json({ error: error.message });
  return res.json(data);
});

// save ranking
r.post("/items/:id/rank", async (req, res) => {
  const { id } = req.params;
  const { impact, energy, ease, frequency } = req.body || {};

  const payload = {};
  if (impact !== undefined) payload.impact = impact;
  if (energy !== undefined) payload.energy = energy;
  if (ease !== undefined) payload.ease = ease;
  if (frequency !== undefined) payload.frequency = frequency;

  const { data, error } = await supabase
    .from("items")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// 404 (kept last)
r.all("*", (_req, res) => res.status(404).json({ error: "Not found" }));

// expose routes at BOTH bases so the UI works either way
app.use("/", r);
app.use("/api", r);

app.listen(PORT, () => {
  console.log(`Felma backend listening on ${PORT}`);
});
