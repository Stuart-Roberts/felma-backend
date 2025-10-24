// CommonJS backend for Render + Supabase (HTTP client only)
// Minimal, safe CORS and robust list/people/factors routes.

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;

// ---- CORS ---------------------------------------------------------------
const ALLOW_ORIGIN = process.env.CORS_ORIGIN || "*";
// IMPORTANT: if you set a specific origin, do NOT comma-separate values.
const corsOptions = {
  origin: ALLOW_ORIGIN,
  credentials: false, // leave false when origin="*"
};
const app = express();
app.use(cors(corsOptions));
app.use(express.json());

// ---- Supabase (HTTP client) ---------------------------------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY; // service_role key
if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY env var.");
}

const sb = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { "x-app": "felma-backend" } },
});

// ---- Helpers -------------------------------------------------------------
const safeTitle = (row) => {
  const t = (row?.title || "").trim();
  if (t) return t;
  const fromTranscript = (row?.transcript || "").trim().replace(/\s+/g, " ");
  if (fromTranscript) return fromTranscript.slice(0, 80);
  return "(untitled)";
};

const toCard = (row) => ({
  id: row.id,
  created_at: row.created_at,
  title: safeTitle(row),
  transcript: row.transcript || null,
  originator_name: row.originator_name || null,
  phone: row.phone || null,
  org_slug: row.org_slug || null,

  // ranking fields (nullable)
  priority_rank: row.priority_rank ?? null,
  action_tier: row.action_tier ?? null,
  leader_to_unblock: row.leader_to_unblock ?? false,
  customer_impact: row.customer_impact ?? null,
  team_energy: row.team_energy ?? null,
  frequency: row.frequency ?? null,
  ease: row.ease ?? null,
});

// ---- Routes --------------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, org: process.env.DEFAULT_ORG || null });
});

app.get("/api/people", async (req, res) => {
  try {
    // profiles table: id, email, phone, full_name, display_name
    const { data, error } = await sb
      .from("profiles")
      .select("id, email, phone, full_name, display_name")
      .order("full_name", { ascending: true });

    if (error) throw error;

    const people = (data || []).map((p) => ({
      id: p.id,
      email: p.email || null,
      phone: p.phone || null,
      full_name: p.full_name || null,
      display_name: p.display_name || p.full_name || null,
    }));

    res.json({ people });
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

app.get("/api/list", async (req, res) => {
  try {
    const org = (req.query.org || process.env.DEFAULT_ORG || "").trim() || null;

    let q = sb
      .from("items")
      .select(
        [
          "id",
          "created_at",
          "user_id",
          "title",
          "transcript",
          "phone",
          "originator_name",
          "priority_rank",
          "action_tier",
          "leader_to_unblock",
          "customer_impact",
          "team_energy",
          "frequency",
          "ease",
          "org_slug",
        ].join(",")
      )
      .order("created_at", { ascending: false });

    if (org) q = q.eq("org_slug", org);

    const { data, error } = await q;
    if (error) throw error;

    const items = (data || []).map(toCard);
    res.json({ items });
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

// Create a new item (title optional; will fall back to transcript)
app.post("/items/new", async (req, res) => {
  try {
    const body = req.body || {};
    const org_slug = (body.org || process.env.DEFAULT_ORG || "").trim() || null;

    const row = {
      org_slug,
      user_id: body.user_id || null,
      originator_name: body.originator_name || null,
      phone: body.phone || null,
      transcript: body.transcript || null,
      title: (body.title || "").trim() || null,
      priority_rank: null,
      action_tier: null,
      leader_to_unblock: false,
      customer_impact: null,
      team_energy: null,
      frequency: null,
      ease: null,
    };

    const { data, error } = await sb.from("items").insert(row).select().single();
    if (error) throw error;

    res.json({ ok: true, item: toCard(data) });
  } catch (err) {
    console.error("POST /items/new error:", err);
    res.status(500).json({ error: "new_failed" });
  }
});

// Save factors + optional computed rank
app.post("/items/:id/factors", async (req, res) => {
  try {
    const id = req.params.id;
    const { customer_impact, team_energy, frequency, ease, leader_to_unblock, action_tier } =
      req.body || {};

    const ci = Number(customer_impact) || null;
    const te = Number(team_energy) || null;
    const fr = Number(frequency) || null;
    const es = Number(ease) || null;

    let priority_rank = null;
    if ([ci, te, fr, es].every((v) => v !== null)) {
      // simple rank calc; replace with your exact formula if you have one
      priority_rank = ci + te + fr + es;
    }

    const updates = {
      customer_impact: ci,
      team_energy: te,
      frequency: fr,
      ease: es,
      leader_to_unblock: !!leader_to_unblock,
      action_tier: action_tier ?? null,
      priority_rank,
    };

    const { data, error } = await sb.from("items").update(updates).eq("id", id).select().single();
    if (error) throw error;

    res.json({ ok: true, item: toCard(data) });
  } catch (err) {
    console.error("POST /items/:id/factors error:", err);
    res.status(500).json({ error: "factors_failed" });
  }
});

app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
