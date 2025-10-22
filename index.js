// Felma backend - pilot build (org-aware + safe titles, legacy rows included)
// Env in Render: SUPABASE_URL, SUPABASE_KEY, DEFAULT_ORG=stmichaels

const express = require("express");
const compression = require("compression");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Simple CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const DEFAULT_ORG = process.env.DEFAULT_ORG || null;

function fallbackTitle(row) {
  if (row?.title && row.title.trim().length) return row.title.trim();
  const t = (row?.transcript || "").trim().replace(/\s+/g, " ");
  if (t.length) return t.slice(0, 80);
  return "(untitled)";
}

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

// Health
app.get("/", (_req, res) => res.send("Felma backend up."));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// People
app.get("/api/people", async (req, res) => {
  const org = (req.query.org || DEFAULT_ORG || "").trim();
  let q = supabase.from("profiles").select("id,email,phone,display_name,full_name,is_leader,org_slug");
  if (org) q = q.eq("org_slug", org);
  const { data, error } = await q.order("display_name", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ people: data || [] });
});

// Items list (includes legacy NULL org rows so your old data shows)
app.get("/api/list", async (req, res) => {
  const org = (req.query.org || DEFAULT_ORG || "").trim();

  let q = supabase
    .from("items")
    .select(
      "id,created_at,title,transcript,user_id,org_slug,priority_rank,action_tier,leader_to_unblock,customer_impact,team_energy,frequency,ease"
    );

  // Key tweak: include legacy NULL org rows as well
  if (org) q = q.or(`org_slug.eq.${org},org_slug.is.null`);

  q = q.order("priority_rank", { ascending: false, nullsFirst: false })
       .order("created_at", { ascending: false });

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const items = (data || []).map((r) => ({ ...r, title: fallbackTitle(r) }));
  res.json({ items });
});

// Add new item
app.post("/items/new", async (req, res) => {
  const body = req.body || {};
  const org = (body.org_slug || req.query.org || DEFAULT_ORG || "").trim() || null;
  const user_id = (body.user_id || "").trim() || null;
  const title = typeof body.title === "string" ? body.title : null;
  const transcript = typeof body.transcript === "string" ? body.transcript : null;

  const c = Number(body.customer_impact);
  const t = Number(body.team_energy);
  const f = Number(body.frequency);
  const e = Number(body.ease);

  const haveAllFour =
    [c, t, f, e].every((n) => Number.isFinite(n)) &&
    c >= 1 && c <= 10 &&
    t >= 1 && t <= 10 &&
    f >= 1 && f <= 10 &&
    e >= 1 && e <= 10;

  const pr = haveAllFour ? computePriorityRank(c, t, f, e) : null;
  const tier = haveAllFour ? tierForPR(pr) : null;
  const unblock = haveAllFour ? shouldLeaderUnblock(t, e) : false;

  const insertRow = {
    org_slug: org,
    user_id,
    title,
    transcript,
    customer_impact: haveAllFour ? c : null,
    team_energy: haveAllFour ? t : null,
    frequency: haveAllFour ? f : null,
    ease: haveAllFour ? e : null,
    priority_rank: pr,
    action_tier: tier,
    leader_to_unblock: unblock,
  };

  const { data, error } = await supabase.from("items").insert(insertRow).select("*").single();
  if (error) return res.status(500).json({ error: error.message });

  data.title = fallbackTitle(data);
  res.json({ ok: true, item: data });
});

// Update 4 factors
app.post("/items/:id/factors", async (req, res) => {
  const id = req.params.id;
  const { customer_impact, team_energy, frequency, ease } = req.body || {};

  const c = Number(customer_impact);
  const t = Number(team_energy);
  const f = Number(frequency);
  const e = Number(ease);

  for (const [k, v] of Object.entries({ customer_impact: c, team_energy: t, frequency: f, ease: e })) {
    if (!Number.isFinite(v) || v < 1 || v > 10) {
      return res.status(400).json({ error: `Invalid ${k}: must be 1..10` });
    }
  }

  const pr = computePriorityRank(c, t, f, e);
  const tier = tierForPR(pr);
  const unblock = shouldLeaderUnblock(t, e);

  const { error } = await supabase
    .from("items")
    .update({
      customer_impact: c,
      team_energy: t,
      frequency: f,
      ease: e,
      priority_rank: pr,
      action_tier: tier,
      leader_to_unblock: unblock,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, priority_rank: pr, action_tier: tier, leader_to_unblock: unblock });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Felma backend running on :${port}`);
});
