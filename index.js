import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// CORS
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN.split(",").map(s => s.trim()),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

// Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false }
});

// Health
app.get("/", (_req, res) => res.send("✅ Felma backend running"));
app.get("/health", (_req, res) => res.json({ ok: true }));

// GET one item (UI opens detail)
app.get("/items/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return res.status(404).json({ error: "Not found", detail: error.message });
  res.json(data);
});

// POST rank update (UI: Save ranking)
app.post("/items/:id/rank", async (req, res) => {
  const { id } = req.params;
  const { impact, energy, ease, frequency } = req.body ?? {};

  // Compute a simple quick score (average of provided numbers 1..10)
  const nums = [impact, energy, ease, frequency].filter(n => typeof n === "number");
  const rank = nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;

  const { data, error } = await supabase
    .from("items")
    .update({
      impact,
      energy,
      ease,
      frequency,
      rank
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true, item: data });
});

// Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Felma backend listening on ${PORT}`);
});
