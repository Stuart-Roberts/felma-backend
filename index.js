// index.js — clean ESM Express server for Felma
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// CORS (Render env CORS_ORIGIN should be a single origin, no quotes/brackets)
const corsOrigin = process.env.CORS_ORIGIN || "*";
app.use(
  cors({
    origin: corsOrigin === "*" ? true : corsOrigin,
    credentials: true,
  })
);

// Supabase (service key needed server-side)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_KEY");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Routes expected by the UI ---

// Health
app.get("/health", (_req, res) => res.json({ ok: true }));

// List items
app.get("/items", async (_req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? []);
});

// Item detail (UI navigates here)
app.get("/item/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

// Save ranking (UI POSTs here)
app.post("/items/:id/rank", async (req, res) => {
  const { id } = req.params;
  const { impact, energy, ease, frequency } = req.body ?? {};

  // default to 0–10 bounds
  const i = Number(impact ?? 0),
    e = Number(energy ?? 0),
    ea = Number(ease ?? 0),
    f = Number(frequency ?? 0);

  const quick_rank = Math.round((i + e + ea + f) / 4);

  const { data, error } = await supabase
    .from("items")
    .update({ impact: i, energy: e, ease: ea, frequency: f, quick_rank })
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Felma backend listening on ${PORT}`);
});
