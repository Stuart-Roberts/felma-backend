// index.js — Felma backend (Express + Supabase)
// Node 18+ recommended. Needs SUPABASE_URL and SUPABASE_KEY (service role) in env.

const express = require("express");
const compression = require("compression");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple CORS for UI
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ---------- Helpers (rank, tier, leader flag) ----------
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
  // Agreed rule: Team_Energy >= 9 AND Ease <= 3
  return Number(team_energy) >= 9 && Number(ease) <= 3;
}
function toInt01(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function displayTitle(row) {
  // Always give the UI something to show
  const t = (row?.title ?? "").trim();
  if (t) return t;
  const s = (row?.content ?? row?.story ?? row?.transcript ?? "").trim();
  return s || "(untitled)";
}

// ---------- Health ----------
app.get("/", (req, res) => {
  res.json({ ok: true, table: "items", url: process.env.SUPABASE_URL || null });
});
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---------- People (for phone/email → display name, leader) ----------
app.get("/api/people", async (_req, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, phone, display_name, is_leader, org_slug")
    .order("display_name", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ people: data || [] });
});

// ---------- List items (ranked first, then newest) ----------
app.get("/api/list", async (_req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select(
      "id, title, content, story, transcript, created_at, updated_at, user_id, priority_rank, action_tier, leader_to_unblock, status"
    )
    .order("priority_rank", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Guarantee a title in the payload
  const items = (data || []).map((r) => ({
    id: r.id,
    title: displayTitle(r),
    created_at: r.created_at,
    updated_at: r.updated_at,
    user_id: r.user_id,
    priority_rank: toInt01(r.priority_rank),
    action_tier: r.action_tier || null,
    leader_to_unblock: !!r.leader_to_unblock,
    status: r.status || "open",
  }));

  res.json({ items });
});

// ---------- Add new item ----------
app.post("/items/new", async (req, res) => {
  try {
    // From UI
    const {
      title,
      originator, // phone or user id (we just store it in user_id column)
      customer_impact,
      team_energy,
      frequency,
      ease,
    } = req.body || {};

    // Validate 1..10
    const nums = {
      customer_impact: Number(customer_impact),
      team_energy: Number(team_energy),
      frequency: Number(frequency),
      ease: Number(ease),
    };
    for (const [k, v] of Object.entries(nums)) {
      if (!Number.isFinite(v) || v < 1 || v > 10) {
        return res.status(400).json({ error: `Invalid ${k} (must be 1..10)` });
      }
    }

    const pr = computePriorityRank(nums.customer_impact, nums.team_energy, nums.frequency, nums.ease);
    const tier = tierForPR(pr);
    const unblock = shouldLeaderUnblock(nums.team_energy, nums.ease);

    const insert = {
      title: (title || "").trim() || "(untitled)",
      user_id: originator || null,
      customer_impact: nums.customer_impact,
      team_energy: nums.team_energy,
      frequency: nums.frequency,
      ease: nums.ease,
      priority_rank: pr,
      action_tier: tier,
      leader_to_unblock: unblock,
      status: "open",
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from("items").insert(insert).select("id").single();
    if (error) return res.status(500).json({ error: error.message });

    res.json({ ok: true, id: data.id, priority_rank: pr, action_tier: tier, leader_to_unblock: unblock });
  } catch (e) {
    console.error("POST /items/new error", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------- Update factors on an existing item ----------
app.post("/items/:id/factors", async (req, res) => {
  try {
    const itemId = req.params.id;
    const { customer_impact, team_energy, frequency, ease, user_next_step } = req.body || {};
    const nums = {
      customer_impact: Number(customer_impact),
      team_energy: Number(team_energy),
      frequency: Number(frequency),
      ease: Number(ease),
    };
    for (const [k, v] of Object.entries(nums)) {
      if (!Number.isFinite(v) || v < 1 || v > 10) {
        return res.status(400).json({ error: `Invalid ${k} (must be 1..10)` });
      }
    }

    const pr = computePriorityRank(nums.customer_impact, nums.team_energy, nums.frequency, nums.ease);
    const tier = tierForPR(pr);
    const unblock = shouldLeaderUnblock(nums.team_energy, nums.ease);

    const { error } = await supabase
      .from("items")
      .update({
        customer_impact: nums.customer_impact,
        team_energy: nums.team_energy,
        frequency: nums.frequency,
        ease: nums.ease,
        priority_rank: pr,
        action_tier: tier,
        leader_to_unblock: unblock,
        user_next_step: user_next_step ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, priority_rank: pr, action_tier: tier, leader_to_unblock: unblock });
  } catch (e) {
    console.error("POST /items/:id/factors error", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------- Start ----------
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Felma backend listening on ${port}`);
});
