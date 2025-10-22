// felma-backend/index.js — MVP server
// Node 18+; SUPABASE_URL / SUPABASE_KEY in env

const express = require("express");
const compression = require("compression");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS (simple)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ---------- helpers ----------
const titleFrom = (s = "") =>
  String(s).trim().replace(/\s+/g, " ").slice(0, 80) || "(untitled)";

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
  // Pilot rule
  return team_energy >= 9 && ease <= 3;
}
function mustBeScore(n, name) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1 || n > 10) {
    throw new Error(`Invalid ${name}: must be integer 1..10`);
  }
}

// ---------- health ----------
app.get("/api/health", (_, res) => res.json({ ok: true }));

// ---------- people (profiles) ----------
app.get("/api/people", async (_, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,phone,display_name,is_leader,org_slug");
  if (error) return res.status(500).json({ error: error.message });
  res.json({ people: data || [] });
});

// ---------- list ----------
app.get("/api/list", async (req, res) => {
  const org = req.query.org || "stmichaels";
  const { data, error } = await supabase
    .from("items")
    .select("id,created_at,user_id,title,transcript,priority_rank,action_tier,leader_to_unblock,response,org_slug,customer_impact,team_energy,frequency,ease")
    .eq("org_slug", org)
    .order("priority_rank", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data || [] });
});

// ---------- create ----------
app.post("/items/new", async (req, res) => {
  try {
    const {
      story,            // free text (we’ll derive title)
      user_phone,       // e.g. "+4478…"
      customer_impact,
      team_energy,
      frequency,
      ease,
      org_slug = "stmichaels",
    } = req.body || {};

    // title
    const title = titleFrom(story || "");

    // Validate scores (must be set in pilot; UI enforces this)
    mustBeScore(customer_impact, "customer_impact");
    mustBeScore(team_energy, "team_energy");
    mustBeScore(frequency, "frequency");
    mustBeScore(ease, "ease");

    const pr = computePriorityRank(customer_impact, team_energy, frequency, ease);
    const tier = tierForPR(pr);
    const unblock = shouldLeaderUnblock(team_energy, ease);

    const { data, error } = await supabase
      .from("items")
      .insert({
        org_slug,
        user_id: user_phone || null,
        transcript: story || null,
        title,
        customer_impact,
        team_energy,
        frequency,
        ease,
        priority_rank: pr,
        action_tier: tier,
        leader_to_unblock: unblock,
        response: null,
      })
      .select("id")
      .single();

    if (error) throw error;
    res.json({ ok: true, id: data.id, priority_rank: pr, action_tier: tier, leader_to_unblock: unblock });
  } catch (e) {
    res.status(400).json({ error: e.message || String(e) });
  }
});

// ---------- update factors (+ optional title edit) ----------
app.post("/items/:id/factors", async (req, res) => {
  try {
    const id = req.params.id;
    const { customer_impact, team_energy, frequency, ease, title } = req.body || {};

    mustBeScore(customer_impact, "customer_impact");
    mustBeScore(team_energy, "team_energy");
    mustBeScore(frequency, "frequency");
    mustBeScore(ease, "ease");

    const pr = computePriorityRank(customer_impact, team_energy, frequency, ease);
    const tier = tierForPR(pr);
    const unblock = shouldLeaderUnblock(team_energy, ease);

    const patch = {
      customer_impact, team_energy, frequency, ease,
      priority_rank: pr,
      action_tier: tier,
      leader_to_unblock: unblock,
      updated_at: new Date().toISOString(),
    };
    if (typeof title === "string") {
      patch.title = titleFrom(title);
    }

    const { error } = await supabase.from("items").update(patch).eq("id", id);
    if (error) throw error;

    res.json({ ok: true, priority_rank: pr, action_tier: tier, leader_to_unblock: unblock });
  } catch (e) {
    res.status(400).json({ error: e.message || String(e) });
  }
});

// ---------- start ----------
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Backend on :${port}`));
