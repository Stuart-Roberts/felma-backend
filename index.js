// index.js — CommonJS (require) so it runs with `node index.js` on Render
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : false,
});

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ---------- Rank + Tier logic ----------
function computePriorityRank(customer_impact, team_energy, frequency, ease) {
  const ci = Number(customer_impact || 0);
  const te = Number(team_energy || 0);
  const fr = Number(frequency || 0);
  const es = Number(ease || 0);
  const a = 0.57 * ci + 0.43 * te;
  const b = 0.6 * fr + 0.4 * es;
  return Math.round(a * b);
}
function tierForPR(pr) {
  if (pr >= 70) return "🔥 Make it happen";
  if (pr >= 50) return "🚀 Act on it now";
  if (pr >= 36) return "🧭 Move it forward";
  if (pr >= 25) return "🙂 When time allows";
  return "⚪ Park for later";
}
function shouldLeaderUnblock(team_energy, ease) {
  return Number(team_energy) >= 9 && Number(ease) <= 3;
}

// ---------- helpers ----------
function shortTitleFrom(transcript, fallback = "(untitled)") {
  const t = (transcript || "").trim().replace(/\s+/g, " ");
  if (!t) return fallback;
  return t.slice(0, 80);
}
function normPhone(s) {
  if (!s) return null;
  return String(s).replace(/[^\d+]/g, "");
}

// ---------- routes ----------
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// People directory (names for phones) — filter by org if provided
app.get("/api/people", async (req, res) => {
  const org = req.query.org || null;
  try {
    const { rows } = await pool.query(
      `
      select id, email, phone, display_name, is_leader, org_slug
      from public.profiles
      where ($1::text is null or org_slug = $1)
    `,
      [org]
    );
    res.json({ people: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Items list — returns title even if DB title is null/empty
app.get("/api/list", async (req, res) => {
  const org = req.query.org || null;
  try {
    const { rows } = await pool.query(
      `
      select
        id,
        created_at,
        coalesce(nullif(title,''), left(regexp_replace(btrim(coalesce(transcript,'')), '\\s+', ' ', 'g'), 80), '(untitled)') as title,
        "user",             -- legacy phone field (text)
        user_id,            -- future auth link
        priority_rank,
        action_tier,
        leader_to_unblock,
        customer_impact,
        team_energy,
        frequency,
        ease,
        org_slug
      from public.items
      where ($1::text is null or org_slug = $1)
      order by priority_rank desc nulls last, created_at desc
    `,
      [org]
    );
    res.json({ items: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create new item
app.post("/items/new", async (req, res) => {
  try {
    const org = req.body.org || req.query.org || "stmichaels";
    const user = normPhone(req.body.user) || null; // phone (pilot)
    const rawTitle = (req.body.title || "").trim();
    const transcript = (req.body.transcript || "").trim();
    const title = rawTitle || shortTitleFrom(transcript);

    const { rows } = await pool.query(
      `
      insert into public.items (title, transcript, "user", org_slug)
      values ($1, $2, $3, $4)
      returning id, created_at, title, "user", org_slug
    `,
      [title, transcript, user, org]
    );
    res.json({ ok: true, item: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Save 4 factors + derived rank/tier/unblock
app.post("/items/:id/factors", async (req, res) => {
  try {
    const id = req.params.id;
    const { customer_impact, team_energy, frequency, ease } = req.body;

    const pr = computePriorityRank(customer_impact, team_energy, frequency, ease);
    const tier = tierForPR(pr);
    const unblock = shouldLeaderUnblock(team_energy, ease);

    const { rows } = await pool.query(
      `
      update public.items
      set customer_impact = $2,
          team_energy     = $3,
          frequency       = $4,
          ease            = $5,
          priority_rank   = $6,
          action_tier     = $7,
          leader_to_unblock = $8
      where id = $1
      returning id, priority_rank, action_tier, leader_to_unblock,
                customer_impact, team_energy, frequency, ease
    `,
      [id, customer_impact, team_energy, frequency, ease, pr, tier, unblock]
    );
    res.json({ ok: true, item: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update title (originator-only by phone match, pilot rule)
app.post("/items/:id/title", async (req, res) => {
  try {
    const id = req.params.id;
    const requester = normPhone(req.body.user) || "";
    const title = (req.body.title || "").trim().slice(0, 80) || "(untitled)";

    const { rows: chk } = await pool.query(
      `select "user" from public.items where id = $1`,
      [id]
    );
    if (!chk.length) return res.status(404).json({ error: "Not found" });

    const origin = normPhone(chk[0].user);
    if (origin && requester && origin !== requester) {
      return res.status(403).json({ error: "Only originator can edit title (pilot rule)" });
    }

    const { rows } = await pool.query(
      `update public.items set title = $2 where id = $1 returning id, title`,
      [id, title]
    );
    res.json({ ok: true, item: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, () => {
  console.log("felma-backend running on", PORT);
});
