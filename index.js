// index.js (felma-backend)
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// CORS: allow UI + local dev
app.use(cors({
  origin: "*",
  methods: ["GET","POST","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service-role key works; anon also OK for read
const TABLE = process.env.TABLE || "items";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  global: { fetch }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, table: TABLE, url: SUPABASE_URL });
});

app.get("/api/list", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .order("priority_rank", { ascending: false }); // safe regardless of schema

    if (error) {
      console.error("supabase error:", error);
      return res.status(500).json({ error: "db" });
    }

    const items = Array.isArray(data) ? data : [];
    // IMPORTANT: return raw array so the UI sees items
    return res.json(items);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server" });
  }
});

// optional: simple POST for creating one new item
app.post("/api/items", async (req, res) => {
  try {
    const payload = req.body ?? {};
    const { data, error } = await supabase.from(TABLE).insert(payload).select();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data?.[0] ?? null);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server" });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Felma backend listening on ${port}`);
});
