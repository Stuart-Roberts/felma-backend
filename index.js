// index.js — Felma backend (CommonJS, Render-ready)

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

// ---- Env checks (fail fast with clear messages)
const { SUPABASE_URL, SUPABASE_KEY, ADMIN_KEY } = process.env;
if (!SUPABASE_URL) throw new Error("SUPABASE_URL is required.");
if (!SUPABASE_KEY) throw new Error("SUPABASE_KEY (service role) is required.");

const PORT = process.env.PORT || 10000;

// ---- App
const app = express();

// CORS: trust the origin that made the request (works with Render + local dev)
// NOTE: Do NOT also manually set Access-Control-* headers elsewhere.
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ---- Supabase client (no session persistence on server)
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---- Helpers
function isNum1to10(n) {
  return Number.isFinite(n) && n >= 1 && n <= 10;
}

function safeNumber(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

// ---- Routes

// Health
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "felma-backend",
    time: new Date().toISOString(),
  });
});

// List items (optionally by org)
// GET /items
// GET /items?org=G%20Project
app.get("/items", async (req, res) => {
  try {
    const org = req.query.org || null;

    let query = supabase
      .from("items")
      .select("*")
      .order("created_at", { ascending: false });

    if (org) query = query.eq("org", org);

    const { data, error } = await query;

    if (error) {
      console.error("Supabase list error:", error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.json({ ok: true, items: data || [] });
  } catch (e) {
    console.error("List items exception:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Get single item
// GET /items/:id
app.get("/items/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const { data, error } = await supabase
      .from("items")
      .select("*")
      .eq("id", id)
      .single();

    if (error && error.code === "PGRST116") {
      // row not found
      return res.status(404).json({ ok: false, error: "Not found" });
    }
    if (error) {
      console.error("Supabase get error:", error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.json({ ok: true, item: data });
  } catch (e) {
    console.error("Get item exception:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Save ranking for an item
// POST /items/:id/rank
// Body: { impact, energy, ease, frequency }
// (All optional but if provided must be 1..10)
app.post("/items/:id/rank", async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};

    const impact = safeNumber(body.impact);
    const energy = safeNumber(body.energy);
    const ease = safeNumber(body.ease);
    const frequency = safeNumber(body.frequency);

    const update = {};
    if (impact !== null) {
      if (!isNum1to10(impact)) return res.status(400).json({ ok: false, error: "impact must be 1..10" });
      update.impact = impact;
    }
    if (energy !== null) {
      if (!isNum1to10(energy)) return res.status(400).json({ ok: false, error: "energy must be 1..10" });
      update.energy = energy;
    }
    if (ease !== null) {
      if (!isNum1to10(ease)) return res.status(400).json({ ok: false, error: "ease must be 1..10" });
      update.ease = ease;
    }
    if (frequency !== null) {
      if (!isNum1to10(frequency)) return res.status(400).json({ ok: false, error: "frequency must be 1..10" });
      update.frequency = frequency;
    }

    // If any of the four were provided, compute quick_rank = average of provided ones
    const provided = [impact, energy, ease, frequency].filter((v) => v !== null);
    if (provided.length > 0) {
      const avg = provided.reduce((a, b) => a + b, 0) / provided.length;
      update.quick_rank = Math.round(avg); // integer badge shown in UI
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ ok: false, error: "No ranking fields provided" });
    }

    const { data, error } = await supabase
      .from("items")
      .update(update)
      .eq("id", id)
      .select()
      .single();

    if (error && error.code === "PGRST116") {
      return res.status(404).json({ ok: false, error: "Not found" });
    }
    if (error) {
      console.error("Supabase rank update error:", error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    return res.json({ ok: true, item: data });
  } catch (e) {
    console.error("Rank exception:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// ---- Start
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Felma backend listening on ${PORT}`);
});
