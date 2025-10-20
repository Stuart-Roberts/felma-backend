import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

// CORS (allow your UI; you can comma-separate multiple origins in the env later)
const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// --- Supabase client ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY || process.env.ADMIN_KEY; // tolerate either variable

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY env vars.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// --- Routes ---

app.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// List items (fallback aliases to be defensive with existing UI calls)
app.get(["/items", "/list"], async (req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Get one item
app.get(["/items/:id", "/item/:id"], async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.from("items").select("*").eq("id", id).single();

  if (error) {
    // PostgREST not-found can surface as 406/410/…; just map to 404 for the UI
    return res.status(404).json({ error: "Not found" });
  }
  res.json(data);
});

// Save ranking (impact/energy/ease/frequency) and recompute rank (avg)
app.post(["/items/:id/rank", "/item/:id/rank"], async (req, res) => {
  const { id } = req.params;
  const { impact, energy, ease, frequency } = req.body || {};

  const nums = [impact, energy, ease, frequency]
    .map(n => (n === undefined || n === null ? undefined : Number(n)))
    .filter(n => typeof n === "number" && !Number.isNaN(n));

  const rank = nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;

  const update = {
    ...(impact !== undefined ? { impact } : {}),
    ...(energy !== undefined ? { energy } : {}),
    ...(ease !== undefined ? { ease } : {}),
    ...(frequency !== undefined ? { frequency } : {}),
    ...(rank !== null ? { rank } : {}),
  };

  const { data, error } = await supabase.from("items").update(update).eq("id", id).select().single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// --- Start server ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Felma backend listening on ${PORT}`);
});
