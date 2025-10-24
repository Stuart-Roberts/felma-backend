// index.js
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

// --- ENV ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const DEFAULT_ORG = process.env.DEFAULT_ORG || "stmichaels";

if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY");
}

const supabase = createClient(SUPABASE_URL, ADMIN_KEY);

// --- APP ---
const app = express();
app.use(express.json());
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
    credentials: false,
  })
);

// helpers
const clean = (v) => (typeof v === "string" ? v.trim() : v ?? null);
const toNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// --- HEALTH ---
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// --- PEOPLE (robust to id/uuid/uid; no fragile column list) ---
app.get("/api/people", async (_req, res) => {
  try {
    const { data, error } = await supabase.from("profiles").select("*");
    if (error) throw error;

    const people = (data || []).map((r) => ({
      id: r.id || r.uuid || r.uid || null,
      email: clean(r.email),
      phone: clean(r.phone),
      full_name: clean(r.full_name),
      display_name: clean(r.display_name),
    }));

    return res.json(people);
  } catch (e) {
    console.error("GET /api/people error:", e);
    return res.status(500).json({ error: "people_failed" });
  }
});

// --- LIST (rank desc, then newest) ---
app.get("/api/list", async (req, res) => {
  const org = clean(req.query.org) || DEFAULT_ORG;
  try {
    const fields = [
      "id",
      "created_at",
      "org_slug",
      "user_id",
      "originator_name",
      "title",
      "transcript",
      "action_tier",
      "priority_rank",
      "frequency",
      "ease",
      "leader_to_unblock",
      "team_energy",
    ].join(",");

    const { data, error } = await supabase
      .from("items")
      .select(fields)
      .eq("org_slug", org)
      .order("priority_rank", { ascending: false, nullsLast: true })
      .order("created_at", { ascending: false });

    if (error) throw error;

    const items = (data || []).map((r) => ({
      id: r.id,
      created_at: r.created_at,
      org_slug: r.org_slug,
      user_id: clean(r.user_id),
      originator_name: clean(r.originator_name),
      title:
        (r.title && String(r.title).trim()) ||
        (r.transcript && String(r.transcript).trim()) ||
        "(untitled)",
      transcript: clean(r.transcript),
      action_tier: r.action_tier ?? null,
      priority_rank: toNum(r.priority_rank),
      frequency: toNum(r.frequency),
      ease: toNum(r.ease),
      leader_to_unblock:
        typeof r.leader_to_unblock === "boolean" ? r.leader_to_unblock : false,
      team_energy: toNum(r.team_energy),
    }));

    return res.json({ items });
  } catch (e) {
    console.error("GET /api/list error:", e);
    return res.status(500).json({ error: "list_failed" });
  }
});

// --- UI write/read endpoints (no /api prefix; the UI calls these) ---

// Create new item
app.post("/items/new", async (req, res) => {
  try {
    const org = clean(req.query.org) || DEFAULT_ORG;
    const body = req.body || {};

    const insertRow = {
      org_slug: org,
      user_id:
        clean(body.user_id) ||
        clean(req.headers["x-user-id"]) ||
        clean(req.headers["x-user"]) ||
        null,
      title: clean(body.title) || "(untitled)",
      transcript: clean(body.transcript) || null,

      // allow initial factors if UI sends them
      priority_rank: toNum(body.customer_impact) ?? toNum(body.priority_rank),
      team_energy: toNum(body.team_energy),
      frequency: toNum(body.frequency),
      ease: toNum(body.ease),
      leader_to_unblock:
        typeof body.leader_to_unblock === "boolean"
          ? body.leader_to_unblock
          : false,
    };

    const { data, error } = await supabase
      .from("items")
      .insert([insertRow])
      .select("id")
      .single();

    if (error) throw error;
    return res.status(201).json({ id: data.id });
  } catch (e) {
    console.error("POST /items/new error:", e);
    return res.status(404).json({ error: "add_failed" });
  }
});

// Update factor sliders for an item
app.post("/items/:id/factors", async (req, res) => {
  try {
    const id = clean(req.params.id);
    if (!id) return res.status(400).json({ error: "bad_id" });

    const body = req.body || {};
    const patch = {};
    const ci = toNum(body.customer_impact);
    const te = toNum(body.team_energy);
    const fq = toNum(body.frequency);
    const ez = toNum(body.ease);

    if (ci !== null) patch.priority_rank = ci;
    if (te !== null) patch.team_energy = te;
    if (fq !== null) patch.frequency = fq;
    if (ez !== null) patch.ease = ez;

    if (Object.keys(patch).length === 0) {
      return res.json({ ok: true, no_change: true });
    }

    const { error } = await supabase.from("items").update(patch).eq("id", id);
    if (error) throw error;

    return res.json({ ok: true });
  } catch (e) {
    console.error("POST /items/:id/factors error:", e);
    return res.status(404).json({ error: "save_failed" });
  }
});

// Prefill factors for drawer (the UI GETs this)
app.get("/items/:id/factors", async (req, res) => {
  try {
    const id = clean(req.params.id);
    const { data, error } = await supabase
      .from("items")
      .select("priority_rank,team_energy,frequency,ease")
      .eq("id", id)
      .single();

    if (error || !data) return res.status(404).json({ error: "not_found" });

    return res.json({
      customer_impact: toNum(data.priority_rank),
      team_energy: toNum(data.team_energy),
      frequency: toNum(data.frequency),
      ease: toNum(data.ease),
    });
  } catch (e) {
    console.error("GET /items/:id/factors error:", e);
    return res.status(500).json({ error: "factors_failed" });
  }
});

// --- START ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
