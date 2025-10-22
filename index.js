// Felma backend – clean build (Express + Supabase)
// Env needed: SUPABASE_URL, SUPABASE_KEY  (already set)

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

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ---------- Helpers ----------
function makeTitle(title, transcript) {
  const raw = (title && title.trim().length > 0) ? title.trim() : (transcript || "").trim();
  if (!raw) return "(untitled)";
  // collapse whitespace and cap at 80 chars
  const collapsed = raw.replace(/\s+/g, " ");
  return collapsed.slice(0, 80);
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
  // Agreed rule: Team Energy >= 9 AND Ease <= 3
  return Number(team_energy) >= 9 && Number(ease) <= 3;
}

function num1to10(x) {
  const n = Number(x);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}

// ---------- Health ----------
app.get("/", (_, res) => res.json({ ok: true }));
app.get("/api/health", (_, res) => res.json({ ok: true }));

// ---------- People (profiles) ----------
app.get("/api/people", async (_, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, phone, display_name, is_leader, org_slug");
  if (error) return res.status(500).json({ error: error.message });
  res.json({ people: data || [] });
});

// ---------- List ----------
app.get("/api/list", async (req, res) => {
  try {
    const view = (req.query.view || "all").toLowerCase(); // 'all' | 'mine' | 'newest'
    const user = (req.query.user || "").trim();

    let query = supabase
      .from("items")
      .select("id, title, transcript, created_at, user_id, priority_rank, action_tier, leader_to_unblock")
      .limit(500);

    if (view === "mine" && user) {
      query = query.eq("user_id", user);
      // show by rank, then date
      query = query.order("priority_rank", { ascending: false, nullsFirst: false })
                   .order("created_at", { ascending: false });
    } else if (view === "newest") {
      query = query.order("created_at", { ascending: false });
    } else {
      // default: ranked high→low, then newest
      query = query.order("priority_rank", { ascending: false, nullsFirst: false })
                   .order("created_at", { ascending: false });
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // ensure a safe title in the payload (tolerate old rows)
    const items = (data || []).map(r => ({
      id: r.id,
      created_at: r.created_at,
      user_id: r.user_id || null,
      title: makeTitle(r.title, r.transcript),
      priority_rank: r.priority_rank ?? null,
      action_tier: r.action_tier || null,
      leader_to_unblock: !!r.leader_to_unblock
    }));

    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---------- Add new item ----------
app.post("/items/new", async (req, res) => {
  try {
    const {
      user_id,
      title,
      transcript,
      customer_impact,
      team_energy,
      frequency,
      ease
    } = req.body || {};

    const t = makeTitle(title, transcript);

    const ci = num1to10(customer_impact);
    const te = num1to10(team_energy);
    const fr = num1to10(frequency);
    const ea = num1to10(ease);

    if (!transcript && !title) {
      return res.status(400).json({ error: "Provide title or transcript." });
    }
    if ([ci, te, fr, ea].some(v => v === null)) {
      return res.status(400).json({ error: "All four factors must be 1..10." });
    }

    const pr = computePriorityRank(ci, te, fr, ea);
    const tier = tierForPR(pr);
    const unblock = shouldLeaderUnblock(te, ea);

    const { data, error } = await supabase
      .from("items")
      .insert([{
        user_id: user_id || null,
        title: t,
        transcript: transcript || null,
        customer_impact: ci,
        team_energy: te,
        frequency: fr,
        ease: ea,
        priority_rank: pr,
        action_tier: tier,
        leader_to_unblock: unblock
      }])
      .select("id")
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, id: data.id, priority_rank: pr, action_tier: tier, leader_to_unblock: unblock });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---------- Update factors on an existing item ----------
app.post("/items/:id/factors", async (req, res) => {
  try {
    const id = req.params.id;
    const { customer_impact, team_energy, frequency, ease, title, transcript } = req.body || {};

    const ci = num1to10(customer_impact);
    const te = num1to10(team_energy);
    const fr = num1to10(frequency);
    const ea = num1to10(ease);

    if ([ci, te, fr, ea].some(v => v === null)) {
      return res.status(400).json({ error: "All four factors must be 1..10." });
    }

    const pr = computePriorityRank(ci, te, fr, ea);
    const tier = tierForPR(pr);
    const unblock = shouldLeaderUnblock(te, ea);

    const safeTitle = makeTitle(title, transcript);

    const { error } = await supabase
      .from("items")
      .update({
        title: safeTitle,
        transcript: transcript || null,
        customer_impact: ci,
        team_energy: te,
        frequency: fr,
        ease: ea,
        priority_rank: pr,
        action_tier: tier,
        leader_to_unblock: unblock,
        updated_at: new Date().toISOString()
      })
      .eq("id", id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, priority_rank: pr, action_tier: tier, leader_to_unblock: unblock });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ---------- Start ----------
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log("Felma backend running on port", port);
});
