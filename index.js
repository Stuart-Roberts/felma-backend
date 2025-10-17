// index.js — Felma backend (drop-in, definitive item route)
// Endpoints:
// - GET  /check
// - GET  /
// - POST /voice
// - POST /sms
// - GET  /api/list
// - GET  /api/item/:id          (defensive, logs, works with UUID strings)
// - GET  /api/item/:id/raw      (full-row debug view)
// - GET  /api/ping-supabase     (connectivity/count check)

const express = require("express");
const compression = require("compression");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();

// Middleware
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  cors({
    origin: [
      /^http:\/\/localhost:517\d$/,           // Vite dev (5173/5174/5175…)
      /^https?:\/\/.*onrender\.com$/,         // Render-hosted frontends
      /^https?:\/\/.*ngrok.*\.dev$/,          // ngrok tunnels
    ],
    methods: ["GET", "POST", "OPTIONS"],
  })
);

// Supabase
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY in .env");
  process.exit(1);
}
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ------------------- Helpers -------------------
const actionTier = (pr) => {
  if (pr >= 40) return "🚀 Move now";
  if (pr >= 30) return "🧭 Move it forward";
  if (pr >= 20) return "🙂 When time allows";
  return "—";
};

const computePriorityRank = ({ customer_impact, team_energy, frequency, ease }) => {
  const a = 0.57 * Number(customer_impact || 0) + 0.43 * Number(team_energy || 0);
  const b = 0.6 * Number(frequency || 0) + 0.4 * Number(ease || 0);
  return Math.round(a * b);
};
const leaderToUnblock = (te, ez) => Number(te) >= 9 && Number(ez) <= 3;
const inRange1to10 = (n) => Number.isFinite(n) && n >= 1 && n <= 10;

// ------------------- Health -------------------
app.get("/", (_req, res) => res.send("Felma server is running."));
app.get("/check", (_req, res) => res.send("ok: felma drop-in v2"));

// ------------------- Twilio webhooks -------------------
app.post("/voice", async (req, res) => {
  // Twilio hits this when a call comes in
  // We play a short prompt and ask for one keypress
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hi. This is Felma. Press 1 to log this call as a new item. Press 2 to skip logging.</Say>
  <Gather input="dtmf" numDigits="1" action="/voice/handle" method="POST" timeout="5" />
  <Say>No input received. Goodbye.</Say>
  <Hangup/>
</Response>`;
  res.set("Content-Type", "text/xml");
  res.send(twiml);
});

app.post("/sms", async (req, res) => {
  const from = req.body?.From || "unknown";
  const body = (req.body?.Body || "").trim();
  const lower = body.toLowerCase();

  if (["stop", "stop all", "end", "unsubscribe", "cancel", "quit"].includes(lower)) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Got it — you can text START anytime if you want to use Felma again.</Message></Response>`;
    res.set("Content-Type", "text/xml");
    return res.send(xml);
  }
  if (lower === "help") {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>You can text Felma any time with what you’ve noticed. We’ll log it and you’ll see it in your team’s list. Reply STOP to opt out.</Message></Response>`;
    res.set("Content-Type", "text/xml");
    return res.send(xml);
  }

  await supabase.from("items").insert({
    user_id: from,
    transcript: body,
    response: "Felma received your text and logged it.",
  });

  const reply = `Thanks — I’ve logged that. If you want, text 'NEXT' to capture steps, or 'OPEN' to open your items in the app.`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${reply}</Message></Response>`;
  res.set("Content-Type", "text/xml");
  res.send(xml);
});

app.post("/voice/handle", async (req, res) => {
  const from = req.body?.From || "unknown";
  const digits = (req.body?.Digits || "").trim();

  let say;
  try {
    if (digits === "1") {
      // Log a simple item so you can see it in your list
      await supabase.from("items").insert({
        user_id: from,
        item_title: "Voice: key 1 pressed",
        transcript: null,
        response: "Call logged via keypress.",
      });
      say = "Got it. I have logged your call as an item. Thank you. Goodbye.";
    } else if (digits === "2") {
      say = "Okay. No item logged this time. Thank you. Goodbye.";
    } else {
      say = "Sorry, I did not get that. Please try again next time. Goodbye.";
    }
  } catch (e) {
    say = "I hit a problem saving that. Please try again later. Goodbye.";
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${say}</Say>
  <Hangup/>
</Response>`;
  res.set("Content-Type", "text/xml");
  res.send(twiml);
});

// ------------------- React UI APIs -------------------

// List (minimal)
app.get("/api/list", async (_req, res) => {
  const { data, error } = await supabase
    .from("items")
    .select("id,item_title,transcript,created_at,priority_rank,action_tier,leader_to_unblock")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[LIST] error:", error);
    return res.status(500).json({ error: error.message });
  }

  const list = (data || []).map((row) => ({
    id: row.id,
    title: row.item_title || row.transcript || "(untitled)",
    created_at: row.created_at,
    priority_rank: row.priority_rank ?? null,
    action_tier: row.action_tier ?? "—",
    leader_to_unblock: !!row.leader_to_unblock,
  }));

  res.json(list);
});

// Detail (definitive)
const DETAIL_COLUMNS =
  "id,item_title,item_type,transcript,created_at,customer_impact,team_energy,frequency,ease,priority_rank,action_tier,leader_to_unblock,user_next_step,story_json,status";

app.get("/api/item/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    console.log("[DETAIL] requested id =", id);

    // Query with limit(1), return first element explicitly
    const { data, error } = await supabase
      .from("items")
      .select(DETAIL_COLUMNS)
      .eq("id", id)
      .limit(1);

    if (error) {
      console.error("[DETAIL] query error:", error);
      return res.status(500).json({ error: error.message, code: error.code || "query_error", id });
    }

    const row = Array.isArray(data) && data.length ? data[0] : null;
    if (!row) {
      console.warn("[DETAIL] no row found for id:", id);
      return res.status(404).json({ error: "Not found", id });
    }

    return res.json(row);
  } catch (e) {
    console.error("[DETAIL] unexpected error:", e);
    return res.status(500).json({ error: String(e) });
  }
});

// Raw (debug) — use if needed
app.get("/api/item/:id/raw", async (req, res) => {
  const id = String(req.params.id || "").trim();
  const { data, error } = await supabase.from("items").select("*").eq("id", id).limit(1);
  if (error) return res.status(500).json({ error: error.message, id });
  return res.json(Array.isArray(data) && data.length ? data[0] : null);
});

// Save 4-factor ranking
app.post("/items/:id/factors", async (req, res) => {
  const id = req.params.id;
  const CI = Number(req.body?.customer_impact);
  const TE = Number(req.body?.team_energy);
  const FQ = Number(req.body?.frequency);
  const EZ = Number(req.body?.ease);
  const next = req.body?.user_next_step ?? null;

  if (![CI, TE, FQ, EZ].every(inRange1to10)) {
    return res.status(400).json({ error: "All factors must be numbers in the range 1..10" });
  }

  const pr = computePriorityRank({ customer_impact: CI, team_energy: TE, frequency: FQ, ease: EZ });
  const tier = actionTier(pr);
  const unblock = leaderToUnblock(TE, EZ);

  const update = {
    customer_impact: CI,
    team_energy: TE,
    frequency: FQ,
    ease: EZ,
    priority_rank: pr,
    action_tier: tier,
    leader_to_unblock: unblock,
    updated_at: new Date().toISOString(),
  };
  if (typeof next === "string") update.user_next_step = next;

  const { error } = await supabase.from("items").update(update).eq("id", id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true, priority_rank: pr, action_tier: tier, leader_to_unblock: unblock });
});

// ------------------- Start -------------------
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`✅ Felma server running on http://localhost:${port}`);
});