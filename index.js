// index.js — Felma backend (MVP)
// Node 18+ on Render. Uses CommonJS (require).

const express = require("express");
const compression = require("compression");
const { createClient } = require("@supabase/supabase-js");

// --- env ---
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- app/bootstrap ---
const app = express();
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// permissive CORS for MVP
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ---------- helpers (rank, tier, leader-to-unblock) ----------
function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function computePriorityRank(customer_impact, team_energy, frequency, ease) {
  // PR = round( (0.57*Customer + 0.43*Team) * (0.6*Frequency + 0.4*Ease) )
  const a = 0.57 * customer_impact + 0.43 * team_energy;
  const b = 0.6 * frequency + 0.4 * ease;
  return Math.round(a * b);
}
function tierForPR(pr) {
  if (pr >= 70) return "🔥 Make it happen";
  if (pr >= 50) return "🚀 Act on it now";
  if (pr >= 36) return "🧭 Move it forward";
  if (pr >= 25) return "🙂 When time allows";
  return "⚪ Park for later";
}
function shouldLeaderUnblock(team_energy, ease) {
  // Pilot rule: Team Energy ≥ 9 AND Ease ≤ 3
  return team_energy >= 9 && ease <= 3;
}

// ---------- health ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, table: "items", url: SUPABASE_URL });
});

// ---------- list (used by UI grid) ----------
app.get("/api/list", async (_req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select(
      "id, content, transcript, created_at, priority_rank, action_tier, leader_to_unblock, user_id, owner, org_id"
    )
    .order("priority_rank", { ascending: false })
    .limit(500);

  if (error) return res.status(500).json({ error: error.message });

  // Normalize fields UI expects
  const rows = (data || []).map((r) => ({
    id: r.id,
    title: r.content || r.transcript || "(untitled)",
    created_at: r.created_at,
    priority_rank: r.priority_rank || 0,
    action_tier: r.action_tier || "⚪ Park for later",
    leader_to_unblock: !!r.leader_to_unblock,
    originator: r.owner || r.user_id || null,
    org_name: "St Michael's",
  }));

  res.json({ items: rows });
});

// ---------- add NEW item (called by UI: POST /items/new) ----------
app.post("/items/new", async (req, res) => {
  // Accept several possible field names from UI
  const story =
    req.body.story ?? req.body.title ?? req.body.content ?? req.body.transcript ?? "(untitled)";

  const originator =
    req.body.originator ?? req.body.owner ?? req.body.user_id ?? req.body.me ?? null;

  const customer_impact = numOrNull(req.body.customer_impact);
  const team_energy = numOrNull(req.body.team_energy);
  const frequency = numOrNull(req.body.frequency);
  const ease = numOrNull(req.body.ease);

  let priority_rank = null;
  let action_tier = null;
  let leader_to_unblock = null;

  // If all 4 factors provided (1..10), compute rank/tier/unblock.
  const allHave =
    [customer_impact, team_energy, frequency, ease].every(
      (n) => Number.isFinite(n) && n >= 1 && n <= 10
    );

  if (allHave) {
    priority_rank = computePriorityRank(customer_impact, team_energy, frequency, ease);
    action_tier = tierForPR(priority_rank);
    leader_to_unblock = shouldLeaderUnblock(team_energy, ease);
  }

  const insert = {
    content: story,
    transcript: story,
    user_id: originator,
    owner: originator,
    customer_impact,
    team_energy,
    frequency,
    ease,
    priority_rank,
    action_tier,
    leader_to_unblock,
    status: "open",
  };

  const { data, error } = await supabase.from("items").insert(insert).select("*").single();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({
    ok: true,
    id: data.id,
    priority_rank: data.priority_rank || 0,
    action_tier: data.action_tier || "⚪ Park for later",
    leader_to_unblock: !!data.leader_to_unblock,
  });
});

// ---------- update FACTORS (called by UI: POST /items/:id/factors) ----------
app.post("/items/:id/factors", async (req, res) => {
  const itemId = req.params.id;

  const customer_impact = numOrNull(req.body.customer_impact);
  const team_energy = numOrNull(req.body.team_energy);
  const frequency = numOrNull(req.body.frequency);
  const ease = numOrNull(req.body.ease);

  // Validate
  for (const [k, v] of Object.entries({
    customer_impact,
    team_energy,
    frequency,
    ease,
  })) {
    if (!Number.isFinite(v) || v < 1 || v > 10) {
      return res.status(400).json({ error: `Invalid ${k}: must be number 1..10` });
    }
  }

  const pr = computePriorityRank(customer_impact, team_energy, frequency, ease);
  const tier = tierForPR(pr);
  const unblock = shouldLeaderUnblock(team_energy, ease);

  const { error } = await supabase
    .from("items")
    .update({
      customer_impact,
      team_energy,
      frequency,
      ease,
      priority_rank: pr,
      action_tier: tier,
      leader_to_unblock: unblock,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true, priority_rank: pr, action_tier: tier, leader_to_unblock: unblock });
});

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`✅ Felma backend running on :${PORT}`);
});
