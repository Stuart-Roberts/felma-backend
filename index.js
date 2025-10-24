// index.js
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

// ---- ENV ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const DEFAULT_ORG = process.env.DEFAULT_ORG || "stmichaels";

if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY env vars.");
}

const supabase = createClient(SUPABASE_URL, ADMIN_KEY);

// ---- APP ----
const app = express();
app.use(express.json());
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
    credentials: false,
  })
);

// Small helper to normalize null/undefined/empty strings
const clean = (v) => (typeof v === "string" ? v.trim() : v ?? null);

// ---- HEALTH ----
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// ---- PEOPLE (robust to different column names) ----
app.get("/api/people", async (_req, res) => {
  try {
    // Try common layouts in order, fall back gracefully
    const attempts = [
      "id,email,phone,full_name,display_name",
      "uuid,email,phone,full_name,display_name",
      "uid,email,phone,full_name,display_name",
    ];

    let rows = null;
    let lastErr = null;

    for (const cols of attempts) {
      const { data, error } = await supabase
        .from("profiles")
        .select(cols)
        .order("full_name", { ascending: true, nullsFirst: true });

      if (!error) {
        rows = data;
        break;
      }
      // 42703 = undefined_column; try next mapping
      if (error.code !== "42703") {
        lastErr = error;
        break;
      }
      lastErr = error;
    }

    if (!rows) throw lastErr || new Error("profiles query failed");

    const people = rows.map((r) => ({
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

// ---- LIST ITEMS (keeps { items: [...] } shape) ----
app.get("/api/list", async (req, res) => {
  const org = clean(req.query.org) || DEFAULT_ORG;

  try {
    // Select only columns we need; all are nullable-safe.
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
      // never blank; UI depends on having something
      title:
        (r.title && String(r.title).trim()) ||
        (r.transcript && String(r.transcript).trim()) ||
        "(untitled)",
      transcript: clean(r.transcript),
      action_tier: r.action_tier ?? null,
      priority_rank: Number.isFinite(r.priority_rank)
        ? r.priority_rank
        : null,
      frequency: Number.isFinite(r.frequency) ? r.frequency : null,
      ease: Number.isFinite(r.ease) ? r.ease : null,
      leader_to_unblock:
        typeof r.leader_to_unblock === "boolean"
          ? r.leader_to_unblock
          : false,
      team_energy: Number.isFinite(r.team_energy) ? r.team_energy : null,
    }));

    return res.json({ items });
  } catch (e) {
    console.error("GET /api/list error:", e);
    return res.status(500).json({ error: "list_failed" });
  }
});

// ---- UI WRITE ENDPOINTS (no /api prefix because the UI calls root paths) ----
// Create a new item
app.post("/items/new", async (req, res) => {
  try {
    const org = clean(req.query.org) || DEFAULT_ORG;
    const body = req.body || {};

    const title = clean(body.title) || "(untitled)";
    const user_id =
      clean(body.user_id) ||
      clean(req.headers["x-user-id"]) ||
      clean(req.headers["x-user"]) ||
      null;

    const insertRow = {
      org_slug: org,
      user_id,
      title,
      transcript: clean(body.transcript) || null,
      // allow UI to optionally include initial factors
      priority_rank:
        typeof body.priority_rank === "number" ? body.priority_rank : null,
      frequency: typeof body.frequency === "number" ? body.frequency : null,
      ease: typeof body.ease === "number" ? body.ease : null,
      team_energy:
        typeof body.team_energy === "number" ? body.team_energy : null,
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
    return res.status(404).json({ error: "add_failed" }); // UI expects 404->“save failed” toast
  }
});

// Update an item’s factor sliders
app.post("/items/:id/factors", async (req, res) => {
  try {
    const id = clean(req.params.id);
    if (!id) return res.status(400).json({ error: "bad_id" });

    const body = req.body || {};
    const patch = {};

    if (typeof body.customer_impact === "number")
      patch.priority_rank = body.customer_impact; // your UI names it customer_impact; DB uses priority_rank
    if (typeof body.team_energy === "number") patch.team_energy = body.team_energy;
    if (typeof body.frequency === "number") patch.frequency = body.frequency;
    if (typeof body.ease === "number") patch.ease = body.ease;

    if (Object.keys(patch).length === 0)
      return res.status(200).json({ ok: true }); // nothing to change

    const { error } = await supabase.from("items").update(patch).eq("id", id);

    if (error) throw error;

    return res.json({ ok: true });
  } catch (e) {
    console.error("POST /items/:id/factors error:", e);
    return res.status(404).json({ error: "save_failed" }); // UI expects 404->“save failed”
  }
});

// ---- START ----
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
