// server.js — Felma backend (Render-safe, drop-in)
const express = require("express");
const cors = require("cors");

const app = express();

// --- CORS/JSON ---
const ORIGIN = process.env.CORS_ORIGIN || "https://felma-ui.onrender.com";
app.use(cors({ origin: ORIGIN }));
app.use(express.json());

// --- In-memory store (temporary so UI can save now) ---
const items = [];

// --- List items (matches your UI's GET /api/list) ---
app.get("/api/list", (req, res) => {
  res.status(200).json(items);
});

// --- Create item (accepts either 'frustration' or 'idea') ---
app.post(["/api/items", "/api/item", "/api/create"], (req, res) => {
  try {
    const { content, item_type, user_id = null } = req.body || {};

    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "content required" });
    }
    if (!["frustration", "idea"].includes(item_type)) {
      return res
        .status(400)
        .json({ error: "item_type must be 'frustration' or 'idea'" });
    }

    const now = new Date().toISOString();
    const item = {
      id: items.length + 1,
      content: content.trim(),
      item_type,
      user_id,
      org_id: "DEV",
      team_id: "GENERAL",
      created_at: now,
    };
    items.unshift(item);
    return res.status(201).json(item);
  } catch (e) {
    console.error("Create error:", e);
    return res.status(500).json({ error: "server_error" });
  }
});

// --- Root sanity check ---
app.get("/", (_req, res) => res.status(200).send("Felma backend OK"));

// --- Render-safe server start ---
const PORT = process.env.PORT || 10000; // Render injects PORT
const HOST = "0.0.0.0";                 // listen on all interfaces
app.listen(PORT, HOST, () => {
  console.log(`Felma server running on http://${HOST}:${PORT}`);
});
