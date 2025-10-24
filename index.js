// Minimal, robust backend for Render + Supabase (no direct Postgres).
// Express + CORS and Supabase HTTP client only.

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

// ---------- CORS (single origin if provided) ----------
const corsOrigin = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN.trim();
const corsOptions = corsOrigin ? { origin: corsOrigin } : {};
app.use(cors(corsOptions));
app.use(express.json());

// ---------- Supabase ----------
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY; // service_role key

if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY env var!");
}

const sb = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false }
});

// ---------- helpers ----------
function safeTitleFrom(transcript, title) {
  const t = (title || "").trim();
  if (t) return t.slice(0, 80);
  const s = (transcript || "").trim().replace(/\s+/g, " ");
  if (!s) return "(untitled)";
  return s.slice(0, 80);
}

function pick(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return null;
}

// ---------- routes ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get("/api/people", async (_req, res) => {
  try {
    const { data, error } = await sb
      .from("profiles")
      .select("id, email, phone, full_name, display_name")
      .order("full_name", { ascending: true });

    if (error) throw error;

    const people = (data || []).map((p) => ({
      id: p.id,
      email: p.email,
      phone: p.phone || null,
      full_name: p.full_name || null,
      display_name: p.display_name || p.full_name || null
    }));

    res.json(people);
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

app.get("/api/list", async (req, res) => {
  const org = (req.query.org || process.env.DEFAULT_ORG || "").trim();

  try {
    // Pull the rows *without* any join/cast. We’ll shape on the server.
    const { data, error } = await sb
      .from("items")
      .select("*")
      .match(org ? { org_slug: org } : {})
      .order("priority_rank", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) throw error;

    const items = (data || []).map((row) => {
      // tolerate different historical column names
      const tier = pick(row.action_tier, row.tier);
      const rank = pick(row.priority_rank, row.rank);
      const leader_to_unlock = pick(row.leader_to_unlock, row.leader_unlock);
      const name = pick(row.originator_name, row.display_name, row.full_name, row.originator);

      return {
        id: row.id,
        created_at: row.created_at,
        org_slug: row.org_slug || org || null,
        title: safeTitleFrom(row.transcript, row.title),
        originator_name: name,
        action_tier: tier,
        priority_rank: rank,
        frequency: row.frequency ?? null,
        ease: row.ease ?? null,
        leader_to_unlock,
        // keep some raw fields the UI might still use
        transcript: row.transcript || null,
        user_id: row.user_id || null,
        originator: row.originator || null
      };
    });

    res.json(items);
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

// ---------- start ----------
app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
