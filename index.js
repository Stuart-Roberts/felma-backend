// Minimal, defensive backend for Render + Supabase (HTTP client)
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 10000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
const DEFAULT_ORG = process.env.DEFAULT_ORG || 'stmichaels';

if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error('Missing SUPABASE_URL or ADMIN_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, ADMIN_KEY);
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: false,
    allowedHeaders: ['Content-Type'],
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    maxAge: 86400,
  })
);

// ---- utilities --------------------------------------------------------------
function coerceNum(x, min = 0, max = 10) {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  if (Number.isNaN(n)) return null;
  return Math.max(min, Math.min(max, n));
}
// Defensive update that drops unknown columns (42703) and retries
async function safeUpdateItem(id, patch) {
  // never send empty payload
  const payload = { ...patch };
  if (Object.keys(payload).length === 0) return { data: null, error: null };

  // 3 attempts max
  for (let i = 0; i < 3; i++) {
    const { data, error } = await supabase.from('items').update(payload).eq('id', id).select('*').limit(1);
    if (!error) return { data: data?.[0] || null, error: null };

    // If unknown column, remove it and retry
    if (error.code === '42703' && /column\s+(\w+)/i.test(error.message || '')) {
      const bad = error.message.match(/column\s+(\w+)/i)[1];
      delete payload[bad];
      continue;
    }
    return { data: null, error };
  }
  return { data: null, error: new Error('update_failed_after_retries') };
}

// ---- routes ----------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// People list (defensive: select only columns we’ve actually seen)
app.get('/api/people', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,full_name,display_name,phone')
      .order('full_name', { ascending: true, nullsFirst: false });

    if (error) throw error;

    const people = (data || []).map((p) => ({
      id: p.id,
      email: p.email || null,
      full_name: p.full_name || null,
      display_name: p.display_name || null,
      phone: p.phone || null,
    }));
    res.json(people);
  } catch (err) {
    console.error('GET /api/people error:', err);
    res.status(500).json({ error: 'people_failed' });
  }
});

// List items (with ordering)
app.get('/api/list', async (req, res) => {
  const org = (req.query.org || DEFAULT_ORG || '').trim() || null;
  const orderParam = String(req.query.order || 'rank_desc').toLowerCase();

  // default order: higher rank first (desc), then newest first
  const byRankAsc = orderParam === 'rank_asc';
  const byRankDesc = orderParam === 'rank_desc';
  const byNewest = orderParam === 'newest';
  const byOldest = orderParam === 'oldest';

  try {
    let q = supabase
      .from('items')
      .select('id,created_at,org_slug,user_id,title,transcript,originator_name,priority_rank,frequency,ease,leader_to_unblock');

    if (org) q = q.eq('org_slug', org);

    // Apply ordering
    if (byNewest) {
      q = q.order('created_at', { ascending: false });
    } else if (byOldest) {
      q = q.order('created_at', { ascending: true });
    } else if (byRankAsc) {
      q = q.order('priority_rank', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
    } else {
      // rank_desc (default)
      q = q.order('priority_rank', { ascending: false, nullsFirst: true }).order('created_at', { ascending: false });
    }

    const { data, error } = await q;
    if (error) throw error;

    const items = (data || []).map((r) => {
      const rawTitle = (r.title || '').trim();
      const safeTitle =
        rawTitle && rawTitle.length
          ? rawTitle
          : (r.transcript || '').trim().replace(/\s+/g, ' ').slice(0, 90) || '(untitled)';

      return {
        id: r.id,
        created_at: r.created_at,
        org_slug: r.org_slug || null,
        user_id: r.user_id || null,
        title: safeTitle,
        transcript: r.transcript || null,
        originator_name: r.originator_name || null,
        priority_rank: r.priority_rank ?? null,
        frequency: r.frequency ?? null,
        ease: r.ease ?? null,
        leader_to_unblock: r.leader_to_unblock ?? null,
      };
    });

    res.json({ items });
  } catch (err) {
    console.error('GET /api/list error:', err);
    res.status(500).json({ error: 'list_failed' });
  }
});

// Create new item (kept for completeness if your UI uses it)
app.post('/api/items/new', async (req, res) => {
  try {
    const org = (req.query.org || DEFAULT_ORG || '').trim() || null;
    const { title, transcript, originator_name, user_id } = req.body || {};
    const safeTitle =
      (title || '').trim() ||
      (transcript || '').trim().replace(/\s+/g, ' ').slice(0, 90) ||
      '(untitled)';

    const insert = {
      org_slug: org,
      title: safeTitle,
      transcript: transcript || null,
      originator_name: originator_name || null,
      user_id: user_id || null,
    };

    const { data, error } = await supabase.from('items').insert([insert]).select('id').single();
    if (error) throw error;
    res.json({ ok: true, id: data.id });
  } catch (err) {
    console.error('POST /api/items/new error:', err);
    res.status(500).json({ error: 'new_failed' });
  }
});

// ---- Save/update routes (3 aliases so the UI won’t 404) --------------------

// PATCH /api/items/:id   (preferred)
app.patch('/api/items/:id', async (req, res) => {
  const id = req.params.id;
  const patch = req.body || {};

  // sanitize known fields (others will be tried/auto-dropped if unknown)
  const clean = {};
  if (patch.title !== undefined) clean.title = (patch.title || '').trim() || null;
  if (patch.priority_rank !== undefined) clean.priority_rank = coerceNum(patch.priority_rank, -9999, 9999);
  if (patch.frequency !== undefined) clean.frequency = coerceNum(patch.frequency, 0, 10);
  if (patch.ease !== undefined) clean.ease = coerceNum(patch.ease, 0, 10);
  if (patch.team_energy !== undefined) clean.team_energy = coerceNum(patch.team_energy, 0, 10);
  if (patch.leader_to_unblock !== undefined) clean.leader_to_unblock = !!patch.leader_to_unblock;

  try {
    const { data, error } = await safeUpdateItem(id, clean);
    if (error) throw error;
    res.json({ ok: true, id, item: data });
  } catch (err) {
    console.error('PATCH /api/items/:id error:', err);
    res.status(500).json({ error: 'save_failed' });
  }
});

// POST /api/items/:id/factors  (compat)
app.post('/api/items/:id/factors', async (req, res) => {
  const id = req.params.id;
  const body = req.body || {};
  const clean = {
    // accept both names in case UI varies
    team_energy: coerceNum(body.team_energy ?? body.teamEnergy, 0, 10),
    frequency: coerceNum(body.frequency, 0, 10),
    ease: coerceNum(body.ease, 0, 10),
  };
  if (body.title !== undefined) clean.title = (body.title || '').trim() || null;
  if (body.leader_to_unblock !== undefined) clean.leader_to_unblock = !!body.leader_to_unblock;

  try {
    const { data, error } = await safeUpdateItem(id, clean);
    if (error) throw error;
    res.json({ ok: true, id, item: data });
  } catch (err) {
    console.error('POST /api/items/:id/factors error:', err);
    res.status(500).json({ error: 'save_failed' });
  }
});

// POST /api/items/:id/update (compat)
app.post('/api/items/:id/update', async (req, res) => {
  const id = req.params.id;
  try {
    const { data, error } = await safeUpdateItem(id, req.body || {});
    if (error) throw error;
    res.json({ ok: true, id, item: data });
  } catch (err) {
    console.error('POST /api/items/:id/update error:', err);
    res.status(500).json({ error: 'save_failed' });
  }
});

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
