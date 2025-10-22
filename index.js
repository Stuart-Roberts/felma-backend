// Felma backend (Express + Supabase)
// Requirements: express, @supabase/supabase-js, compression, dotenv
// ENV needed on Render: SUPABASE_URL, SUPABASE_KEY

const express = require("express");
const compression = require("compression");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Very simple CORS for the pilot
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ---------- Helpers: ranking, tiers, leader flag ----------
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
  // Agreed rule: Team Energy >= 9 AND Ease <= 3
  return team_energy >= 9 && ease <= 3;
}
function coalesceTitle(row) {
  const t = (row.content ?? row.transcript ?? "").trim();
  return t.length ? t : "(untitled)";
}

// ---------- Health ----------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, table: "items", url: process.env.SUPABASE_URL || "" });
});

// ---------- People (for phone/email -> display names) ----------
app.get("/api/people", async (req, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("phone, email, full_name, display_name, is_leader")
    .order("full_name", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// ---------- Items list (rank/newest/mine) ----------
app.get("/api/list", async (req, res) => {
  const view = (req.query.view || "rank").toLowerCase(); // "rank" | "new" | "mine"
  const me = (req.query.me || "").trim();                // phone for now (E.164)

  let query = supabase
    .from("items")
    .select("id, content, transcript, created_at, user_id, priority_rank, action_tier, leader_to_unblock")
    .limit(400);

  if (view === "mine" && me) {
    query = query.eq("user_id", me).order("created_at", { ascending: false });
  } else if (view === "new" || view === "newest") {
    query = query.order("created_at", { ascending: false });
  } else {
    // default: rank
    // sort by rank desc, then newest
    query = query
      .order("priority_rank", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const items = (data || []).map((r) => ({
    id: r.id,
    title: coalesceTitle(r),
    created_at: r.created_at,
    user_id: r.user_id, // front-end maps to display name via /api/people
    priority_rank: r.priority_rank ?? 0,
    action_tier: r.action_tier || "⚪ Park for later",
    leader_to_unblock: !!r.leader_to_unblock,
  }));

  res.json({ items });
});

// ---------- Add new item (with optional immediate factors) ----------
app.post("/items/new", async (req, res) => {
  const {
    content,
    transcript,
    user_id,         // for now: phone (E.164). Later: auth user id.
    org,             // optional
    org_slug,        // optional
    customer_impact, // optional 1..10
    team_energy,     // optional 1..10
    frequency,       // optional 1..10
    ease             // optional 1..10
  } = req.body || {};

  const title = ((content ?? transcript ?? "").trim()) || "(untitled)";
  const now = new Date().toISOString();

  let pr = null, tier = null, unblock = null;

  const hasAllFactors =
    [customer_impact, team_energy, frequency, ease].every(
      (n) => typeof n === "number" && n >= 1 && n <= 10
    );

  if (hasAllFactors) {
    pr = computePriorityRank(customer_impact, team_energy, frequency, ease);
    tier = tierForPR(pr);
    unblock = shouldLeaderUnblock(team_energy, ease);
  }

  const insertPayload = {
    content: title,
    transcript: (transcript ?? null),
    user_id: user_id ?? null,
    org: org ?? null,
    org_slug: org_slug ?? null,
    priority_rank: pr,
    action_tier: tier,
    leader_to_unblock: unblock,
    customer_impact: hasAllFactors ? customer_impact : null,
    team_energy:     hasAllFactors ? team_energy     : null,
    frequency:       hasAllFactors ? frequency       : null,
    ease:            hasAllFactors ? ease            : null,
    status: "open",
    created_at: now,
    updated_at: now
  };

  const { data, error } = await supabase
    .from("items")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) return res.status(500).json({ error: error.message });

  res.json({
    ok: true,
    item: {
      id: data.id,
      title: coalesceTitle(data),
      created_at: data.created_at,
      user_id: data.user_id,
      priority_rank: data.priority_rank ?? 0,
      action_tier: data.action_tier || "⚪ Park for later",
      leader_to_unblock: !!data.leader_to_unblock,
    },
  });
});

// ---------- Update factors for an item ----------
app.post("/items/:id/factors", async (req, res) => {
  const itemId = req.params.id;
  const { customer_impact, team_energy, frequency, ease, user_next_step } = req.body || {};

  const nums = { customer_impact, team_energy, frequency, ease };
  for (const [k, v] of Object.entries(nums)) {
    if (typeof v !== "number" || v < 1 || v > 10) {
      return res.status(400).json({ error: `Invalid ${k}: must be 1..10` });
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
      user_next_step: user_next_step ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, priority_rank: pr, action_tier: tier, leader_to_unblock: unblock });
});

// ---------- Start ----------
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Felma backend listening on ${port}\n>> Your service is live ✅`);
});
