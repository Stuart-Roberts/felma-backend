// index.js — Felma backend (FULL FILE)
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
  // Pilot rule (agreed): Team Energy >= 9 AND Ease <= 3 → true
  return team_energy >= 9 && ease <= 3;
}

function looksLike1to10(n) {
  return typeof n === "number" && n >= 1 && n <= 10;
}

// ---------- health ----------
app.get("/", (_req, res) => res.send("Felma server is running."));
app.get("/api/health", (_req, res) => {
  const url = process.env.SUPABASE_URL || "";
  res.json({ ok: true, table: "items", url });
});

// ---------- list (used by UI grid) ----------
app.get("/api/list", async (_req, res) => {
  // Only select columns we know exist everywhere to avoid “column does not exist”
  const { data, error } = await supabase
    .from("items")
    .select(
      "id, content, transcript, created_at, priority_rank, action_tier, leader_to_unblock, user_id"
    )
    .order("priority_rank", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return res.status(500).json({ error: error.message });

  const rows = (data || []).map((r) => ({
    id: r.id,
    title: r.content || r.transcript || "(untitled)",
    created_at: r.created_at,
    priority_rank: r.priority_rank ?? 0,
    action_tier: r.action_tier || "⚪ Park for later",
    leader_to_unblock: !!r.leader_to_unblock,
    originator: r.user_id || null,       // UI maps phone → display name
    org_name: "St Michael's",
  }));

  res.json({ items: rows });
});

// ---------- create new item ----------
app.post("/items/new", async (req, res) => {
  const {
    content,               // headline/story
    originator,            // phone/email/user id (optional)
    customer_impact,       // optional 1..10
    team_energy,           // optional 1..10
    frequency,             // optional 1..10
    ease                   // optional 1..10
  } = req.body || {};

  const hasAllFour =
    looksLike1to10(customer_impact) &&
    looksLike1to10(team_energy) &&
    looksLike1to10(frequency) &&
    looksLike1to10(ease);

  let pr = null, tier = null, unblock = null;
  if (hasAllFour) {
    pr = computePriorityRank(customer_impact, team_energy, frequency, ease);
    tier = tierForPR(pr);
    unblock = shouldLeaderUnblock(team_energy, ease);
  }

  const payload = {
    user_id: originator || null,
    content: (content || "").trim(),
    // factors only if present
    customer_impact: hasAllFour ? customer_impact : null,
    team_energy: hasAllFour ? team_energy : null,
    frequency: hasAllFour ? frequency : null,
    ease: hasAllFour ? ease : null,
    // computed only if we had all four
    priority_rank: hasAllFour ? pr : null,
    action_tier: hasAllFour ? tier : null,
    leader_to_unblock: hasAllFour ? unblock : null,
    status: "open",
  };

  const { data, error } = await supabase.from("items").insert(payload).select("id").single();
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true, id: data.id, priority_rank: pr, action_tier: tier, leader_to_unblock: unblock });
});

// ---------- update factors (and recompute) ----------
app.post("/items/:id/factors", async (req, res) => {
  const itemId = req.params.id;
  const { customer_impact, team_energy, frequency, ease } = req.body || {};

  // Validate 1..10 for all
  for (const [k, v] of Object.entries({ customer_impact, team_energy, frequency, ease })) {
    if (!looksLike1to10(v)) {
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, priority_rank: pr, action_tier: tier, leader_to_unblock: unblock });
});

// ---------- minimal HTML list (optional) ----------
function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

app.get("/glide/view", async (_req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select("id, content, transcript, created_at, priority_rank, action_tier, leader_to_unblock")
    .order("priority_rank", { ascending: false })
    .limit(200);

  if (error) return res.status(500).send(`<pre>${esc(error.message)}</pre>`);

  const rows = data || [];
  const html = `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Felma — Items</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:16px}
.card{border:1px solid #ddd;border-radius:10px;padding:10px;margin:8px 0}
.meta{color:#666;font-size:12px}
.chip{display:inline-block;padding:3px 8px;border-radius:999px;background:#eef9fa;color:#106a71;font-size:12px;margin-right:6px}
.unblock{background:#fee2e2;color:#b91c1c}
</style></head><body>
<h1>Felma — Items</h1>
${rows.map(r=>`<div class="card">
  <div><strong>${esc(r.content||r.transcript||"(untitled)")}</strong></div>
  <div class="meta">${new Date(r.created_at).toLocaleString()}</div>
  <div>
    ${r.action_tier?`<span class="chip">${esc(r.action_tier)}</span>`:""}
    ${r.leader_to_unblock?`<span class="chip unblock">Leader to Unblock</span>`:""}
  </div>
</div>`).join("")}
${rows.length===0?`<p>No items yet.</p>`:""}
</body></html>`;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.send(html);
});

// ---------- start ----------
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`✅ Felma backend running on port ${port}`);
});
