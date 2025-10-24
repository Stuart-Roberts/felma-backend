// CommonJS backend for Render + Supabase (HTTP client)
// Minimal, safe CORS and robust list/people endpoints.

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

// ---- CORS (single origin is best) ----
const ALLOWED_ORIGIN = (process.env.CORS_ORIGIN || "").trim();
app.use(
  cors({
    origin(origin, cb) {
      if (!ALLOWED_ORIGIN) return cb(null, true); // allow all if not set
      if (!origin) return cb(null, true);
      cb(null, origin === ALLOWED_ORIGIN);
    },
    credentials: true,
  })
);
app.use(express.json());

// ---- Supabase client (HTTP) ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY env var!");
}
const sb = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false },
});

// ---- tiny helpers ----
const DEFAULT_ORG = (process.env.DEFAULT_ORG || "").trim() || null;

function safeTitle(row) {
  const raw =
    (row.title && String(row.title).trim()) ||
    (row.transcript && String(row.transcript).trim()) ||
    "";
  if (raw) return raw.slice(0, 80);
  return "(untitled)";
}

function shapeItem(row) {
  return {
    id: row.id,
    created_at: row.created_at,
    org_slug: row.org_slug || row.org || null,
    user_id: row.user_id || null,
    originator_name: row.originator_name || null,
    // keep useful extra fields if present
    action_tier: row.action_tier ?? null,
    priority_rank: row.priority_rank ?? null,
    ease: row.ease ?? null,
    frequency: row.frequency ?? null,
    leader_to_unlock: row.leader_to_unlock ?? null,
    // title fallback
    title: safeTitle(row),
    transcript: row.transcript ?? null,
  };
}

async function fetchItems(org) {
  // Query the public.items table; select the fields we need
  const query = sb
    .from("items")
    .select(
      "id, created_at, org_slug, user_id, originator_name, title, transcript, action_tier, priority_rank, ease, frequency, leader_to_unlock"
    )
    .order("created_at", { ascending: false });

  if (org) query.eq("org_slug", org);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map(shapeItem);
}

// ---- routes ----
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// NOTE: The UI likely calls /api/items OR expects { items: [...] }.
// We provide BOTH shapes:
//   • /api/items  -> returns { items: [...] }  (for the UI)
//   • /api/list   -> by default returns { items: [...] }, but if you pass ?flat=1 it returns a bare array for manual testing
app.get("/api/items", async (req, res) => {
  try {
    const org = (req.query.org || DEFAULT_ORG || "").trim() || null;
    const items = await fetchItems(org);
    res.json({ items });
  } catch (err) {
    console.error("GET /api/items error:", err);
    res.status(500).json({ error: "items_failed" });
  }
});

app.get("/api/list", async (req, res) => {
  try {
    const org = (req.query.org || DEFAULT_ORG || "").trim() || null;
    const items = await fetchItems(org);
    if (req.query.flat === "1") {
      // manual/debug shape
      res.json(items);
    } else {
      // UI-friendly shape
      res.json({ items });
    }
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

// People (works for your profiles table)
app.get("/api/people", async (_req, res) => {
  try {
    const { data, error } = await sb
      .from("profiles")
      .select("id, email, phone, full_name, display_name, is_leader, org_slug")
      .order("full_name", { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
