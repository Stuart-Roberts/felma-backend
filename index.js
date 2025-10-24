// felma-backend/index.js
// CommonJS backend for Render + Supabase (via HTTP).
// Endpoints: /api/health, /api/people, /api/list
// ENV required: SUPABASE_URL, ADMIN_KEY
// Optional: CORS_ORIGIN (single origin), DEFAULT_ORG (e.g. "stmichaels")

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

// ---------- CORS (strict but safe) ----------
const ALLOW_ORIGIN = (process.env.CORS_ORIGIN || "").trim();
app.use(
  cors({
    origin(origin, cb) {
      // allow same-origin / curl / server-to-server (no origin)
      if (!ALLOW_ORIGIN || !origin) return cb(null, true);
      if (origin === ALLOW_ORIGIN) return cb(null, true);
      return cb(new Error("CORS: origin not allowed"), false);
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ---------- Body ----------
app.use(express.json({ limit: "1mb" }));

// ---------- Supabase ----------
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY; // service_role

if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error(
    "Missing SUPABASE_URL or ADMIN_KEY env. Set these in Render → Environment."
  );
}

const supabase = createClient(SUPABASE_URL || "", ADMIN_KEY || "", {
  auth: { persistSession: false },
  global: { headers: { "x-application-name": "felma-backend" } },
});

// ---------- Helpers ----------
function safeTitle({ title, transcript }) {
  const t = (title || "").trim();
  if (t) return t;
  const snip = (transcript || "").replace(/\s+/g, " ").trim().slice(0, 80);
  return snip || "(untitled)";
}

// ---------- Routes ----------
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "felma-backend",
    time: new Date().toISOString(),
  });
});

// People: from public.profiles
app.get("/api/people", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      // only columns we know exist in your screenshots
      .select("id, display_name, full_name, email, phone");

    if (error) throw error;

    const people = (data || []).map((p) => ({
      id: p.id,
      display_name: p.display_name || null,
      full_name: p.full_name || null,
      email: p.email || null,
      phone: p.phone || null,
    }));

    res.json({ ok: true, people });
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

// Items list for an org: fetch items, then fetch related people and merge
app.get("/api/list", async (req, res) => {
  const org = (req.query.org || process.env.DEFAULT_ORG || "stmichaels").trim();

  try {
    // 1) Fetch items. Use "*" to avoid column-name mismatches.
    //    Order safely by created_at (exists on your table).
    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("*")
      .eq("org_slug", org)
      .order("created_at", { ascending: false });

    if (itemsErr) throw itemsErr;

    // 2) Build set of user_ids and fetch matching profiles
    const ids = [...new Set((items || []).map((i) => i.user_id).filter(Boolean))];

    let peopleMap = new Map();
    if (ids.length) {
      const { data: ppl, error: pplErr } = await supabase
        .from("profiles")
        .select("id, display_name, phone")
        .in("id", ids);

      if (pplErr) throw pplErr;
      peopleMap = new Map((ppl || []).map((p) => [p.id, p]));
    }

    // 3) Build response rows with safe title + merged person fields
    const rows = (items || []).map((i) => {
      const person = peopleMap.get(i.user_id) || {};
      return {
        id: i.id,
        created_at: i.created_at,
        user_id: i.user_id || null,
        org_slug: i.org_slug || org,
        title: safeTitle({ title: i.title, transcript: i.transcript }),
        transcript: i.transcript || null,
        priority_rank: i.priority_rank ?? null, // may or may not exist in your schema
        action_tier: i.action_tier ?? null,     // may or may not exist in your schema
        leader_to_unlock: i.leader_to_unlock ?? null,
        originator_name: person.display_name || null,
        phone: person.phone || null,
      };
    });

    res.json({ ok: true, rows });
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
