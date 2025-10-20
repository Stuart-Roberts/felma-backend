// Minimal, safe Express API for Felma
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service role key
const CORS_ORIGIN = process.env.CORS_ORIGIN || ""; // e.g. https://felma-ui.onrender.com

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_KEY env vars");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const app = express();
app.use(express.json());

// CORS: allow exactly one origin (or no origin for server-to-server)
const whitelist = new Set([CORS_ORIGIN].filter(Boolean));
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // curl / health / server-to-server
      if (whitelist.has(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// -------- Health
app.get("/health", (_req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

// -------- Shared router (mounted at "/" and "/api" for safety)
const router = express.Router();

// LIST items (used by the grid)
router.get("/items", async (_req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// GET one item (used by the detail page)
router.get("/items/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

// SAVE ranking (impact/energy/frequency/ease) for an item
router.post("/items/:id/rank", async (req, res) => {
  const { id } = req.params;
  const { impact, energy, frequency, ease } = req.body || {};
  const updates = {
    ...(impact !== undefined && { impact }),
    ...(energy !== undefined && { energy }),
    ...(frequency !== undefined && { frequency }),
    ...(ease !== undefined && { ease }),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("items")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Mount at both "" and "/api" to cover UI variants
app.use("/", router);
app.use("/api", router);

// 404 handler (json)
app.use((_req, res) => res.status(404).json({ error: "Not found" }));

app.listen(PORT, () => {
  console.log(`Felma backend listening on ${PORT}`);
});
