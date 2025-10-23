// Minimal Express + Postgres (via Supabase pg-relay)
// CommonJS, safe CORS, and clear errors.

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

// ---------- CORS ----------
const ORIGIN = process.env.CORS_ORIGIN || "*";
// single value only; cors() accepts string or function
app.use(cors({ origin: ORIGIN }));
app.use(express.json());

// ---------- DB (Postgres via Supabase pg-relay) ----------
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL env var");
  // Keep server up so /api/health still works
}
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL, // use Supabase "Connection string → Node.js"
      ssl: { rejectUnauthorized: false }, // required on Render
    })
  : null;

// ---------- Helpers ----------
function makeSafeTitle(row) {
  // Prefer explicit title; otherwise derive from transcript and trim
  const t = (row.title || "").trim();
  if (t) return t;
  const fromTranscript = (row.transcript || "").trim();
  const clean = fromTranscript.replace(/\s+/g, " ");
  return clean ? clean.slice(0, 80) : "(untitled)";
}

function tidy(row) {
  return {
    id: row.id,
    created_at: row.created_at,
    user_id: row.user_id,
    title: makeSafeTitle(row),
    transcript: row.transcript || null,
    originator_name: row.originator_name || null,
    action_tier: row.action_tier || null,
    leader_to_unblock: row.leader_to_unblock === true,
    customer_impact: row.customer_impact ?? null,
    team_energy: row.team_energy ?? null,
    frequency: row.frequency ?? null,
    ease: row.ease ?? null,
    priority_rank: row.priority_rank ?? null,
    org_slug: row.org_slug || null,
  };
}

// ---------- Routes ----------
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/list", async (req, res) => {
  try {
    if (!pool) throw new Error("no_db_pool");

    // org: query param overrides DEFAULT_ORG; empty string treated as null
    const envOrg = (process.env.DEFAULT_ORG || "").trim() || null;
    const org = (req.query.org || "").trim() || envOrg;

    const where =
      org === null
        ? "" // no org filter
        : "where coalesce(org_slug, $1) = $1";

    const params = org === null ? [] : [org];

    const sql = `
      select
        id, created_at, user_id, title, transcript,
        originator_name, action_tier, leader_to_unblock,
        customer_impact, team_energy, frequency, ease,
        priority_rank, org_slug
      from public.items
      ${where}
      order by coalesce(priority_rank, 0) desc, created_at desc
      limit 500;
    `;

    const { rows } = await pool.query(sql, params);
    res.json({ items: rows.map(tidy) });
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

app.get("/api/people", async (_req, res) => {
  try {
    if (!pool) throw new Error("no_db_pool");

    const sql = `
      select id, display_name, full_name, is_leader, org_slug, email, phone
      from public.profiles
      order by coalesce(display_name, full_name) asc;
    `;
    const { rows } = await pool.query(sql);

    const people = rows.map((p) => ({
      id: p.id,
      display_name: p.display_name || p.full_name || p.email || "Unknown",
      full_name: p.full_name || null,
      email: p.email || null,
      phone: p.phone || null,
      is_leader: p.is_leader === true,
      org_slug: p.org_slug || null,
    }));

    res.json({ people });
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

app.post("/items/new", async (req, res) => {
  try {
    if (!pool) throw new Error("no_db_pool");

    const {
      user_id,
      org_slug,
      originator_name,
      transcript,
      title,
    } = req.body || {};

    const safeTitle = makeSafeTitle({ title, transcript });

    const sql = `
      insert into public.items
        (created_at, user_id, org_slug, originator_name, transcript, title)
      values (now(), $1, $2, $3, $4, $5)
      returning id;
    `;
    const params = [user_id || null, org_slug || null, originator_name || null, transcript || null, safeTitle];

    const { rows } = await pool.query(sql, params);
    res.json({ ok: true, id: rows[0]?.id || null });
  } catch (err) {
    console.error("POST /items/new error:", err);
    res.status(500).json({ error: "new_failed" });
  }
});

app.post("/items/:id/factors", async (req, res) => {
  try {
    if (!pool) throw new Error("no_db_pool");

    const id = req.params.id;
    const {
      customer_impact,
      team_energy,
      frequency,
      ease,
      action_tier,
      leader_to_unblock,
    } = req.body || {};

    const sql = `
      update public.items
      set
        customer_impact = $1,
        team_energy     = $2,
        frequency       = $3,
        ease            = $4,
        action_tier     = $5,
        leader_to_unblock = $6,
        priority_rank   = case
          when $1 is null or $2 is null or $3 is null or $4 is null then null
          else ($1 * $3 * 1.0) + ($2 * 0.5) + ($4 * 0.5)
        end
      where id = $7
      returning id, priority_rank;
    `;
    const params = [
      customer_impact ?? null,
      team_energy ?? null,
      frequency ?? null,
      ease ?? null,
      action_tier ?? null,
      leader_to_unblock === true,
      id,
    ];

    const { rows } = await pool.query(sql, params);
    res.json({ ok: true, id: rows[0]?.id || id, priority_rank: rows[0]?.priority_rank ?? null });
  } catch (err) {
    console.error("POST /items/:id/factors error:", err);
    res.status(500).json({ error: "factors_failed" });
  }
});

// ---------- Boot ----------
app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
