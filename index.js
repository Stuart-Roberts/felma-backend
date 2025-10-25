// index.js – Felma backend (COMPLETE FILE WITH LIFECYCLE)
// Node 18+; requires SUPABASE_URL and SUPABASE_KEY env vars

const express = require("express");
const compression = require("compression");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// permissive CORS for pilot
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ---------- helpers (rank, tier, leader flag) ----------
function computePriorityRank(customer_impact, team_energy, frequency, ease) {
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
  return team_energy >= 9 && ease <= 3;
}

function toNum(v) {
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function clean(s) {
  return typeof s === "string" ? s.trim() : "";
}

// ---------- health ----------
app.get("/", (_req, res) => res.send("Felma server is running."));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------- list all items ----------
app.get("/api/list", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("items")
      .select(`
        *,
        stage,
        stage_3_involve,
        stage_4_choose,
        stage_5_prepare,
        stage_6_act,
        stage_7_learn,
        stage_8_recognise,
        stage_9_share
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return res.json({ items: data || [] });
  } catch (e) {
    console.error("GET /api/list error:", e);
    return res.status(500).json({ error: "list_failed" });
  }
});

// ---------- create new item ----------
app.post("/api/items", async (req, res) => {
  try {
    const body = req.body || {};
    const ci = toNum(body.customer_impact);
    const te = toNum(body.team_energy);
    const fq = toNum(body.frequency);
    const ez = toNum(body.ease);

    let pr = 0;
    let tier = "⚪ Park for later";
    let ltb = false;
    let stage = 1;

    // If all 4 factors provided, compute rank and set stage 2
    if (ci && te && fq && ez) {
      pr = computePriorityRank(ci, te, fq, ez);
      tier = tierForPR(pr);
      ltb = shouldLeaderUnblock(te, ez);
      stage = 2; // Auto-advance to stage 2 (Clarify) when rated
    }

    const insertRow = {
      content: clean(body.content) || "Untitled",
      user_id: clean(body.user_id) || null,
      originator_name: clean(body.originator_name) || null,
      priority_rank: pr,
      action_tier: tier,
      customer_impact: ci,
      team_energy: te,
      frequency: fq,
      ease: ez,
      leader_to_unblock: ltb,
      stage: stage,
      stage_1_timestamp: new Date().toISOString(),
      stage_2_timestamp: stage === 2 ? new Date().toISOString() : null,
    };

    const { data, error } = await supabase
      .from("items")
      .insert([insertRow])
      .select("*")
      .single();

    if (error) throw error;
    return res.status(201).json(data);
  } catch (e) {
    console.error("POST /api/items error:", e);
    return res.status(500).json({ error: "add_failed" });
  }
});

// ---------- update factors ----------
app.post("/items/:id/factors", async (req, res) => {
  try {
    const id = clean(req.params.id);
    if (!id) return res.status(400).json({ error: "bad_id" });

    const body = req.body || {};
    const ci = toNum(body.customer_impact);
    const te = toNum(body.team_energy);
    const fq = toNum(body.frequency);
    const ez = toNum(body.ease);

    if (!ci || !te || !fq || !ez) {
      return res.status(400).json({ error: "all_factors_required" });
    }

    const pr = computePriorityRank(ci, te, fq, ez);
    const tier = tierForPR(pr);
    const ltb = shouldLeaderUnblock(te, ez);

    // Get current stage
    const { data: current } = await supabase
      .from("items")
      .select("stage, stage_2_timestamp")
      .eq("id", id)
      .single();

    const patch = {
      customer_impact: ci,
      team_energy: te,
      frequency: fq,
      ease: ez,
      priority_rank: pr,
      action_tier: tier,
      leader_to_unblock: ltb,
    };

    // If this is first rating (stage 1 -> 2), advance stage
    if (current && current.stage === 1 && !current.stage_2_timestamp) {
      patch.stage = 2;
      patch.stage_2_timestamp = new Date().toISOString();
    }

    const { error } = await supabase
      .from("items")
      .update(patch)
      .eq("id", id);

    if (error) throw error;
    return res.json({ ok: true, priority_rank: pr, action_tier: tier, leader_to_unblock: ltb });
  } catch (e) {
    console.error("POST /items/:id/factors error:", e);
    return res.status(500).json({ error: "save_failed" });
  }
});

// ---------- NEW: update lifecycle stage ----------
app.post("/items/:id/stage", async (req, res) => {
  try {
    const id = clean(req.params.id);
    if (!id) return res.status(400).json({ error: "bad_id" });

    const { stage, note } = req.body;
    const stageNum = parseInt(stage);

    if (isNaN(stageNum) || stageNum < 1 || stageNum > 9) {
      return res.status(400).json({ error: "invalid_stage" });
    }

    const patch = {
      stage: stageNum,
      [`stage_${stageNum}_timestamp`]: new Date().toISOString(),
    };

    // Stages 3-8 have text notes
    if (stageNum >= 3 && stageNum <= 8 && note) {
      const stageNames = {
        3: "involve",
        4: "choose",
        5: "prepare",
        6: "act",
        7: "learn",
        8: "recognise",
      };
      patch[`stage_${stageNum}_${stageNames[stageNum]}`] = clean(note);
    }

    // Stage 9 stores the generated story
    if (stageNum === 9 && note) {
      patch.stage_9_share = clean(note);
    }

    const { error } = await supabase
      .from("items")
      .update(patch)
      .eq("id", id);

    if (error) throw error;
    return res.json({ ok: true, stage: stageNum });
  } catch (e) {
    console.error("POST /items/:id/stage error:", e);
    return res.status(500).json({ error: "stage_update_failed" });
  }
});

// ---------- START ----------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Felma backend running on ${PORT}`);
});
