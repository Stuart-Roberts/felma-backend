// Minimal, defensive API for Felma (Supabase HTTP client, no pg socket)
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
const DEFAULT_ORG = process.env.DEFAULT_ORG || "stmichaels";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY environment variable.");
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN,
    credentials: false,
  })
);

function sb() {
  return createClient(SUPABASE_URL, ADMIN_KEY, {
    auth: { persistSession: false },
  });
}

function safeInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeTitle(t, transcript) {
  const s = (t || "").toString().trim();
  if (s) return s.slice(0, 120);
  const tt = (transcript || "").toString().trim();
  return tt ? tt.slice(0, 120) : "(untitled)";
}

// ---------- health
app.get(["/api/health", "/health"], (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ---------- people (profiles)
app.get(["/api/people", "/people"], async (_req, res) => {
  try {
    const supabase = sb();
    // Be defensive about column names; prefer "id" and allow "uid"
    const { data, error } = await supabase
      .from("profiles")
      .select("id, uid, email, phone, full_name, display_name");

    if (error) throw error;

    const people =
      data?.map((r) => ({
        id: r.id || r.uid || null,
        uid: r.id || r.uid || null,
        email: r.email || null,
        phone: r.phone || null,
        full_name: r.full_name || null,
        display_name:
          r.display_name || r.full_name || r.email || r.phone || "Unknown",
      })) ?? [];

    res.json({ people });
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

// ---------- list items
app.get(["/api/list", "/items"], async (req, res) => {
  const org = (req.query.org || DEFAULT_ORG || "").toString().trim();
  try {
    const supabase = sb();

    // Pull a broad set of columns; tolerate if some don’t exist (nulls)
    const { data, error } = await supabase
      .from("items")
      .select(
        [
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
          "leader_to_unblock", // tolerate missing
          "team_energy", // tolerate missing
        ].join(",")
      )
      .eq("org_slug", org)
      .order("priority_rank", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) throw error;

    const items =
      data?.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        org_slug: r.org_slug,
        user_id: r.user_id ?? null,
        originator_name: r.originator_name ?? null,
        title: safeTitle(r.title, r.transcript),
        transcript: r.transcript ?? null,
        action_tier: r.action_tier ?? null,
        priority_rank: safeInt(r.priority_rank),
        frequency: safeInt(r.frequency),
        ease: safeInt(r.ease),
        leader_to_unblock:
          r.leader_to_unblock === undefined ? null : r.leader_to_unblock,
        team_energy: safeInt(r.team_energy),
      })) ?? [];

    res.json({ items });
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

// ---------- get factors for one item (UI calls GET /items/:id/factors)
app.get(["/api/items/:id/factors", "/items/:id/factors"], async (req, res) => {
  const { id } = req.params;
  try {
    const supabase = sb();
    const { data, error } = await supabase
      .from("items")
      .select("team_energy, frequency, ease, priority_rank")
      .eq("id", id)
      .single();

    if (error) {
      // If not found or column missing, return safe defaults
      console.warn("GET factors fallback:", error.message);
      return res.json({
        team_energy: null,
        frequency: null,
        ease: null,
        priority_rank: null,
      });
    }

    res.json({
      team_energy:
        data?.team_energy === undefined ? null : safeInt(data.team_energy),
      frequency:
        data?.frequency === undefined ? null : safeInt(data.frequency),
      ease: data?.ease === undefined ? null : safeInt(data.ease),
      priority_rank:
        data?.priority_rank === undefined ? null : safeInt(data.priority_rank),
    });
  } catch (err) {
    console.error("GET /items/:id/factors error:", err);
    res.status(500).json({ error: "factors_failed" });
  }
});

// ---------- update factors (UI saves here)
app.post(["/api/items/:id/factors", "/items/:id/factors"], async (req, res) => {
  const { id } = req.params;
  // Accept any shape, coerce to ints
  const team_energy = safeInt(req.body?.team_energy);
  const frequency = safeInt(req.body?.frequency);
  const ease = safeInt(req.body?.ease);
  const priority_rank = safeInt(req.body?.priority_rank);

  const payload = {};
  if (team_energy !== null) payload.team_energy = team_energy;
  if (frequency !== null) payload.frequency = frequency;
  if (ease !== null) payload.ease = ease;
  if (priority_rank !== null) payload.priority_rank = priority_rank;

  try {
    if (!Object.keys(payload).length) {
      return res.json({ ok: true, updated: 0 });
    }

    const supabase = sb();
    const { error } = await supabase.from("items").update(payload).eq("id", id);
    if (error) throw error;

    res.json({ ok: true, updated: 1 });
  } catch (err) {
    console.error("POST /items/:id/factors error:", err);
    res.status(500).json({ error: "save_factors_failed" });
  }
});

// ---------- create new item (UI posts to /items/new)
app.post(["/api/items/new", "/items/new"], async (req, res) => {
  try {
    const supabase = sb();

    const org =
      (req.query.org ||
        req.body?.org ||
        req.body?.org_slug ||
        DEFAULT_ORG) + "";
    const title = safeTitle(req.body?.title, req.body?.transcript);
    const transcript = (req.body?.transcript || "").toString().trim() || null;

    // Optional metadata from UI
    const originator_name =
      (req.body?.originator_name || req.body?.user_name || "").trim() || null;
    const user_id =
      (req.body?.user_id || req.body?.phone || req.body?.uid || "").trim() ||
      null;

    const team_energy = safeInt(req.body?.team_energy);
    const frequency = safeInt(req.body?.frequency);
    const ease = safeInt(req.body?.ease);
    const priority_rank = safeInt(req.body?.priority_rank);

    const row = {
      org_slug: org,
      title,
      transcript,
      originator_name,
      user_id,
      team_energy,
      frequency,
      ease,
      priority_rank,
    };

    // Remove undefined keys
    Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);

    const { data, error } = await supabase
      .from("items")
      .insert(row)
      .select("id")
      .single();

    if (error) throw error;

    res.status(201).json({ ok: true, id: data?.id });
  } catch (err) {
    console.error("POST /items/new error:", err);
    res.status(500).json({ error: "add_failed" });
  }
});

// ---------- update basic fields (title/transcript) if UI sends it
app.put(["/api/items/:id", "/items/:id"], async (req, res) => {
  const { id } = req.params;
  try {
    const payload = {};
    if (typeof req.body?.title === "string")
      payload.title = safeTitle(req.body.title, req.body.transcript);
    if (typeof req.body?.transcript === "string")
      payload.transcript = req.body.transcript;

    if (!Object.keys(payload).length) {
      return res.json({ ok: true, updated: 0 });
    }

    const supabase = sb();
    const { error } = await supabase.from("items").update(payload).eq("id", id);
    if (error) throw error;

    res.json({ ok: true, updated: 1 });
  } catch (err) {
    console.error("PUT /items/:id error:", err);
    res.status(500).json({ error: "update_failed" });
  }
});

// ---------- fallback
app.use((_req, res) => res.status(404).send("Not found"));

app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
