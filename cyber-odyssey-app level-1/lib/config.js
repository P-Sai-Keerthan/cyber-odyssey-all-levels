const { query } = require("./db");

// Defaults exist so the application starts cleanly even before the database
// is seeded. Production values should be initialized via `npm run db:seed`
// or updated via the Level 1 Admin dashboard.
const DEFAULTS = {
  stage1_code: "3719",
  // "OUTIS" — Greek for "Nobody," the name Odysseus gives Polyphemus before
  // blinding him. When the other Cyclopes ask who's hurting him, he shouts
  // "Nobody is hurting me!" and gets no help. A small nod for anyone who
  // catches it; nobody who doesn't needs to — they just relay whatever word
  // the Cyclops lets slip.
  stage2_secret_word: "OUTIS",
  round2_address: "TBD — set this before the event starts",
  // admin_password is DELIBERATELY ABSENT.
  //
  // It used to default to a literal here, and `db:seed` wrote that literal into
  // the config table. Removing the fallback from pages/api/admin/login.js was
  // therefore not enough: the route read the seeded row and the published
  // password kept working. A default admin credential that ships in source is a
  // one-line path from "read the repository" to "reset the event".
  //
  // The password now comes from ADMIN_PASSWORD in the environment, or from a row
  // an operator sets deliberately through the admin dashboard. Neither is a
  // value anyone can look up. If neither exists, sign-in fails closed with 503.
  event_start_at: "", // empty = event hasn't been started yet
  event_duration_minutes: "45",
  event_state: "not_started", // "not_started" | "running" | "paused" | "ended"
  event_paused_at: "", // ISO timestamp when pause occurred
  event_paused_ms: "0", // Total milliseconds spent in pause
};

const globalForConfig = global;
const CACHE_TTL_MS = 2000;

function getConfigCache() {
  return globalForConfig.__cyberOdysseyConfigCache || null;
}

function setConfigCache(cache, time) {
  globalForConfig.__cyberOdysseyConfigCache = cache;
  globalForConfig.__cyberOdysseyConfigCacheTime = time;
}

function clearConfigCache() {
  globalForConfig.__cyberOdysseyConfigCache = null;
  globalForConfig.__cyberOdysseyConfigCacheTime = 0;
}

async function getConfig(key) {
  const all = await getAllConfig();
  return all[key] ?? null;
}

async function getAllConfig() {
  const now = Date.now();
  const cached = getConfigCache();
  const cacheTime = globalForConfig.__cyberOdysseyConfigCacheTime || 0;
  if (cached && now - cacheTime < CACHE_TTL_MS) {
    return { ...cached };
  }

  try {
    const { rows } = await query("SELECT key, value FROM config");
    const out = { ...DEFAULTS };
    for (const row of rows) out[row.key] = row.value;

    setConfigCache(out, now);
    return { ...out };
  } catch (err) {
    console.warn("[CONFIG WARN] Could not read from database config table, using defaults:", err.message);
    if (cached) return { ...cached };
    return { ...DEFAULTS };
  }
}

async function setConfig(key, value) {
  await query(
    `INSERT INTO config (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
  clearConfigCache();
}

module.exports = { getConfig, getAllConfig, setConfig, clearConfigCache, DEFAULTS };
