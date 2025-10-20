// index.js — Felma backend (CommonJS, manual CORS, dual routes)

const express = require("express");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service_role key

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_KEY are required.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const app = express();

/* Minimal, safe CORS for all routes (no commas, no invalid values) */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // allow all for pilot
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());

/* Health */
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "felma-backend", time: new Date().toISOString() });
});

/* Shared router mounted at / and /api  */
const api = express.Router();

/* List items */
api.get("/items", async (req, res) => {
  const sort = String(req.query.sort || "");
  let q = supabase.from("items").select("*");
  if (sort === "rank_desc" || sort === "rank(high>low)") {
    q = q.order("rank", { ascending: false });
  } else if (sort === "rank_asc" || sort === "rank(low>high)") {
    q = q.order("rank", { ascending: true });
  } else {
    q = q.order("created_at", { ascending: false });
  }
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(Array.isArray(data) ? data : []);
});

/* Get one item */
api.get("/items/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("id", req.params.id)
    .single();
  if (error) return res.status(404).json({ error: "Not found" });
  res.json(data);
});

/* Alternate paths some UIs use */
api.get("/item/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("id", req.params.id)
    .single();
  if (error) return res.status(404).json({ error: "Not found" });
  res.json(data);
});

/* Save ranking */
api.post("/items/:id/rank", async (req, res) => {
  const { id } = req.params;
  const { impact, energy, ease, frequency, rank } = req.body || {};
  const patch = {};
  if (impact != null) patch.impact = Number(impact);
  if (energy != null) patch.energy = Number(energy);
  if (ease != null) patch.ease = Number(ease);
  if (frequency != null) patch.frequency = Number(frequency);
  if (rank != null) patch.rank = Number(rank);

  const { data, error } = await supabase
    .from("items")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true, item: data });
});

/* Also accept /item/:id/rank */
api.post("/item/:id/rank", async (req, res) => {
  req.url = `/items/${req.params.id}/rank`;
  return api.handle(req, res);
});

app.use("/", api);
app.use("/api", api);

/* Fallback */
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Felma backend listening on ${PORT}`);
});
