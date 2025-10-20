const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

// CORS: single exact origin string
const ORIGIN = process.env.CORS_ORIGIN || "*";
app.use(cors({ origin: ORIGIN }));

app.use(express.json());

// Supabase client (service role key for server)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_KEY env vars are required.");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Health
app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// List items
app.get("/items", async (req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Item detail
app.get("/items/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from("items").select("*").eq("id", id).single();
  if (error) return res.status(404).json({ error: "Not found" });
  res.json(data);
});

// Save ranking
app.post("/items/:id/rank", async (req, res) => {
  const { id } = req.params;
  const { impact, energy, ease, frequency } = req.body || {};
  const fields = { impact, energy, ease, frequency };

  const { data, error } = await supabase
    .from("items")
    .update(fields)
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Felma backend listening on ${PORT}`);
});
