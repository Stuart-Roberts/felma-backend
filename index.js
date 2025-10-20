// index.js (root) — fixed CommonJS version for Render + Supabase

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Root check
app.get("/", (req, res) => {
  res.send("✅ Felma backend running");
});

// GET all items
app.get("/items", async (req, res) => {
  try {
    const { data, error } = await supabase.from("items").select("*");
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("GET /items error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET one item by id
app.get("/items/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("items")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("GET /items/:id error:", err.message);
    res.status(404).json({ error: err.message });
  }
});

// PATCH rank update
app.patch("/items/:id/rank", async (req, res) => {
  try {
    const { rank } = req.body;
    const { data, error } = await supabase
      .from("items")
      .update({ rank })
      .eq("id", req.params.id)
      .select();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("PATCH /items/:id/rank error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`✅ Felma backend live on port ${port}`));
