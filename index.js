// Minimal Express + Supabase backend for Render
// Uses Supabase HTTP client (no direct Postgres socket)

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
const DEFAULT_ORG = process.env.DEFAULT_ORG || "stmichaels";

// ---- CORS (single origin or open) ----
const app = express();
const allowOrigin = process.env.CORS_ORIGIN?.trim();
app.use(
  cors(
    allowOrigin
      ? { origin: allowOrigin, credentials: false }
      : { origin: true, credentials: false }
  )
);
app.use(express.json());

// ---- Supabase client (service role) ----
if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY env var!");
}
const sb = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Safe title from title/transcript
function makeTitle(title, transcript) {
  const t = (title || "").trim();
  if (t) return t.slice(0, 80);
  const fromTx = (transcript || "").trim().replace(/\s+/g, " ");
  return fromTx ? fromTx.slice(0, 80) : "(untitled)";
}

// ---- Routes ----
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/people", async (req, res) => {
  try {
    // profiles schema: id (uuid), email, phone, full_name, display_name
    const { data, error } = await sb
      .from("profiles")
      .select("id:uid, email, phone, full_name, display_name")
      .order("full_name", { ascending: true });

    if (error) throw error;
    res.json(
      (data || []).map((p) => ({
        id: p.id,
        name: p.display_name || p.full_name || p.email,
        email: p.email,
        phone: p.phone || "Unknown",
      }))
    );
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

app.get("/api/list", async (req, res) => {
  const org = (req.query.org || DEFAULT_ORG || "").trim();
  if (!org) return res.status(400).json({ error: "missing_org" });

  try {
    // NOTE: alias the *real* column leader_to_unblock -> leader_to_unlock
    // Also *only* select columns we know exist in your DB.
    const { data, error } = await sb
      .from("items")
      .select(
        [
          "id",
          "created_at",
          "org_slug",
          "user_id",
          "title",
          "transcript",
          "originator",
          "originator_name",
          "action_tier",
          "priority_rank",
          "frequency",
          "ease",
          "leader_to_unlock:leader_to_unblock",
        ].join(",")
      )
      .eq("org_slug", org)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rows = (data || []).map((r) => ({
      ...r,
      title: makeTitle(r.title, r.transcript),
    }));

    res.json(rows);
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
