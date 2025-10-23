// index.js — CommonJS backend for Felma
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// ---- DB ---------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function q(sql, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    client.release();
  }
}

// Helper: produce a safe title (server-side fallback)
const SAFE_TITLE_SQL = `
COALESCE(
  NULLIF(btrim(i.title), ''),
  COALESCE(
    NULLIF(LEFT(regexp_replace(btrim(COALESCE(i.transcript, '')), '\\s+', ' ', 'g'), 80), ''),
    '(untitled)'
  )
) AS title
`;

// ---- Routes -----------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// People list for mapping phone -> display_name (names in UI)
app.get('/api/people', async (req, res) => {
  try {
    const rows = await q(
      `SELECT id, email, phone, display_name, is_leader, org_slug
         FROM public.profiles
        ORDER BY display_name NULLS LAST, email NULLS LAST;`
    );
    res.json({ people: rows });
  } catch (err) {
    console.error('GET /api/people error:', err);
    res.status(500).json({ error: err.message || 'people_failed' });
  }
});

// Main list (optionally filter by org)
app.get('/api/list', async (req, res) => {
  const org = (req.query.org || '').trim() || null;

  const params = [];
  const where = [];
  if (org) {
    params.push(org);
    where.push(`i.org_slug = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT
      i.id,
      i.created_at,
      ${SAFE_TITLE_SQL},
      i.priority_rank,
      i.action_tier,
      i.leader_to_unblock,
      i.customer_impact, i.team_energy, i.frequency, i.ease,
      i.org_slug,
      i."user" AS phone,
      p.display_name
    FROM public.items i
    LEFT JOIN public.profiles p
      ON p.phone = i."user"
    ${whereSql}
    ORDER BY i.priority_rank DESC NULLS LAST, i.created_at DESC
    LIMIT 500;
  `;

  try {
    const rows = await q(sql, params);
    res.json({ items: rows });
  } catch (err) {
    console.error('GET /api/list error:', err);
    res.status(500).json({ error: err.message || 'list_failed' });
  }
});

// Create a new item
app.post('/items/new', async (req, res) => {
  try {
    const {
      title = '',
      transcript = '',
      phone = null,          // originator phone (for now)
      org = null,            // org_slug
      customer_impact = null,
      team_energy = null,
      frequency = null,
      ease = null,
    } = req.body || {};

    const rows = await q(
      `
      INSERT INTO public.items
        (title, transcript, "user", org_slug, customer_impact, team_energy, frequency, ease)
      VALUES
        (
          COALESCE(
            NULLIF($1, ''),
            COALESCE(
              NULLIF(LEFT(regexp_replace(btrim(COALESCE($2, '')), '\\s+', ' ', 'g'), 80), ''),
              '(untitled)'
            )
          ),
          $2, $3, $4, $5, $6, $7, $8
        )
      RETURNING id;
      `,
      [title, transcript, phone, org, customer_impact, team_energy, frequency, ease]
    );

    res.json({ ok: true, id: rows[0]?.id });
  } catch (err) {
    console.error('POST /items/new error:', err);
    res.status(500).json({ error: err.message || 'create_failed' });
  }
});

// Update the 4 rating factors (and optionally action flags)
app.post('/items/:id/factors', async (req, res) => {
  const id = req.params.id;
  const {
    customer_impact = null,
    team_energy = null,
    frequency = null,
    ease = null,
    action_tier = null,       // optional
    leader_to_unblock = null  // optional
  } = req.body || {};

  // Build dynamic update with only provided fields
  const sets = [];
  const params = [];
  function add(column, value) {
    if (value !== null && value !== undefined) {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    }
  }
  add('customer_impact', customer_impact);
  add('team_energy', team_energy);
  add('frequency', frequency);
  add('ease', ease);
  add('action_tier', action_tier);
  add('leader_to_unblock', leader_to_unblock);

  if (sets.length === 0) {
    return res.json({ ok: true, id }); // nothing to update
  }

  params.push(id);

  const sql = `
    UPDATE public.items
       SET ${sets.join(', ')}
     WHERE id = $${params.length}
     RETURNING id, customer_impact, team_energy, frequency, ease, priority_rank, action_tier, leader_to_unblock;
  `;

  try {
    const rows = await q(sql, params);
    res.json({ ok: true, item: rows[0] });
  } catch (err) {
    console.error('POST /items/:id/factors error:', err);
    res.status(500).json({ error: err.message || 'update_failed' });
  }
});

// Root
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'felma-backend' });
});

// ---- Start ------------------------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`felma-backend running on :${PORT}`);
});
