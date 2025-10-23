// felma-backend/index.js  (CommonJS)

// Force IPv4 first to avoid ENETUNREACH on some hosts
const dns = require("dns");
if (dns.setDefaultResultOrder) dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const PORT = process.env.PORT || 10000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const DEFAULT_ORG = process.env.DEFAULT_ORG || "stmichaels";
const DATABASE_URL = process.env.DATABASE_URL; // must be set in Render

// Pool with SSL (Supabase requires it)
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

// --- helpers ---
const tidy = (s) => (s || "").toString().trim().replace(/\s+/g, " ");
const deriveTitle = (row) => {
  const t = tidy(row.title);
  if (t) return t;
  const tr = tidy(row.transcript);
  if (tr) return tr.slice(0, 80);
  return "(untitled)";
};
const safeInt = (v) => (Number.isFinite(+v) ? Math.max(0, Math.min(10, +v)) : null);

// --- routes ---
app.get("/api/health", (req, res) => res.json({ ok: true }));

// People (for pills / display names)
app.get("/api/people", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select id, email, phone, display_name, full_name, is_leader, org_slug
       from public.profiles
       order by display_name nulls last, full_name nulls last, email`
    );
    res.json({ people: rows });
  } catch (err) {
    console.error("people_failed:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

// Items list (filter by org; return computed title & originator name)
app.get("/api/list", async (req, res) => {
  const org = (req.query.org || DEFAULT_ORG).toString().trim();
  try {
    const { rows } = await pool.query(
      `
      select
        i.id, i.created_at, i.user_id, i.title, i.transcript,
        i.priority_rank, i.action_tier, i.leader_to_unblock,
        i.customer_impact, i.team_energy, i.frequency, i.ease,
        i.org_slug,
        p.display_name, p.full_name, p.phone as profile_phone, p.email as profile_email
      from public.items i
      left join public.profiles p
        on (p.phone = i.user_id::text OR p.email = i.user_id::text)
      where ($1::text is null or i.org_slug = $1)
      order by coalesce(i.priority_rank,0) desc, i.created_at desc
      limit 500
      `,
      [org || null]
    );

    const items = rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      user_id: r.user_id,
      org_slug: r.org_slug,
      title: deriveTitle(r),
      transcript: r.transcript, // optional for drawer
      priority_rank: r.priority_rank,
      action_tier: r.action_tier,
      leader_to_unblock: r.leader_to_unblock,
      customer_impact: r.customer_impact,
      team_energy: r.team_energy,
      frequency: r.frequency,
      ease: r.ease,
      // originator shown by UI
      originator_name: r.display_name || r.full_name || r.user_id || r.profile_phone || r.profile_email || "",
    }));

    res.json({ items });
  } catch (err) {
    console.error("list_failed:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

// Create item
app.post("/items/new", async (req, res) => {
  try {
    const {
      title,
      transcript,
      org_slug,
      user_id,
      customer_impact,
      team_energy,
      frequency,
      ease,
      action_tier,
      leader_to_unblock,
    } = req.body || {};

    const org = tidy(org_slug) || DEFAULT_ORG;
    const t = tidy(title);
    const tr = tidy(transcript);

    // fallback title generation (same as trigger logic)
    const finalTitle = t || (tr ? tr.slice(0, 80) : "(untitled)");

    const { rows } = await pool.query(
      `
      insert into public.items
        (title, transcript, org_slug, user_id,
         customer_impact, team_energy, frequency, ease,
         action_tier, leader_to_unblock)
      values
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      returning id, created_at
      `,
      [
        finalTitle,
        tr || null,
        org,
        user_id || null,
        safeInt(customer_impact),
        safeInt(team_energy),
        safeInt(frequency),
        safeInt(ease),
        tidy(action_tier) || null,
        !!leader_to_unblock,
      ]
    );

    res.json({ ok: true, id: rows[0].id, created_at: rows[0].created_at });
  } catch (err) {
    console.error("new_item_failed:", err);
    res.status(500).json({ error: "new_item_failed" });
  }
});

// Save factors (4 sliders) and recompute simple rank
app.post("/items/:id/factors", async (req, res) => {
  try {
    const id = req.params.id;
    const ci = safeInt(req.body.customer_impact);
    const te = safeInt(req.body.team_energy);
    const fr = safeInt(req.body.frequency);
    const ez = safeInt(req.body.ease);
    const leader_to_unblock = !!req.body.leader_to_unblock;
    const action_tier = tidy(req.body.action_tier) || null;

    // simple sum rank (adjust later if you want a different formula)
    const rank =
      (ci ?? 0) + (te ?? 0) + (fr ?? 0) + (ez ?? 0);

    await pool.query(
      `
      update public.items
      set customer_impact = $2,
          team_energy     = $3,
          frequency       = $4,
          ease            = $5,
          priority_rank   = $6,
          action_tier     = $7,
          leader_to_unblock = $8
      where id = $1
      `,
      [id, ci, te, fr, ez, rank, action_tier, leader_to_unblock]
    );

    res.json({ ok: true, priority_rank: rank });
  } catch (err) {
    console.error("save_factors_failed:", err);
    res.status(500).json({ error: "save_factors_failed" });
  }
});

// -------------------------------------------------
app.listen(PORT, () => {
  console.log(">>> felma-backend running on", PORT);
});
