// index.js — Felma backend (Render-safe + Supabase persistence)

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

/* ---------- Config ---------- */
const ORIGIN = process.env.CORS_ORIGIN || "https://felma-ui.onrender.com";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service role key

/* ---------- Middleware ---------- */
app.use(cors({ origin: ORIGIN }));
app.use(express.json());

/* ---------- Supabase ---------- */
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("⚠️ SUPABASE_URL or SUPABASE_KEY not set; DB ops will fail.");
}
const supabase = createClient(SUPABASE_URL || "", SUPABASE_KEY || "");

/* ---------- Routes ---------- */

// Root sanity
app.get("/", (_req, res) => res.status(200).send("Felma backend OK"));

// List items (latest first, persisted)
app.get("/api/list", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("items")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  } catch (e) {
    console.error("List error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

// Create item (accepts 'frustration' or 'idea'); aliases for safety
app.post(["/api/items", "/api/item", "/api/create"], async (req, res) => {
  try {
    const { content, item_type, user_id = null, org_id = "DEV", team_id = "GENERAL" } = req.body || {};

    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content required" });
    }
    if (!["frustration", "idea"].includes(item_type)) {
      return res.status(400).json({ error: "item_type must be 'frustration' or 'idea'" });
    }

    const insertRow = {
      content: content.trim(),
      item_type,
      user_id,
      org_id,
      team_id
      // created_at defaults to NOW() in DB
    };

    const { data, error } = await supabase
      .from("items")
      .insert([insertRow])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json(data);
  } catch (e) {
    console.error("Create error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

/* ---------- Server start (Render-safe) ---------- */
const PORT = process.env.PORT || 10000;
const HOST = "0.0.0.0";
app.listen(PORT, HOST, () => {
  console.log(`Felma server running on http://${HOST}:${PORT}`);
});
