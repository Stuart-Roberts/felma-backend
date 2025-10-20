// index.js
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TABLE = process.env.TABLE || "items";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_KEY.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const app = express();
app.use(cors());               // permissive CORS
app.use(express.json());       // JSON bodies

// Health
app.get("/api/health", (req, res) => {
  res.json({ ok: true, table: TABLE, url: SUPABASE_URL });
});

// List — return { items: [...] } so the UI sees them
app.get("/api/list", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create (used by the “+ New” button)
app.post("/api/items", async (req, res) => {
  try {
    const { content, org_slug } = req.body || {};
    if (!content) return res.status(400).json({ error: "content is required" });

    const row = {
      content,
      status: "open",
      org_slug: org_slug || "pilot",
    };

    const { data, error } = await supabase.from(TABLE).insert(row).select("*").single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update (rank/status/etc.)
app.patch("/api/items/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body || {};
    const { data, error } = await supabase.from(TABLE).update(updates).eq("id", id).select("*").single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 404 catch-all
app.use((req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`Felma backend listening on ${PORT}`);
});
