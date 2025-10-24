// Defensive Express + Supabase backend with dual response shapes
// Default shape: objects { items: [...] }, { people: [...] }
// Opt-in array shape: add ?array=1 (returns bare arrays)

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;

// --- CORS (single origin recommended) ---
const ALLOWED = process.env.CORS_ORIGIN?.trim();
const corsOptions = ALLOWED ? { origin: ALLOWED, credentials: true } : {};
const app = express();
app.use(express.json());
app.use(cors(corsOptions));

// --- Required envs ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY env var(s).");
}
const supabase = createClient(SUPABASE_URL, ADMIN_KEY);

// --- Helpers ---
function makeTitle(item) {
  const t = (item?.title || "").trim();
  if (t) return t.slice(0, 80);
  const tr = (item?.transcript || "").trim();
  if (tr) return tr.replace(/\s+/g, " ").slice(0, 80);
  return "(untitled)";
}

function maybeArray(req, value) {
  // If caller adds ?array=1 we return a bare array for compatibility
  return req.query.array === "1" ? value : undefined;
}

// --- Routes ---
app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true });
});

// PEOPLE: minimal assumptions about schema; map to stable keys
app.get("/api/people", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,email,phone,full_name,display_name");

    if (error) throw error;

    const ppl = (data || []).map((p) => ({
      id: p.id ?? null,
      email: p.email ?? null,
      phone: p.phone ?? null,
      full_name: p.full_name ?? null,
      display_name: p.display_name ?? null,
    }));

    const arr = maybeArray(req, ppl);
    res.set("Cache-Control", "no-store");
    if (arr) return res.json(arr);
    return res.json({ people: ppl });
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

// ITEMS: guarantee title and a best-effort originator_name; default wrapped
app.get("/api/list", async (req, res) => {
  const org = (req.query.org || process.env.DEFAULT_ORG || "").trim();
  if (!org) return res.status(400).json({ error: "missing_org" });

  try {
    const { data, error } = await supabase
      .from("items")
      .select("*")
      .eq("org_slug", org)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rows = (data || []).map((row) => ({
      ...row,
      title: makeTitle(row),
      originator_name:
        row.originator_name ??
        row.originator ??
        row.created_by_name ??
        null,
    }));

    const arr = maybeArray(req, rows);
    res.set("Cache-Control", "no-store");
    if (arr) return res.json(arr);
    return res.json({ items: rows, count: rows.length });
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

// --- Boot ---
app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
