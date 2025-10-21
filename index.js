const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TABLE = process.env.TABLE || 'items';

const app = express();

// Wide-open CORS for the pilot
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(bodyParser.json());

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, table: TABLE, url: SUPABASE_URL })
);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Normalize DB row -> API item
function mapRow(r) {
  return {
    id: r.id,
    created_at: r.created_at,
    title: r.title || r.item_title || r.content,
    content: r.content,
    user_id: r.user_id,
    owner: r.owner || r.user_id || null,
    priority_rank: r.priority_rank ?? r.rank ?? 0,
    leader_to_unblock: !!r.leader_to_unblock,
    customer_impact: r.customer_impact ?? 0,
    team_energy: r.team_energy ?? 0,
    frequency: r.frequency ?? 0,
    ease: r.ease ?? 0,
    org_slug: r.org_slug,
  };
}

// GET /api/list — all items
app.get('/api/list', async (_req, res) => {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: (data || []).map(mapRow) });
});

// GET /api/item/:id — single item
app.get('/api/item/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).single();
  if (error || !data) return res.status(404).json({ error: 'Not found' });
  res.json({ item: mapRow(data) });
});

// PATCH /api/item/:id — update sliders + leader flag (and optional owner)
app.patch('/api/item/:id', async (req, res) => {
  const { id } = req.params;

  const allowed = [
    'customer_impact',
    'team_energy',
    'frequency',
    'ease',
    'leader_to_unblock',
    'owner',
  ];

  const updates = {};
  for (const k of allowed) if (k in req.body) updates[k] = req.body[k];

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No updates provided' });
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ item: mapRow(data) });
});

app.listen(PORT, () => {
  console.log(`Felma backend listening on ${PORT}`);
});
