// Minimal Express backend for Render + Supabase (HTTP)
// CommonJS. Handles CORS and robust list/people endpoints.

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY; // service_role key
const DEFAULT_ORG = (process.env.DEFAULT_ORG || "").trim();
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "").trim(); // e.g. https://felma-ui.onrender.com

if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY env.");
  process.exit(1);
}

const app = express();
app.use(express.json());

// CORS: single origin recommended in Render env (no commas)
app.use(
  cors({
    origin: CORS_ORIGIN || true, // mirror origin if not set
    credentials: false,
  })
);

const supabase = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false },
  global: { headers: { "X-Client-Info": "felma-backend" } },
});

// title fallback
function safeTitle(row) {
  const t = (row.title || "").trim();
  if (t) return t.slice(0, 80);
  const tr = (row.transcript || "").replace(/\s+/g, " ").trim();
  return tr ? tr.slice(0, 80) : "(untitled)";
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/people", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,phone,full_name,display_name")
      .order("full_name", { ascending: true });

    if (error) throw error;

    const people = (data || []).map((p) => ({
      id: p.id,
      email: p.email,
      phone: p.phone || null,
      full_name: p.full_name || null,
      display_name:
        p.display_name || p.full_name || (p.email ? p.email.split("@")[0] : "Unknown"),
    }));

    res.json({ people });
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

app.get("/api/list", async (req, res) => {
  try {
    const org = (req.query.org || DEFAULT_ORG || "").trim();

    // Fetch items (only columns we know exist in your DB)
    let q = supabase
      .from("items")
      .select(
        "id,created_at,user_id,title,transcript,priority_rank,action_title,leader_to_unlock,org_slug"
      );

    if (org) q = q.eq("org_slug", org);
    q = q.order("priority_rank", { ascending: false, nullsLast: true })
         .order("created_at", { ascending: false });

    const { data: items, error } = await q;
    if (error) throw error;

    if (!items || items.length === 0) {
      return res.json({ items: [] });
    }

    // Enrich with originator name/phone from profiles
    const ids = [...new Set(items.map((i) => i.user_id).filter(Boolean))];
    const map = new Map();

    if (ids.length) {
      const { data: profs, error: pErr } = await supabase
        .from("profiles")
        .select("id,display_name,full_name,email,phone")
        .in("id", ids);

      if (pErr) throw pErr;

      for (const p of profs || []) {
        map.set(p.id, {
          originator_name:
            p.display_name ||
            p.full_name ||
            (p.email ? p.email.split("@")[0] : "Unknown"),
          phone: p.phone || null,
        });
      }
    }

    const out = items.map((row) => {
      const info = map.get(row.user_id) || {};
      return {
        id: row.id,
        created_at: row.created_at,
        user_id: row.user_id,
        org_slug: row.org_slug || org || null,
        priority_rank: row.priority_rank ?? null,
        action_title: row.action_title ?? null,
        leader_to_unlock: row.leader_to_unlock ?? null,
        title: safeTitle(row),
        transcript: row.transcript || null,
        originator_name: info.originator_name || null,
        phone: info.phone || null,
      };
    });

    res.json({ items: out });
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
