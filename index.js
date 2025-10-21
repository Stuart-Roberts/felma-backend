// index.js — Felma server (pilot, CJS)
// Env needed: SUPABASE_URL, SUPABASE_KEY (service role or anon with R/W to public.items)

const express = require("express");
const compression = require("compression");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TABLE = "items";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const app = express();
app.use(compression());
app.use(express.urlencoded({ extended: true })); // Twilio form-encoded
app.use(express.json());

// Simple CORS for MVP
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ---------- Helpers (agreed logic) ----------
function clamp1to10(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.min(10, Math.max(1, Math.round(x)));
}

// PR = round( (0.57*Customer + 0.43*Team) * (0.6*Frequency + 0.4*Ease) )
function computePriorityRank(customer_impact, team_energy, frequency, ease) {
  const a = 0.57 * customer_impact + 0.43 * team_energy;
  const b = 0.6 * frequency + 0.4 * ease;
  return Math.round(a * b);
}

// FIVE tiers (exact thresholds)
function tierForPR(pr) {
  if (pr >= 70) return "🔥 Make it happen";
  if (pr >= 50) return "🚀 Act on it now";
  if (pr >= 36) return "🧭 Move it forward";
  if (pr >= 25) return "🙂 When time allows";
  return "⚪ Park for later";
}

// Leader to Unblock = Team Energy ≥ 9 AND Ease ≤ 3
function shouldLeaderUnblock(team_energy, ease) {
  return Number(team_energy) >= 9 && Number(ease) <= 3;
}

// Decorate rows that might be missing derived values (old seed data)
function decorateRow(r) {
  const out = { ...r };
  const ok =
    [r.customer_impact, r.team_energy, r.frequency, r.ease].every(
      (v) => typeof v === "number" && v >= 1 && v <= 10
    );

  if (!Number.isFinite(out.priority_rank)) {
    out.priority_rank = ok ? computePriorityRank(r.customer_impact, r.team_energy, r.frequency, r.ease) : 0;
  }
  if (!out.action_tier) out.action_tier = tierForPR(out.priority_rank);
  if (typeof out.leader_to_unblock !== "boolean") {
    out.leader_to_unblock = ok ? shouldLeaderUnblock(r.team_energy, r.ease) : false;
  }
  return out;
}

// ---------- Health ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, table: TABLE, url: SUPABASE_URL });
});

// ---------- List (ranked by default) ----------
app.get("/api/list", async (req, res) => {
  try {
    const view = String(req.query.view || "ranked").toLowerCase(); // ranked | newest | mine
    const who = (req.query.who || "").trim(); // user_id or originator_name

    let q = sb
      .from(TABLE)
      .select(
        "id,content,transcript,originator_name,user_id,created_at,updated_at,status," +
          "customer_impact,team_energy,frequency,ease,priority_rank,action_tier,leader_to_unblock"
      )
      .limit(400);

    if (view === "newest") {
      q = q.order("created_at", { ascending: false });
    } else {
      // ranked (default)
      q = q.order("priority_rank", { ascending: false }).order("created_at", { ascending: false });
    }

    if (view === "mine" && who) {
      q = q.or(`originator_name.eq.${who},user_id.eq.${who}`);
    }

    const { data, error } = await q;
    if (error) throw error;
    res.json({ items: (data || []).map(decorateRow) });
  } catch (e) {
    console.error("LIST error", e);
    res.status(500).json({ error: "list_failed" });
  }
});

// ---------- Detail ----------
app.get("/api/item/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await sb.from(TABLE).select("*").eq("id", id).single();
    if (error) throw error;
    res.json({ item: decorateRow(data) });
  } catch (e) {
    res.status(404).json({ error: "not_found" });
  }
});

// ---------- Create (web form requires all 4 ratings) ----------
app.post("/api/items", async (req, res) => {
  try {
    const {
      user_id,
      originator_name,
      content,
      customer_impact,
      team_energy,
      frequency,
      ease,
    } = req.body || {};

    const ci = clamp1to10(customer_impact);
    const te = clamp1to10(team_energy);
    const fr = clamp1to10(frequency);
    const ez = clamp1to10(ease);
    if (![ci, te, fr, ez].every((v) => Number.isFinite(v))) {
      return res.status(400).json({ error: "All four ratings must be integers 1..10." });
    }

    const pr = computePriorityRank(ci, te, fr, ez);
    const tier = tierForPR(pr);
    const unblock = shouldLeaderUnblock(te, ez);

    const { data, error } = await sb
      .from(TABLE)
      .insert({
        user_id: user_id || null,
        originator_name: originator_name || null,
        content: content || null,
        customer_impact: ci,
        team_energy: te,
        frequency: fr,
        ease: ez,
        priority_rank: pr,
        action_tier: tier,
        leader_to_unblock: unblock,
        status: "open",
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (error) throw error;
    res.json(decorateRow(data));
  } catch (e) {
    console.error("CREATE error", e);
    res.status(500).json({ error: "create_failed" });
  }
});

// ---------- Update factors (recalculate) ----------
app.post("/api/items/:id/factors", async (req, res) => {
  try {
    const { id } = req.params;
    const { customer_impact, team_energy, frequency, ease, user_next_step } = req.body || {};

    const ci = clamp1to10(customer_impact);
    const te = clamp1to10(team_energy);
    const fr = clamp1to10(frequency);
    const ez = clamp1to10(ease);
    if (![ci, te, fr, ez].every((v) => Number.isFinite(v))) {
      return res.status(400).json({ error: "All four ratings must be integers 1..10." });
    }

    const pr = computePriorityRank(ci, te, fr, ez);
    const tier = tierForPR(pr);
    const unblock = shouldLeaderUnblock(te, ez);

    const { data, error } = await sb
      .from(TABLE)
      .update({
        customer_impact: ci,
        team_energy: te,
        frequency: fr,
        ease: ez,
        priority_rank: pr,
        action_tier: tier,
        leader_to_unblock: unblock,
        user_next_step: user_next_step ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    res.json(decorateRow(data));
  } catch (e) {
    console.error("FACTORS error", e);
    res.status(500).json({ error: "update_failed" });
  }
});

// ---------- Twilio SMS (kept simple) ----------
app.post("/sms", async (req, res) => {
  const from = req.body?.From || "unknown";
  const body = (req.body?.Body || "").trim();

  // Minimal STOP/HELP
  const lower = body.toLowerCase();
  if (["stop", "stop all", "end", "unsubscribe", "cancel", "quit"].includes(lower)) {
    const msg = "Got it — text START anytime to use Felma again.";
    return res.type("text/xml").send(`<?xml version="1.0"?><Response><Message>${msg}</Message></Response>`);
  }
  if (lower === "help") {
    const msg = "Text Felma what you’ve noticed. We’ll log it for your team. Reply STOP to opt out.";
    return res.type("text/xml").send(`<?xml version="1.0"?><Response><Message>${msg}</Message></Response>`);
  }

  await sb.from(TABLE).insert({
    user_id: from,
    transcript: body,
    response: "Felma received your text and logged it.",
    status: "open",
  });

  const reply = "Thanks — logged. You can finish ratings in the app.";
  res.type("text/xml").send(`<?xml version="1.0"?><Response><Message>${reply}</Message></Response>`);
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`✅ Felma server listening on ${PORT}`);
});
