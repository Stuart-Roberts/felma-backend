// index.js — Felma backend (Render-safe + Supabase persistence)
// One-file server with item list, item detail and rank save

import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

/* -------------------- Config -------------------- */
const PORT = process.env.PORT || 10000;

// Allow UI on Render + local dev; keep this tight (no wildcards)
const ALLOW_ORIGINS = [
  "https://felma-ui.onrender.com",
  "http://localhost:5173",
];

// CORS middleware (prevents invalid header errors & 404 on preflight)
const app = express();
app.use(
  cors({
    origin(origin, cb) {
      // allow same-origin / server-to-server (no Origin header)
      if (!origin) return cb(null, true);
      if (ALLOW_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("CORS: origin not allowed"));
    },
  })
);
app.use(express.json());

// Supabase client (use the key you already configured for the backend)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.SUPABASE_URL_PUBLIC || process.env.SUPABASE_URL_PRIVATE;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Missing Supabase env. Set SUPABASE_URL and SUPABASE_KEY in Render.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/* -------------------- Helpers -------------------- */

// Normalize an item row for the UI (keeps legacy fields)
function shapeItem(row) {
  if (!row) return null;
  const {
    id,
    created_at,
    item_type,
    content,
    item_title,
    title, // in case your table stored title here previously
    customer_impact,
    team_energy,
    frequency,
    ease,
    rank,
    priority_rank, // legacy/alt
    action_tier,
    tier,
    leader_to_unblock,
    originator_name,
    org_slug,
    team_id,
  } = row;

  return {
    id,
    created_at,
    item_type: item_type || "frustration",
    title: item_title || title || content || "(untitled)",
    content: content || null,
    originator_name: originator_name || null,
    org_slug: org_slug || null,
    team_id: team_id || null,

    // ranking factors (1–10)
    impact: typeof customer_impact === "number" ? customer_impact : null,
    energy: typeof team_energy === "number" ? team_energy : null,
    frequency: typeof frequency === "number" ? frequency : null,
    ease: typeof ease === "number" ? ease : null,

    // computed / stored rank
    rank: typeof rank === "number" ? rank : (typeof priority_rank === "number" ? priority_rank : null),

    // badges
    tier: tier || action_tier || null,
    leader_to_unblock: !!leader_to_unblock,
  };
}

// Compute average (rounded) if factors are present
function computeRank({ impact, energy, frequency, ease }) {
  const nums = [impact, energy, frequency, ease].filter(
    (n) => typeof n === "number" && !Number.isNaN(n)
  );
  if (nums.length === 0) return null;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.round(avg);
}

/* -------------------- Routes -------------------- */

// Health
app.get("/", (_req, res) => res.status(200).send("Felma backend OK"));

// List (latest first, with safe shaping)
app.get("/api/list", async (_req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  const rows = (data || []).map(shapeItem);
  return res.json(rows);
});

// Item detail (fixes 404 on card click)
app.get("/api/items/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from("items").select("*").eq("id", id).single();

  if (error && error.code === "PGRST116") {
    // no rows
    return res.status(404).json({ error: "not_found" });
  }
  if (error) return res.status(500).json({ error: error.message });

  return res.json(shapeItem(data));
});

// Save ranking (Impact / Energy / Frequency / Ease)
app.post("/api/items/:id/rank", async (req, res) => {
  const { id } = req.params;
  let { impact, energy, frequency, ease } = req.body || {};

  // Coerce to numbers if strings
  function toNum(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  impact = toNum(impact);
  energy = toNum(energy);
  frequency = toNum(frequency);
  ease = toNum(ease);

  const newRank = computeRank({ impact, energy, frequency, ease });

  const update = {
    // columns you actually have in your table
    customer_impact: impact,
    team_energy: energy,
    frequency,
    ease,
    rank: newRank,
    priority_rank: newRank, // keep legacy in sync if present
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from("items").update(update).eq("id", id).select("*").single();

  if (error) {
    // Not found vs other error
    if (error.code === "PGRST116") return res.status(404).json({ error: "not_found" });
    return res.status(500).json({ error: error.message });
  }

  return res.json(shapeItem(data));
});

/* -------------------- Start -------------------- */
app.listen(PORT, () => {
  console.log(`Felma server running on http://0.0.0.0:${PORT}`);
});
