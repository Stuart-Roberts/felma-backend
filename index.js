// index.js — Felma backend (Render-safe + Supabase persistence)

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

// CORS (single allowed origin – your UI)
const ORIGIN = process.env.CORS_ORIGIN || "https://felma-ui.onrender.com";
app.use(cors({ origin: ORIGIN }));
app.use(express.json());

// Supabase (service key required on server)
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "";
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
function toInt1to10(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(1, Math.round(n)));
}
function computePriorityRank({ impact, energy, frequency, ease }) {
  // Simple 1–100-ish score. (Higher = more urgent)
  // Treat “ease” as inverse (harder → higher score).
  if ([impact, energy, frequency, ease].some(v => v == null)) return null;
  const difficulty = 11 - ease; // 1..10
  const raw = impact + energy + frequency + difficulty; // 4..40
  return Math.round(raw * 2.5); // ~10..100
}
// ─────────────────────────────────────────────────────────────────────────────

// Root
app.get("/", (_req, res) => res.status(200).send("Felma backend OK"));

// List items (latest first)
app.get("/api/list", async (_req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// Get single item (detail page)
app.get("/api/items/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return res.status(404).json({ error: "not_found" });
  return res.json(data);
});

// Create new quick note
app.post("/api/items", async (req, res) => {
  const body = req.body || {};
  const content = (body.content || "").toString().trim();
  const item_type = (body.item_type || "frustration").toString().trim();
  const org_slug = (body.org_slug || "demo").toString().trim();
  const leader_to_unblock = !!body.leader_to_unblock;

  if (!content) return res.status(400).json({ error: "content_required" });
  if (!["frustration", "idea"].includes(item_type))
    return res.status(400).json({ error: "bad_item_type" });

  const insertRow = {
    content,
    item_type,
    org_slug,
    leader_to_unblock,
  };

  const { data, error } = await supabase
    .from("items")
    .insert(insertRow)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// ★ Update ranking for an item (sliders “Save ranking”)
//    UI calls: POST /api/items/:id/rank  with JSON:
//    { impact, energy, frequency, ease, leader_to_unblock? }
app.post("/api/items/:id/rank", async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};

  const impact = toInt1to10(b.impact);
  const energy = toInt1to10(b.energy);
  const frequency = toInt1to10(b.frequency);
  const ease = toInt1to10(b.ease);
  const leader_to_unblock =
    typeof b.leader_to_unblock === "boolean" ? b.leader_to_unblock : undefined;

  const priority_rank = computePriorityRank({ impact, energy, frequency, ease });

  const update = {};
  if (impact != null) update.impact = impact;
  if (energy != null) update.energy = energy;
  if (frequency != null) update.frequency = frequency;
  if (ease != null) update.ease = ease;
  if (priority_rank != null) update.priority_rank = priority_rank;
  if (leader_to_unblock !== undefined) update.leader_to_unblock = leader_to_unblock;

  if (Object.keys(update).length === 0)
    return res.status(400).json({ error: "no_fields_to_update" });

  const { data, error } = await supabase
    .from("items")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.json(data);
});

// Start server (Render sets PORT)
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Felma server running on http://0.0.0.0:${PORT}`);
});
