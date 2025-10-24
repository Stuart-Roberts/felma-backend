// Minimal Express + Supabase REST backend (no direct Postgres driver)

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;

// ---- CORS (single origin if provided, else allow all for now)
const app = express();
app.use(express.json());
app.use(
  cors({
    origin: (origin, cb) => {
      const allow = process.env.CORS_ORIGIN || "*";
      if (allow === "*" || !origin) return cb(null, true);
      return cb(null, origin === allow);
    },
  })
);

// ---- Supabase (HTTP)
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY env var.");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, ADMIN_KEY, { auth: { persistSession: false } });

// ---- tiny helpers
const safeTitle = (row) => {
  const t = (row.title || "").toString().trim();
  if (t) return t;
  const tr = (row.transcript || "").toString().trim();
  if (tr) return tr.slice(0, 80);
  return "(untitled)";
};
const val = (x, fallback = null) => (x === undefined || x === null ? fallback : x);

// ---- routes
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// People: only use columns we know exist from your screenshot
app.get("/api/people", async (req, res) => {
  try {
    // ask for superset of likely existing columns; Supabase ignores unknown in select,
    // but we’ll stick to ones you showed: id, uuid, email, phone, full_name, display_name
    const { data, error } = await sb
      .from("profiles")
      .select("id, uuid, email, phone, full_name, display_name")
      .limit(500);

    if (error) throw error;

    const people = (data || []).map((p) => {
      // Prefer uuid, then id
      const pid = p.uuid || p.id || null;
      const display =
        p.display_name ||
        p.full_name ||
        (p.email ? p.email.split("@")[0] : null) ||
        "Unknown";

      return {
        id: pid,
        display_name: display,
        full_name: val(p.full_name, null),
        email: val(p.email, null),
        phone: val(p.phone, null),
      };
    });

    res.json({ people });
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

// Items list: request only safe columns; filter by org when provided
app.get("/api/list", async (req, res) => {
  try {
    const org = (req.query.org || process.env.DEFAULT_ORG || "").trim() || null;

    // Only ask for columns that can’t bite us. Your UI needs a title + (optionally) originator_name.
    // We’ll request commonly present fields; if some are missing, Supabase won’t error just for selecting,
    // but referencing bogus names would — so keep the list conservative.
    const baseCols = [
      "id",
      "created_at",
      "org_slug",
      "user_id",
      "title",
      "originator_name",
      "transcript",
    ].join(", ");

    let q = sb.from("items").select(baseCols).order("created_at", { ascending: false }).limit(500);
    if (org) q = q.eq("org_slug", org);

    const { data, error } = await q;
    if (error) throw error;

    const items = (data || []).map((row) => ({
      id: row.id,
      created_at: row.created_at,
      org_slug: row.org_slug || null,
      user_id: row.user_id || null,
      title: safeTitle(row),
      originator_name: val(row.originator_name, null),
      transcript: val(row.transcript, null),
    }));

    res.json({ items });
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

// (Optional) single item create endpoint the UI might call later.
// This version only requires org_slug + transcript/title + optional originator_name.
app.post("/api/items/new", async (req, res) => {
  try {
    const { org_slug, transcript, title, originator_name } = req.body || {};
    if (!org_slug || (!title && !transcript)) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const toInsert = {
      org_slug,
      title: (title || "").toString().trim() || null,
      transcript: (transcript || "").toString().trim() || null,
      originator_name: (originator_name || "").toString().trim() || null,
    };

    const { data, error } = await sb.from("items").insert(toInsert).select("id").single();
    if (error) throw error;

    res.json({ ok: true, id: data.id });
  } catch (err) {
    console.error("POST /api/items/new error:", err);
    res.status(500).json({ error: "create_failed" });
  }
});

app.listen(PORT, () => console.log(`felma-backend running on ${PORT}`));
