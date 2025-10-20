// index.js  — ESM + Express + robust CORS + Supabase v2
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const PORT = process.env.PORT || 10000;

// Allow either "*" or a comma-separated allowlist (no spaces is safest).
// Example: CORS_ORIGIN="https://felma-ui.onrender.com,http://localhost:5173"
const allowed = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, cb) {
    // allow server-to-server or curl with no Origin
    if (!origin) return cb(null, true);
    if (allowed.includes("*") || allowed.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin not allowed: ${origin}`));
  },
  credentials: true,
};

const app = express();
app.use(cors(corsOptions));
app.use(express.json());

// --- Supabase helper (service role) ---
function sb() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY; // service_role key
  if (!url || !key) throw new Error("Supabase env missing");
  return createClient(url, key);
}

// --- Health ---
app.get("/", (_req, res) => res.send("ok"));

// --- Items list (optionally filter by org) ---
app.get("/items", async (req, res) => {
  try {
    const org = req.query.org || null;
    let q = sb().from("items").select("*").order("created_at", { ascending: false });
    if (org) q = q.eq("org", org);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ items: data || [] });
  } catch (e) {
    console.error("GET /items", e);
    res.status(500).json({ error: "fetch_failed" });
  }
});

// --- Item detail ---
app.get("/items/:id", async (req, res) => {
  try {
    const { data, error } = await sb()
      .from("items")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "not_found" });
    res.json({ item: data });
  } catch (e) {
    console.error("GET /items/:id", e);
    res.status(500).json({ error: "fetch_failed" });
  }
});

// --- Save ranking (impact/energy/ease/frequency) ---
app.post("/items/:id/rank", async (req, res) => {
  try {
    const { impact, energy, ease, frequency } = req.body || {};
    const nums = [impact, energy, ease, frequency].map((n) => Number(n));
    if (nums.some((n) => Number.isNaN(n))) return res.status(400).json({ error: "bad_inputs" });
    const quick_rank = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);

    const { data, error } = await sb()
      .from("items")
      .update({ impact, energy, ease, frequency, rank: quick_rank })
      .eq("id", req.params.id)
      .select("*")
      .single();

    if (error) throw error;
    res.json({ item: data });
  } catch (e) {
    console.error("POST /items/:id/rank", e);
    res.status(500).json({ error: "save_failed" });
  }
});

// Fallback for unknown routes
app.use((_req, res) => res.status(404).json({ error: "route_not_found" }));

app.listen(PORT, () => {
  console.log(`Felma backend listening on ${PORT}`);
});
