// CommonJS backend for Render + Supabase (postgres)
// Minimal, safe CORS and robust title fallback.

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

// CORS: permissive for now to avoid invalid header values
app.use(cors());
app.use(express.json());

// ---- Database pool ----
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL env var");
}
const pool = new Pool({
  connectionString: DATABASE_URL,            // include ?sslmode=require in the value
  max: 4,
  ssl: { rejectUnauthorized: false }         // fine for Supabase
});

// Utility: safe title from transcript
function ensureTitle(row) {
  const t = (row.title && row.title.trim())
    ? row.title.trim()
    : (row.transcript && row.transcript.trim()
        ? row.transcript.trim().replace(/\s+/g, " ").slice(0, 80)
        : "(untitled)");
  return { ...row, title: t };
}

// ---- Routes ----
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/list", async (req, res) => {
  try {
    const org = req.query.org || null;
    const params = [];
    let where = "";
    if (org) { params.push(org); where = "where coalesce(org_slug, $1) = $1"; }

    const q = `
      select id, created_at, user_id, title, transcript, phone, originator_name,
             priority_rank, action_tier, leader_to_unblock,
             customer_impact, team_energy, frequency, ease, org_slug
      from public.items
      ${where}
      order by coalesce(priority_rank, 0) desc, created_at desc
    `;
    const { rows } = await pool.query(q, params);
    res.json({ items: rows.map(ensureTitle) });
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

app.get("/api/people", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      select id, email, phone, display_name, full_name, is_leader, org_slug
      from public.profiles
    `);
    const people = rows.map(p => ({
      id: p.id,
      email: p.email,
      phone: p.phone,
      org_slug: p.org_slug,
      display_name: p.display_name || p.full_name || p.email || p.phone || "Unknown",
      is_leader: !!p.is_leader,
    }));
    res.json({ people });
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

app.post("/items/new", async (req, res) => {
  try {
    const { org_slug, user_id, phone, originator_name, transcript, title } = req.body || {};
    const safeTitle = (title && title.trim())
      ? title.trim()
      : (transcript ? transcript.trim().replace(/\s+/g, " ").slice(0, 80) : "(untitled)");

    const { rows } = await pool.query(
      `insert into public.items (org_slug, user_id, phone, originator_name, transcript, title)
       values ($1,$2,$3,$4,$5,$6)
       returning id`,
      [org_slug || null, user_id || null, phone || null, originator_name || null, transcript || null, safeTitle]
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    console.error("POST /items/new error:", err);
    res.status(500).json({ error: "create_failed" });
  }
});

app.post("/items/:id/factors", async (req, res) => {
  try {
    const id = req.params.id;
    const {
      customer_impact, team_energy, frequency, ease,
      priority_rank, action_tier, leader_to_unblock
    } = req.body || {};

    await pool.query(
      `update public.items set
         customer_impact = $1, team_energy = $2, frequency = $3, ease = $4,
         priority_rank = $5, action_tier = $6, leader_to_unblock = $7
       where id = $8`,
      [
        customer_impact ?? null, team_energy ?? null, frequency ?? null, ease ?? null,
        priority_rank ?? null, action_tier ?? null, leader_to_unblock ?? false, id
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /items/:id/factors error:", err);
    res.status(500).json({ error: "factors_failed" });
  }
});

app.listen(PORT, () => {
  console.log("felma-backend running on", PORT);
});
