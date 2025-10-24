// Felma backend (CommonJS) using Supabase HTTP client.
// No direct Postgres sockets. Works on Render free tier.

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

// ---- CORS (single origin or allow all if unset) ----
const allowlist = (process.env.CORS_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl/postman
    if (allowlist.length === 0 || allowlist.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  }
}));
app.use(express.json());

// ---- Supabase client (service_role) ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY; // service_role
if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY env vars");
}
const supabase = createClient(SUPABASE_URL, ADMIN_KEY);

// ---- Helpers ----
function safeTitle(row) {
  const fromTitle = (row.title || "").trim();
  if (fromTitle) return fromTitle;
  const fromTranscript = (row.transcript || "").replace(/\s+/g, " ").trim();
  if (fromTranscript) return fromTranscript.slice(0, 80);
  return "(untitled)";
}
function clamp10(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(1, Math.min(10, Math.round(x)));
}

// ---- Routes ----
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/people", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id:uuid,email,phone,full_name,display_name");

    if (error) throw error;

    const people = (data || []).map(p => ({
      id: p.id,
      email: p.email,
      phone: p.phone,
      full_name: p.full_name,
      display_name: p.display_name || p.full_name || p.email || p.phone || "Unknown",
    }));

    res.json({ people });
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

// list items (optionally by org)
app.get("/api/list", async (req, res) => {
  try {
    const org = (req.query.org || process.env.DEFAULT_ORG || "").trim();

    let query = supabase
      .from("items")
      .select(`
        id, created_at, user_id, title, transcript, phone, originator_name, org_slug,
        priority_rank, action_tier, leader_to_unblock, customer_impact, team_energy, frequency, ease
      `)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (org) query = query.eq("org_slug", org);

    const { data, error } = await query;
    if (error) throw error;

    const items = (data || []).map(row => ({ ...row, title: safeTitle(row) }));
    res.json({ items });
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

// create item
app.post("/items/new", async (req, res) => {
  try {
    const body = req.body || {};
    const row = {
      org_slug: (body.org_slug || process.env.DEFAULT_ORG || null),
      originator_name: body.originator_name || null,
      phone: body.phone || null,
      transcript: body.transcript || null,
      title: (body.title || "").trim() || null,
    };

    const { data, error } = await supabase
      .from("items")
      .insert(row)
      .select("id")
      .single();

    if (error) throw error;

    res.json({ ok: true, id: data.id });
  } catch (err) {
    console.error("POST /items/new error:", err);
    res.status(500).json({ error: "create_failed" });
  }
});

// update scoring factors
app.post("/items/:id/factors", async (req, res) => {
  try {
    const id = req.params.id;
    const b = req.body || {};
    const update = {
      customer_impact: clamp10(b.customer_impact),
      team_energy: clamp10(b.team_energy),
      frequency: clamp10(b.frequency),
      ease: clamp10(b.ease),
      priority_rank: Number.isFinite(+b.priority_rank) ? +b.priority_rank : null,
      action_tier: b.action_tier ?? null,
      leader_to_unblock: !!b.leader_to_unblock,
    };

    const { error } = await supabase.from("items").update(update).eq("id", id);
    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /items/:id/factors error:", err);
    res.status(500).json({ error: "factors_failed" });
  }
});

app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
