// index.js — Felma backend (Render)

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;

// ---- CORS (keep simple; you already set CORS_ORIGIN in Render) ----
const origins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.use(
  cors({
    origin: origins.length === 1 && origins[0] === "*" ? "*" : origins,
  })
);
app.use(express.json());

// ---- Health ----
app.get(["/health", "/api/health"], (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ---- Supabase client ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service role key recommended

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY environment variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// Table name (change here if your table isn’t called 'items')
const TABLE = process.env.TABLE_NAME || "items";

// ---- Routes used by the UI ----

// List items (the failing call you captured)
app.get("/api/list", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .order("rank", { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ items: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Optional: get a single item (UI may use this)
app.get("/api/item/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error) return res.status(error.code === "PGRST116" ? 404 : 500).json({ error: error.message });
    return res.json({ item: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Optional: create new item (used by “+ New”)
app.post("/api/item", async (req, res) => {
  try {
    const payload = req.body || {};
    const { data, error } = await supabase.from(TABLE).insert(payload).select().single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(201).json({ item: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Optional: update rank (if UI sends {rank})
app.post("/api/item/:id/rank", async (req, res) => {
  try {
    const { rank } = req.body || {};
    if (typeof rank === "undefined") return res.status(400).json({ error: "rank is required" });

    const { data, error } = await supabase
      .from(TABLE)
      .update({ rank })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    return res.json({ item: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Fallback 404 (after all routes)
app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`Felma backend listening on ${PORT}`);
});
