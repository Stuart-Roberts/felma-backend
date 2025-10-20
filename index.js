// index.js  — CommonJS backend for Render
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 10000;

// CORS: single exact origin (your UI on Render)
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://felma-ui.onrender.com';

// Supabase (server-side: needs Service Role KEY)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: CORS_ORIGIN, // one exact origin
  })
);

// --- Healthcheck
app.get('/health', (_req, res) => res.type('text').send('ok'));

// --- List items (optional ?org=...)
app.get('/items', async (req, res) => {
  const org = req.query.org || null;
  let q = supabase.from('items').select('*');

  if (org) q = q.eq('org', org);

  // If your table uses a different sort column, adjust here:
  q = q.order('created_at', { ascending: false });

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data || [] });
});

// --- Get single item
app.get('/items/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'not found' });
  res.json({ item: data });
});

// --- Save rank for an item (impact/energy/ease/frequency: 1..10)
app.post('/items/:id/rank', async (req, res) => {
  const { impact, energy, ease, frequency } = req.body || {};

  // Simple average — mirrors the UI quick-rank behaviour
  const parts = [impact, energy, ease, frequency].filter(
    (n) => typeof n === 'number'
  );
  const avg = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;

  const update = {
    impact,
    energy,
    ease,
    frequency,
    rank: avg !== null ? Math.round(avg) : null,
  };

  const { data, error } = await supabase
    .from('items')
    .update(update)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ item: data });
});

app.use((_req, res) => res.status(404).json({ error: 'route not found' }));

app.listen(PORT, () => {
  console.log(`Felma backend listening on ${PORT}`);
});
