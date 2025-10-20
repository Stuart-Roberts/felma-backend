import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

// --- config ---
const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TABLE = process.env.TABLE || "items"; // your table is "items"

// --- app ---
const app = express();
app.use(cors({ origin: "*", credentials: false }));
app.use(express.json({ limit: "1mb" }));

// --- supabase ---
function sb() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_KEY");
  }
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

// --- health ---
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, table: TABLE, url: SUPABASE_URL });
});

// --- list (supports both /api/list and /api/items) ---
async function listHandler(req, res) {
  try {
    const { data, error } = await sb().from(TABLE).select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json({ items: data ?? [] });
  } catch (e) {
    res.status(500).json({ error: e.message || "list failed" });
  }
}
app.get("/api/list", listHandler);
app.get("/api/items", listHandler);

// --- show one (supports /api/item/:id and /api/items/:id and /api/item?id=...) ---
async function showHandler(req, res) {
  try {
    const id = req.params.id || req.query.id;
    if (!id) return res.status(400).json({ error: "missing id" });
    const { data, error } = await sb().from(TABLE).select("*").eq("id", id).single();
    if (error?.code === "PGRST116") return res.status(404).json({ error: "not found" }); // no rows
    if (error) throw error;
    res.json({ item: data });
  } catch (e) {
    res.status( e.message?.includes("not found") ? 404 : 500 ).json({ error: e.message || "show failed" });
  }
}
app.get("/api/item/:id", showHandler);
app.get("/api/items/:id", showHandler);
app.get("/api/item", showHandler); // in case UI passes ?id=...

// --- create (supports /api/items, /api/item, /api/create) ---
async function createHandler(req, res) {
  try {
    // UI may send {transcript}, {content}, or {text}. Map to transcript.
    const body = req.body || {};
    const transcript = body.transcript ?? body.content ?? body.text ?? "";
    const row = {
      transcript,
      user_id: body.user_id ?? null,
      item_title: body.item_title ?? body.title ?? null, // if your table has it; ignored if column doesn’t exist
      created_at: new Date().toISOString(),             // ignored if your table sets it automatically
    };

    const { data, error } = await sb().from(TABLE).insert(row).select("*").single();
    if (error) throw error;
    res.status(201).json({ item: data });
  } catch (e) {
    res.status(400).json({ error: e.message || "create failed" });
  }
}
app.post("/api/items", createHandler);
app.post("/api/item", createHandler);
app.post("/api/create", createHandler);

// --- default 404 (keep it last) ---
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// --- start ---
app.listen(PORT, () => console.log(`Felma backend listening on ${PORT}`));
