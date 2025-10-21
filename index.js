// index.js  (ESM, matches "type":"module")
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());              // allow all origins (Render is fine)
app.use(express.json());

const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TABLE = "items";

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// Map DB row -> UI shape (owner name preferred, else phone)
function toItem(r) {
  return {
    id: r.id,
    title: r.content || r.item_title || r.transcript || "Untitled",
    created_at: r.created_at,
    rank: r.rank ?? 0,
    tier: r.tier || "WHEN TIME ALLOWS",
    owner: r.originator_name || r.owner_name || r.user_id || "",
    leader_to_unblock: !!r.leader_to_unblock,
    type: r.item_type || "frustration"
  };
}

// Health
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, table: TABLE, url: SUPABASE_URL });
});

// List items
app.get("/api/list", async (_req, res) => {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ items: (data || []).map(toItem) });
});

// One item
app.get("/api/item/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await db.from(TABLE).select("*").eq("id", id).single();
  if (error) return res.status(404).json({ error: "Not found" });
  res.json({ item: toItem(data) });
});

// Create a minimal new item (keeps DB flexible)
app.post("/api/new", async (req, res) => {
  const { title, owner } = req.body || {};
  if (!title) return res.status(400).json({ error: "Missing title" });

  const insert = {
    content: title,
    originator_name: owner || null,  // prefer name; phone can still live in user_id elsewhere
    item_type: "frustration",
    tier: "WHEN TIME ALLOWS",
    rank: 0,
    leader_to_unblock: false
  };

  const { data, error } = await db.from(TABLE).insert(insert).select("*").single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ item: toItem(data) });
});

// Patch minimal fields (rank, tier, leader flag, owner name)
app.patch("/api/item/:id", async (req, res) => {
  const { id } = req.params;
  const patch = {};
  if ("rank" in req.body) patch.rank = req.body.rank;
  if ("tier" in req.body) patch.tier = req.body.tier;
  if ("leader_to_unblock" in req.body) patch.leader_to_unblock = !!req.body.leader_to_unblock;
  if ("owner" in req.body) patch.originator_name = req.body.owner || null;

  const { data, error } = await db.from(TABLE).update(patch).eq("id", id).select("*").single();
  if (error) return res.status(500).json({ error: error.message });

  res.json({ item: toItem(data) });
});

app.listen(PORT, () => {
  console.log(`Felma backend listening on ${PORT}`);
});
