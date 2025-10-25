// felma-backend/index.js
// Complete with correct priority rank formula

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;

// CORS setup
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
app.use(cors({
  origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
  credentials: false,
  methods: ["GET", "POST", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

app.use(express.json());

// Supabase client
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
const DEFAULT_ORG = process.env.DEFAULT_ORG || "stmichaels";

if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false }
});

// Helper functions
function toNum(val) {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  }
  return null;
}

function clean(str) {
  return typeof str === "string" ? str.trim() : (str || null);
}

// CORRECT PRIORITY RANK FORMULA
function computePriorityRank(customer_impact, team_energy, frequency, ease) {
  const ci = Number(customer_impact || 0);
  const te = Number(team_energy || 0);
  const fq = Number(frequency || 0);
  const ez = Number(ease || 0);
  
  const a = 0.57 * ci + 0.43 * te;
  const b = 0.6 * fq + 0.4 * ez;
  
  return Math.round(a * b);
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "felma-backend" });
});

// Get all profiles (for user selection)
app.get("/api/profiles", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, display_name, phone, email")
      .order("full_name");

    if (error) throw error;

    res.json({ profiles: data || [] });
  } catch (e) {
    console.error("GET /api/profiles error:", e);
    res.status(500).json({ error: "profiles_failed" });
  }
});

// Get all items for an org
app.get("/api/list", async (req, res) => {
  try {
    const org = clean(req.query.org) || DEFAULT_ORG;
    
    const { data, error } = await supabase
      .from("items")
      .select("*")
      .eq("org_slug", org)
      .order("priority_rank", { ascending: false, nullsLast: true })
      .order("created_at", { ascending: false });

    if (error) throw error;

    const items = (data || []).map(row => ({
      id: row.id,
      created_at: row.created_at,
      org_slug: row.org_slug,
      user_id: row.user_id || null,
      originator_name: row.originator_name || null,
      title: row.title || row.item_title || row.transcript || "(untitled)",
      transcript: row.transcript || null,
      customer_impact: row.customer_impact ?? null,
      team_energy: row.team_energy ?? null,
      frequency: row.frequency ?? null,
      ease: row.ease ?? null,
      priority_rank: row.priority_rank ?? null,
      action_tier: row.action_tier || null,
      leader_to_unblock: !!row.leader_to_unblock,
      response: row.response || null,
      status: row.status || null,
    }));

    res.json({ items });
  } catch (e) {
    console.error("GET /api/list error:", e);
    res.status(500).json({ error: "list_failed" });
  }
});

// Create new item
app.post("/api/items/new", async (req, res) => {
  try {
    const body = req.body || {};
    const org = clean(body.org_slug) || DEFAULT_ORG;

    const ci = toNum(body.customer_impact);
    const te = toNum(body.team_energy);
    const fq = toNum(body.frequency);
    const ez = toNum(body.ease);

    // Calculate priority rank if we have all 4 factors
    let priority_rank = toNum(body.priority_rank);
    let action_tier = clean(body.action_tier);
    let leader_to_unblock = typeof body.leader_to_unblock === "boolean" ? body.leader_to_unblock : false;

    if (ci !== null && te !== null && fq !== null && ez !== null) {
      priority_rank = computePriorityRank(ci, te, fq, ez);
      
      // Determine tier
      if (priority_rank >= 60) {
        action_tier = "Move now";
      } else if (priority_rank >= 36) {
        action_tier = "Move it forward";
      } else {
        action_tier = "When time allows";
      }

      // Leader to unblock: team_energy >= 9 AND ease <= 3
      leader_to_unblock = (te >= 9 && ez <= 3);
    }

    const insertRow = {
      org_slug: org,
      user_id: clean(body.user_id) || clean(body.from) || null,
      originator_name: clean(body.originator_name) || null,
      transcript: clean(body.transcript) || clean(body.body) || "",
      title: clean(body.title) || null,
      item_type: clean(body.item_type) || "frustration",
      response: clean(body.response) || null,
      customer_impact: ci,
      team_energy: te,
      frequency: fq,
      ease: ez,
      priority_rank: priority_rank,
      action_tier: action_tier,
      leader_to_unblock: leader_to_unblock,
      status: clean(body.status) || "open",
    };

    const { data, error } = await supabase
      .from("items")
      .insert([insertRow])
      .select("id")
      .single();

    if (error) throw error;

    res.status(201).json({ ok: true, id: data.id });
  } catch (e) {
    console.error("POST /api/items/new error:", e);
    res.status(500).json({ error: "add_failed" });
  }
});

// Update item (title, etc)
app.patch("/api/items/:id", async (req, res) => {
  try {
    const id = clean(req.params.id);
    if (!id) return res.status(400).json({ error: "bad_id" });

    const body = req.body || {};
    const updates = {};

    if (body.title) updates.title = clean(body.title);

    if (Object.keys(updates).length === 0) {
      return res.json({ ok: true, message: "no_changes" });
    }

    const { error } = await supabase
      .from("items")
      .update(updates)
      .eq("id", id);

    if (error) throw error;

    res.json({ ok: true });
  } catch (e) {
    console.error("PATCH /api/items/:id error:", e);
    res.status(500).json({ error: "update_failed" });
  }
});

// Update item factors (4 sliders)
app.post("/api/items/:id/factors", async (req, res) => {
  try {
    const id = clean(req.params.id);
    if (!id) return res.status(400).json({ error: "bad_id" });

    const body = req.body || {};
    const updates = {};

    const ci = toNum(body.customer_impact);
    const te = toNum(body.team_energy);
    const fq = toNum(body.frequency);
    const ez = toNum(body.ease);

    if (ci !== null) updates.customer_impact = ci;
    if (te !== null) updates.team_energy = te;
    if (fq !== null) updates.frequency = fq;
    if (ez !== null) updates.ease = ez;

    // Recalculate priority_rank if we have all 4 factors
    if (ci !== null && te !== null && fq !== null && ez !== null) {
      updates.priority_rank = computePriorityRank(ci, te, fq, ez);
      
      // Determine tier
      if (updates.priority_rank >= 60) {
        updates.action_tier = "Move now";
      } else if (updates.priority_rank >= 36) {
        updates.action_tier = "Move it forward";
      } else {
        updates.action_tier = "When time allows";
      }

      // Leader to unblock: team_energy >= 9 AND ease <= 3
      updates.leader_to_unblock = (te >= 9 && ez <= 3);
    }

    if (Object.keys(updates).length === 0) {
      return res.json({ ok: true, message: "no_changes" });
    }

    const { error } = await supabase
      .from("items")
      .update(updates)
      .eq("id", id);

    if (error) throw error;

    res.json({ ok: true, updates });
  } catch (e) {
    console.error("POST /api/items/:id/factors error:", e);
    res.status(500).json({ error: "save_failed" });
  }
});

// Get item factors (for prefilling drawer)
app.get("/api/items/:id/factors", async (req, res) => {
  try {
    const id = clean(req.params.id);
    
    const { data, error } = await supabase
      .from("items")
      .select("customer_impact, team_energy, frequency, ease")
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "not_found" });
    }

    res.json({
      customer_impact: data.customer_impact ?? 0,
      team_energy: data.team_energy ?? 0,
      frequency: data.frequency ?? 0,
      ease: data.ease ?? 0,
    });
  } catch (e) {
    console.error("GET /api/items/:id/factors error:", e);
    res.status(500).json({ error: "factors_failed" });
  }
});

// Route aliases (UI sometimes calls without /api prefix)
app.post("/items/new", (req, res) => {
  req.url = "/api/items/new";
  app._router.handle(req, res);
});

app.patch("/items/:id", (req, res) => {
  req.url = `/api/items/${req.params.id}`;
  app._router.handle(req, res);
});

app.post("/items/:id/factors", (req, res) => {
  req.url = `/api/items/${req.params.id}/factors`;
  app._router.handle(req, res);
});

app.get("/items/:id/factors", (req, res) => {
  req.url = `/api/items/${req.params.id}/factors`;
  app._router.handle(req, res);
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ felma-backend running on port ${PORT}`);
});
