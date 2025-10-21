// index.js (CommonJS)
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TABLE = process.env.TABLE || 'items';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, table: TABLE, url: SUPABASE_URL });
});

app.get('/api/list', async (req, res) => {
  const { data, error } = await supabase.from(TABLE).select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: data || [] });
});

app.post('/api/item', async (req, res) => {
  const { content, owner_name, leader_to_unblock, item_type } = req.body || {};
  const insert = {
    content: content || '',
    owner_name: owner_name || null,
    leader_to_unblock: !!leader_to_unblock,
    item_type: item_type || 'frustration'
  };
  const { data, error } = await supabase.from(TABLE).insert(insert).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ item: data });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Felma backend listening on ${PORT}`);
});
