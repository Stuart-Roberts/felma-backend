// Minimal, robust backend using Supabase REST (no supabase-js, no tslib)
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
app.use(express.json());

// CORS: wide open so UI can talk to it
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(morgan('tiny'));

// Env
const SUPABASE_URL = process.env.SUPABASE_URL;        // e.g. https://xyzcompany.supabase.co
const SUPABASE_KEY = process.env.SUPABASE_KEY;        // service role key
const TABLE = process.env.TABLE_NAME || 'items';

// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, table: TABLE, url: SUPABASE_URL });
});

// List items (via Supabase PostgREST)
app.get('/api/list', async (req, res) => {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=id.desc&limit=200`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'count=exact'
      }
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.message || 'Supabase error' });
    res.json({ items: data });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Server error' });
  }
});

// Fallback
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Felma backend listening on ${port}`);
});
