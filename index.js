// Minimal, robust Express backend for Render + Supabase (postgres)
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

// ---------- Config ----------
const PORT = process.env.PORT || 10000;

// Required envs
const DATABASE_URL = process.env.DATABASE_URL; // Supabase > Project Settings > Database > Connection string (Node.js)
if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL env var.");
  process.exit(1);
}

// Optional envs
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const DEFAULT_ORG = (process.env.DEFAULT_ORG || "").trim() || null;

// Force IPv4 preference if Render resolves IPv6 first
// (You can also set NODE_OPTIONS=--dns-result-order=ipv4first in Render)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // accept Supabase SSL

// ---------- App ----------
const app = express();
app.use(express.json());

// CORS (single origin string)
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: false,
  })
);

// ---------- Database ----------
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // With Supabase pgBouncer connection string this is fine.
});

// Utility: safe title fallback from transcript if title missing/empty
function makeSafeTitle(title, transcript) {
  const base = (title || "").trim();
  if (base) return base.slice(0, 80);
  const t = (transcript || "").trim();
  if (!t) return "(untitled)";
  // Take the first sentence or up to 80 chars
  let s = t.replace(/\s+/g, " ").replace(/^[-–•]+/, "").trim();
  return s.slice(0, 80);
}

// ---------- Routes ----------

app.get("/api/health", async (_req, res) => {
  try {
    const r = await pool.query("select 1;");
    res.json({ ok: true, db: r.rows[0]["?column?" ] || 1 });
  } catch (err) {
    console.error("health error:", err);
    res.status(500).json({ ok: false, error: "db_unreachable" });
  }
});

// List items for org (defaults to DEFAULT_ORG if provided)
app.get("/api/list", async (req, res) => {
  const org = (req.query.org || DEFAULT_ORG || "").trim();
  const where = org ? "where coalesce(org_slug,'') = $1" : "";
  const params = org ? [org] : [];

  const sql = `
    select
      id, created_at, user_id, title, transcript,
      phone, originator_name,
      priority_rank, action_tier, leader_to_unblock,
      customer_impact, team_energy, frequency, ease,
      coalesce(org_slug,'') as org_slug
    from public.items
    ${where}
    order by coalesce(priority_rank, 0) desc, created_at desc
    limit 500;
  `;

  try {
    const { rows } = await pool.query(sql, params);
    const items = rows.map(r => ({
      ...r,
      // ensure title is always present
      title: makeSafeTitle(r.title, r.transcript),
    }));
    res.json({ items });
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

// People directory for pills, names, leader flag
app.get("/api/people", async (_req, res) => {
  const sql = `
    select id, email, phone, full_name, display_name,
           coalesce(is_leader, false) as is_leader,
           coalesce(org_slug,'') as org_slug
    from public.profiles
    order by display_name nulls last, full_name nulls last;
  `;
  try {
    const { rows } = await pool.query(sql);
    const people = rows.map(p => ({
      id: p.id,
      email: p.email,
      phone: p.phone || "",
      full_name: p.full_name || "",
      display_name: p.display_name || p.full_name || "",
      is_leader: !!p.is_leader,
      org_slug: p.org_slug || "",
    }));
    res.json({ people });
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

// Create new item
app.post("/items/new", async (req, res) => {
  try {
    const {
      org_slug,
      user_id,
      phone,
      originator_name,
      title,
      transcript,
    } = req.body || {};

    const safetitle = makeSafeTitle(title, transcript);

    const sql = `
      insert into public.items
        (org_slug, user_id, phone, originator_name, title, transcript)
      values ($1, $2, $3, $4, $5, $6)
      returning id, created_at;
    `;
    const { rows } = await pool.query(sql, [
      (org_slug || DEFAULT_ORG || "").trim(),
      user_id || null,
      phone || null,
      originator_name || null,
      safetitle,
      transcript || null,
    ]);

    res.json({ ok: true, id: rows[0].id, created_at: rows[0].created_at });
  } catch (err) {
    console.error("POST /items/new error:", err);
    res.status(500).json({ error: "new_failed" });
  }
});

// Update rating factors + tier/leader flags
app.post("/items/:id/factors", async (req, res) => {
  try {
    const id = req.params.id;
    const {
      customer_impact,
      team_energy,
      frequency,
      ease,
      action_tier,
      leader_to_unblock,
      priority_rank, // optional precomputed
    } = req.body || {};

    // If rank not provided, recompute a simple ICE-like score
    const rank =
      typeof priority_rank === "number" && !isNaN(priority_rank)
        ? priority_rank
        : (Number(customer_impact || 0) +
           Number(team_energy || 0) +
           Number(frequency || 0) +
           Number(ease || 0));

    const sql = `
      update public.items
      set customer_impact = $1,
          team_energy = $2,
          frequency = $3,
          ease = $4,
          action_tier = $5,
          leader_to_unblock = $6,
          priority_rank = $7
      where id = $8
      returning id;
    `;

    const { rows } = await pool.query(sql, [
      customer_impact ?? null,
      team_energy ?? null,
      frequency ?? null,
      ease ?? null,
      action_tier ?? null,
      !!leader_to_unblock,
      rank,
      id,
    ]);

    if (!rows.length) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, id });
  } catch (err) {
    console.error("POST /items/:id/factors error:", err);
    res.status(500).json({ error: "factors_failed" });
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`✅ felma-backend running on ${PORT}`);
});
