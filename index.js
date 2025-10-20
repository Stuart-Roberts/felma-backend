// index.js — Felma backend (Express + Supabase)

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

// --- CORS (single origin or comma-separated list) ---
const ORIGIN = process.env.CORS_ORIGIN || "https://felma-ui.onrender.com";
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // allow server-to-server/health checks
      const allow = ORIGIN.split(",").map(s => s.trim());
      cb(null, allow.includes(origin));
    },
  })
);
app.use(express.json());

// --- Supabase (service role key) ---
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_KEY || ""; // service_role

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("⚠️  SUPABASE_URL or SUPABASE_KEY not set; DB ops will fail.");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Health ---
app.get("/", (_req, res) => res.status(200).send("Felma backend OK"));

// --- List items (latest first, persisted) ---
app.get("/api/list", async (_req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ?? []);
});

// --- Get single item by id (UI detail needs this) ---
app.get("/api/item/:id", async (req, res) => {
  const id = req.params.id;
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .limit(1)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "not_found" });
  return res.json(data);
});

// --- Create item (accepts frustration/idea aliases) ---
app.post("/api/create", async (req, res) => {
  const {
    content,
    item_type,
    org_id,
    org_slug,
    team_id,
    team,
    originator_name,
    originator_email,
    rank,
    tier,
  } = req.body || {};

  if (typeof content !== "string" || !content.trim()) {
    return res.status(400).json({ error: "content_required" });
  }

  const safeType = (item_type || "frustration").toLowerCase();
  if (!["frustration", "idea"].includes(safeType)) {
    return res.status(400).json({ error: "invalid_item_type" });
  }

  const insertRow = {
    content: content.trim(),
    item_type: safeType,
    org_id: org_id ?? null,
    org_slug: org_slug ?? "demo",
    team_id: team_id ?? null,
    team: team ?? null,
    originator_name: originator_name ?? null,
    originator_email: originator_email ?? null,
    rank: typeof rank === "number" ? rank : null,
    tier: tier ?? null,
  };

  const { data, error } = await supabase.from("items").insert(insertRow).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });

  return res.status(201).json(data);
});

// --- Start server (Render-safe) ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Felma server running on http://0.0.0.0:" + PORT);
});
