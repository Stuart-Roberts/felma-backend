// Minimal Express backend (Render) using Supabase HTTP client
// Keeps all routes and avoids direct Postgres TCP (no ENETUNREACH)

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;

// ── CORS ───────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

const allowedOrigin = process.env.CORS_ORIGIN?.trim();
app.use(
  cors({
    origin: allowedOrigin || false, // false = no CORS; set CORS_ORIGIN in Render
    credentials: false
  })
);

// ── Supabase client (use SERVICE ROLE if you have RLS anywhere) ───────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.SUPABASE_KEY; // service role preferred

if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY env vars!");
}

const sb = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false }
});

// ── Helpers ───────────────────────────────────────────────────────────────────
const TABLE = process.env.TABLE_NAME || "items";
const DEFAULT_ORG = process.env.DEFAULT_ORG || "stmichaels";

function safeTitle(title, transcript) {
  const t = (title || "").trim();
  if (t.length > 0) return t;
  const body = (transcript || "").trim();
  if (body.length === 0) return "(untitled)";
  // collapse whitespace and cap at 80 chars
  return body.replace(/\s+/g, " ").slice(0, 80);
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/list", async (req, res) => {
  try {
    const org = (req.query.org || DEFAULT_ORG || "").trim();

    let q = sb
      .from(TABLE)
      .select(
        `
        id, created_at, user_id, phone, originator_name,
        title, transcript, org_slug,
        priority_rank, action_tier, leader_to_unblock,
        customer_impact, team_energy, frequency, ease
      `
      );

    if (org) q = q.eq("org_slug", org);

    // Order: higher rank first, newest first; nulls last
    q = q.order("priority_rank", { ascending: false, nullsFirst: false })
         .order("created_at", { ascending: false });

    const { data, error } = await q;
    if (error) throw error;

    const items = (data || []).map((r) => ({
      ...r,
      title: safeTitle(r.title, r.transcript)
    }));

    res.json({ items });
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

app.get("/api/people", async (_req, res) => {
  try {
    const { data, error } = await sb
      .from("profiles")
      .select("id, display_name, full_name, is_leader, org_slug, phone, email");
    if (error) throw error;

    const people = (data || []).map((p) => ({
      id: p.id,
      org_slug: p.org_slug || null,
      is_leader: !!p.is_leader,
      display_name: p.display_name || p.full_name || p.phone || "Unknown",
      email: p.email || null,
      phone: p.phone || null
    }));

    res.json({ people });
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

app.post("/items/new", async (req, res) => {
  try {
    const {
      org = DEFAULT_ORG,
      user_id = null,
      phone = null,
      originator_name = null,
      transcript = "",
      title = ""
    } = req.body || {};

    const finalTitle = safeTitle(title, transcript);

    const payload = {
      org_slug: org,
      user_id,
      phone,
      originator_name,
      transcript: transcript || null,
      title: finalTitle
    };

    const { data, error } = await sb.from(TABLE).insert(payload).select("id").single();
    if (error) throw error;

    res.json({ ok: true, id: data.id });
  } catch (err) {
    console.error("POST /items/new error:", err);
    res.status(500).json({ error: "create_failed" });
  }
});

app.post("/items/:id/factors", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      customer_impact = null,
      team_energy = null,
      frequency = null,
      ease = null,
      priority_rank = null,
      action_tier = null,
      leader_to_unblock = null
    } = req.body || {};

    const update = {
      customer_impact,
      team_energy,
      frequency,
      ease,
      priority_rank,
      action_tier,
      leader_to_unblock
    };

    const { error } = await sb.from(TABLE).update(update).eq("id", id);
    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /items/:id/factors error:", err);
    res.status(500).json({ error: "factors_failed" });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
