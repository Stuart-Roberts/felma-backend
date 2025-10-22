// Felma backend — pilot build
// Requirements: Node 18+ (Render uses 20.x), SUPABASE_URL + SUPABASE_KEY in env

const express = require("express");
const compression = require("compression");
const { createClient } = require("@supabase/supabase-js");

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

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ---------- helpers ----------
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

// Pilot rule (your final one): Team Energy ≥ 9 AND Ease ≤ 3
function shouldLeaderUnblock(team_energy, ease) {
  return team_energy >= 9 && ease <= 3;
}

function bestTitle(row) {
  const pick =
    (row.title && row.title.trim()) ||
    (row.content && row.content.trim()) ||
    (row.transcript && row.transcript.trim()) ||
    "";
  if (!pick) return "(untitled)";
  const singleSpaced = pick.replace(/\s+/g, " ").trim();
  return singleSpaced.length > 80 ? singleSpaced.slice(0, 80) : singleSpaced;
}

// ---------- health ----------
app.get("/", (req, res) => res.json({ ok: true }));
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ---------- people (profiles) ----------
app.get("/api/people", async (req, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,phone,display_name,is_leader,org_slug,org");

  if (error) return res.status(500).json({ error: error.message });
  res.json({ people: data || [] });
});

// ---------- list items for UI ----------
app.get("/api/list", async (req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select(
      "id,created_at,title,content,transcript,priority_rank,action_tier,leader_to_unblock,user_id"
    )
    .order("priority_rank", { ascending: false })
    .limit(400);

  if (error) return res.status(500).json({ error: error.message });

  // ensure title is always non-empty for the UI
  const rows = (data || []).map((r) => ({
    ...r,
    title: bestTitle(r),
  }));

  res.json({ items: rows });
});

// ---------- create new item ----------
app.post("/items/new", async (req, res) => {
  try {
    const {
      story,
      title,
      transcript,
      content,
      user_id,
      phone,
      email,
      customer_impact,
      team_energy,
      frequency,
      ease,
    } = req.body || {};

    // who is the originator (pilot stores phone in user_id for SMS; allow either)
    const origin = user_id || phone || email || null;

    // text → title/transcript
    const rawText = title || story || content || transcript || "";
    const row = {
      user_id: origin,
      transcript: transcript || rawText || null,
      content: content || null,
    };
    row.title = bestTitle({ title, content, transcript: row.transcript });

    // sliders (pilot requires all four 1..10)
    const nums = { customer_impact, team_energy, frequency, ease };
    for (const [k, v] of Object.entries(nums)) {
      if (typeof v !== "number" || v < 1 || v > 10) {
        return res.status(400).json({ error: `Invalid ${k}: must be 1..10` });
      }
    }

    const pr = computePriorityRank(
      customer_impact,
      team_energy,
      frequency,
      ease
    );
    const tier = tierForPR(pr);
    const unblock = shouldLeaderUnblock(team_energy, ease);

    Object.assign(row, {
      customer_impact,
      team_energy,
      frequency,
      ease,
      priority_rank: pr,
      action_tier: tier,
      leader_to_unblock: unblock,
    });

    const { data, error } = await supabase
      .from("items")
      .insert(row)
      .select("id")
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.json({
      ok: true,
      id: data.id,
      priority_rank: pr,
      action_tier: tier,
      leader_to_unblock: unblock,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "create failed" });
  }
});

// ---------- update 4 factors on an item ----------
app.post("/items/:id/factors", async (req, res) => {
  try {
    const id = req.params.id;
    const { customer_impact, team_energy, frequency, ease, user_next_step } =
      req.body || {};

    const nums = { customer_impact, team_energy, frequency, ease };
    for (const [k, v] of Object.entries(nums)) {
      if (typeof v !== "number" || v < 1 || v > 10) {
        return res.status(400).json({ error: `Invalid ${k}: must be 1..10` });
      }
    }

    const pr = computePriorityRank(
      customer_impact,
      team_energy,
      frequency,
      ease
    );
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
      .eq("id", id);

    if (error) return res.status(500).json({ error: error.message });

    res.json({
      ok: true,
      priority_rank: pr,
      action_tier: tier,
      leader_to_unblock: unblock,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "update failed" });
  }
});

// ---------- start ----------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Felma backend listening on :${port}`);
});
