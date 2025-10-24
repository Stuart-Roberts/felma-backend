// Minimal Express + Supabase backend (defensive & UI-friendly)

const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 10000;

// ---- CORS ----
const ORIGIN = (process.env.CORS_ORIGIN || "").trim() || "*";
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: ORIGIN,
  })
);

// ---- Supabase ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!SUPABASE_URL || !ADMIN_KEY) {
  console.error("Missing SUPABASE_URL or ADMIN_KEY env var!");
}
const supabase = createClient(SUPABASE_URL, ADMIN_KEY);

const DEF_ORG = (process.env.DEFAULT_ORG || "").trim() || null;

// ---- helpers ----
const isUUID = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s || "");
const looksLikePhone = (s) => typeof s === "string" && s.replace(/[^\d+]/g, "").length >= 10;
const safeTitle = (t, transcript) => {
  const s = (t || "").toString().trim();
  if (s) return s.slice(0, 80);
  const tt = (transcript || "").toString().trim();
  if (tt) return tt.replace(/\s+/g, " ").slice(0, 80);
  return "(untitled)";
};
const numOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

async function getOrg(req) {
  return (req.query.org || DEF_ORG || "").toString().trim();
}

// find the current user (“me”) by phone/email/id
async function getMeProfile(org, meRaw) {
  const me = (meRaw || "").toString().trim();
  if (!me) return null;

  // try phone
  if (looksLikePhone(me)) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, phone, email, full_name, display_name")
      .eq("org_slug", org)
      .eq("phone", me)
      .limit(1)
      .maybeSingle();
    if (!error && data) return data;
  }

  // try email
  if (me.includes("@")) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, phone, email, full_name, display_name")
      .eq("org_slug", org)
      .eq("email", me)
      .limit(1)
      .maybeSingle();
    if (!error && data) return data;
  }

  // try exact id
  if (isUUID(me)) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, phone, email, full_name, display_name")
      .eq("org_slug", org)
      .eq("id", me)
      .limit(1)
      .maybeSingle();
    if (!error && data) return data;
  }

  return null;
}

// build a map of profile.id -> display_name and phone->display_name for an org
async function getProfileMaps(org) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, phone, display_name")
    .eq("org_slug", org);
  const idToName = new Map();
  const phoneToName = new Map();
  if (!error && Array.isArray(data)) {
    data.forEach((p) => {
      if (p?.id) idToName.set(p.id, p.display_name || null);
      if (p?.phone) phoneToName.set(p.phone, p.display_name || null);
    });
  }
  return { idToName, phoneToName };
}

// map DB row -> API item with fallbacks & “is_me”
function normalizeItem(row, { idToName, phoneToName }, meProfile, meRaw) {
  const title = safeTitle(row.title, row.transcript);
  const user_id = row.user_id ?? null;

  let originator_name = row.originator_name ?? null;
  if (!originator_name && user_id && isUUID(user_id) && idToName.has(user_id)) {
    originator_name = idToName.get(user_id);
  }
  if (!originator_name && looksLikePhone(user_id) && phoneToName.has(user_id)) {
    originator_name = phoneToName.get(user_id);
  }

  const meStr = (meRaw || "").toString().trim();
  const is_me =
    !!meProfile?.id && user_id && isUUID(user_id) && user_id === meProfile.id
      ? true
      : looksLikePhone(meStr) && user_id && looksLikePhone(user_id) && user_id === meStr
      ? true
      : false;

  return {
    id: row.id,
    created_at: row.created_at,
    org_slug: row.org_slug || row.org || null,
    user_id,
    title,
    transcript: row.transcript || null,
    action_tier: row.action_tier ?? null,
    priority_rank: row.priority_rank ?? null,
    frequency: row.frequency ?? null,
    ease: row.ease ?? null,
    leader_to_unblock: row.leader_to_unblock ?? row.leader_to_unlock ?? null, // tolerate old/new names
    originator_name: originator_name ?? null,
    is_me,
  };
}

// update helper that retries if a column doesn’t exist (42703)
async function safeUpdateItem(id, patch) {
  // map accidental field from UI
  if ("leader_to_unlock" in patch && !("leader_to_unblock" in patch)) {
    patch.leader_to_unblock = patch.leader_to_unlock;
    delete patch.leader_to_unlock;
  }

  // remove undefineds
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

  let fields = { ...patch };
  while (true) {
    if (!Object.keys(fields).length) {
      return { ok: true, data: null, removed: true }; // nothing left to update
    }
    const { data, error } = await supabase.from("items").update(fields).eq("id", id).select("id").maybeSingle();
    if (!error) return { ok: true, data };
    if (error.code === "42703") {
      // find missing column name and drop it, then retry
      const m = /column\s+(?:\w+\.)?"?([\w_]+)"?\s+does not exist/i.exec(error.message || "");
      if (m && fields[m[1]] !== undefined) {
        delete fields[m[1]];
        continue;
      }
    }
    return { ok: false, error };
  }
}

// ---- routes ----
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// list people (profiles)
app.get("/api/people", async (req, res) => {
  try {
    const org = await getOrg(req);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, phone, full_name, display_name, is_leader, org_slug")
      .eq("org_slug", org);

    if (error) throw error;

    const people = (data || []).map((p) => ({
      id: p.id,
      email: p.email || null,
      phone: p.phone || null,
      full_name: p.full_name || null,
      display_name: p.display_name || p.full_name || null,
      is_leader: !!p.is_leader,
      org_slug: p.org_slug || org,
    }));

    res.json({ people });
  } catch (err) {
    console.error("GET /api/people error:", err);
    res.status(500).json({ error: "people_failed" });
  }
});

// list items (ranked by default)
app.get("/api/list", async (req, res) => {
  const org = await getOrg(req);
  const me = (req.query.me || "").toString();

  try {
    // fetch items defensively (select * to avoid missing-column errors)
    let q = supabase.from("items").select("*").eq("org_slug", org);

    // default sort: priority_rank desc NULLS LAST, then created_at desc
    q = q.order("priority_rank", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });

    const [{ data: rows, error }, meProfile, maps] = await Promise.all([
      q,
      getMeProfile(org, me),
      getProfileMaps(org),
    ]);
    if (error) throw error;

    const items = (rows || []).map((r) => normalizeItem(r, maps, meProfile, me));
    res.json({ items });
  } catch (err) {
    console.error("GET /api/list error:", err);
    res.status(500).json({ error: "list_failed" });
  }
});

// create a new item
app.post("/api/items/new", async (req, res) => {
  try {
    const org = (req.body.org || req.query.org || DEF_ORG || "").toString().trim();
    const me = (req.body.me || req.query.me || "").toString().trim();
    const meProfile = await getMeProfile(org, me);

    const transcript = (req.body.transcript || "").toString();
    const title = safeTitle(req.body.title, transcript);

    const insertRow = {
      title,
      transcript: transcript || null,
      org_slug: org,
      user_id: meProfile?.id || (looksLikePhone(me) ? me : null),
    };

    const { data, error } = await supabase.from("items").insert(insertRow).select("id").single();
    if (error) throw error;

    res.json({ ok: true, id: data.id });
  } catch (err) {
    console.error("POST /api/items/new error:", err);
    res.status(500).json({ error: "add_failed" });
  }
});

// update factors / generic update (aliases to catch unknown UI routes)
async function handleUpdate(req, res, idFromPath) {
  try {
    const id = (idFromPath || req.body.id || req.query.id || "").toString();
    if (!isUUID(id)) return res.status(400).json({ error: "bad_id" });

    const patch = {
      // tolerate either name; we’ll remap in safeUpdateItem
      leader_to_unlock: req.body.leader_to_unlock,
      leader_to_unblock: req.body.leader_to_unblock,
      action_tier: req.body.action_tier,
      priority_rank: numOrNull(req.body.priority_rank),
      frequency: numOrNull(req.body.frequency),
      ease: numOrNull(req.body.ease),
      title: req.body.title,
      transcript: req.body.transcript,
    };

    const result = await safeUpdateItem(id, patch);
    if (!result.ok) {
      console.error("Update failed:", result.error);
      return res.status(500).json({ error: "save_failed" });
    }
    res.json({ ok: true, id });
  } catch (err) {
    console.error("POST update error:", err);
    res.status(500).json({ error: "save_failed" });
  }
}

// common aliases so your UI won’t 404
app.post("/api/items/save", (req, res) => handleUpdate(req, res, null));
app.post("/api/items/update", (req, res) => handleUpdate(req, res, null));
app.post("/api/save", (req, res) => handleUpdate(req, res, null));
app.post("/api/items/:id", (req, res) => handleUpdate(req, res, req.params.id));
app.post("/api/items/:id/factors", (req, res) => handleUpdate(req, res, req.params.id));

app.listen(PORT, () => {
  console.log(`felma-backend running on ${PORT}`);
});
