// felma-backend/index.js — clean full file
const express = require("express");
const compression = require("compression");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS (simple + safe for pilot)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ---------- Health ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, table: "items", url: process.env.SUPABASE_URL });
});

// ---------- Helpers (rank + tier + leader flag) ----------
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
  // Pilot rule (you confirmed): Team Energy ≥ 9 AND Ease ≤ 3
  return team_energy >= 9 && ease <= 3;
}

// ---------- List (used by UI grid) ----------
app.get("/api/list", async (req, res) => {
  try {
    const status = req.query.status || "open";

    // Return all fields the UI needs to render cards + drawer
    const selectCols = [
      "id",
      "created_at",
      "updated_at",
      "status",
      "item_type",
      "content",
      "transcript",
      "story_json",
      "priority_rank",
      "action_tier",
      "leader_to_unblock",
      "customer_impact",
      "team_energy",
      "frequency",
      "ease",
      "user_id",
      "originator_name",
      "org_id",
      "org_slug"
    ].join(",");

    let q = supabase
      .from("items")
      .select(selectCols)
      .eq("status", status)
      .order("priority_rank", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    const { data, error } = await q;

    if (error) return res.status(500).json({ error: error.message });

    res.json({ items: data || [] });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---------- Create new item (used by “+ New”) ----------
app.post("/items/new", async (req, res) => {
  try {
    const {
      story = "",
      customer_impact = null,
      team_energy = null,
      frequency = null,
      ease = null,
      user_id = null,
      originator_name = null,
      org_slug = null
    } = req.body || {};

    // Insert minimal row first
    const insertPayload = {
      content: story || null,
      user_id: user_id || null,
      originator_name: originator_name || null,
      org_slug: org_slug || "demo",
      status: "open"
    };

    // If all four factors provided, calculate PR/tier/leader
    if (
      [customer_impact, team_energy, frequency, ease].every(
        (v) => typeof v === "number" && v >= 1 && v <= 10
      )
    ) {
      const pr = computePriorityRank(
        customer_impact,
        team_energy,
        frequency,
        ease
      );
      insertPayload.customer_impact = customer_impact;
      insertPayload.team_energy = team_energy;
      insertPayload.frequency = frequency;
      insertPayload.ease = ease;
      insertPayload.priority_rank = pr;
      insertPayload.action_tier = tierForPR(pr);
      insertPayload.leader_to_unblock = shouldLeaderUnblock(
        team_energy,
        ease
      );
    }

    const { data, error } = await supabase
      .from("items")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({ ok: true, item: data });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---------- Save 4-factor ratings for an item ----------
app.post("/items/:id/factors", async (req, res) => {
  try {
    const itemId = req.params.id;
    const { customer_impact, team_energy, frequency, ease, user_next_step } =
      req.body || {};

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
        updated_at: new Date().toISOString()
      })
      .eq("id", itemId);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ ok: true, priority_rank: pr, action_tier: tier, leader_to_unblock: unblock });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---------- Start ----------
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Felma backend listening on ${port}`);
});
