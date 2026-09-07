const net = require("net");
const dns = require("dns").promises;
const { URL } = require("url");
const { loadEnv } = require("../lib/loadEnv");

loadEnv();

const { pool, getValidatedDatabaseUrl } = require("../lib/db");

async function runDiagnostics() {
  console.log("=== DATABASE CONFIGURATION & CONNECTIVITY DIAGNOSTICS ===");

  // 1. Verify DATABASE_URL exists and loaded
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    console.error("[FAIL] DATABASE_URL does not exist in environment.");
    process.exit(1);
  }
  console.log("[PASS] DATABASE_URL exists and is loaded.");

  let validatedUrl;
  try {
    validatedUrl = getValidatedDatabaseUrl();
    console.log("[PASS] getValidatedDatabaseUrl() succeeded without Supabase fallback.");
  } catch (err) {
    console.error("[FAIL] Validation failed:", err.message);
    process.exit(1);
  }

  // Parse URL safely without logging credentials
  let parsed;
  try {
    parsed = new URL(validatedUrl);
  } catch (e) {
    console.error("[FAIL] Could not parse DATABASE_URL as URL:", e.message);
    process.exit(1);
  }

  const hostname = parsed.hostname;
  const port = parseInt(parsed.port || "5432", 10);
  const dbName = parsed.pathname ? parsed.pathname.replace(/^\//, "") : "";

  console.log(`[INFO] Target Hostname: ${hostname}`);
  console.log(`[INFO] Target Port: ${port}`);
  console.log(`[INFO] Target Database: ${dbName}`);

  // 2. DNS resolution
  try {
    const lookup = await dns.lookup(hostname);
    console.log(`[PASS] DNS Resolution: ${hostname} -> ${lookup.address} (family: IPv${lookup.family})`);
  } catch (dnsErr) {
    console.error(`[FAIL] DNS Resolution failed for ${hostname}:`, dnsErr.message);
    process.exit(1);
  }

  // 3. TCP connectivity
  await new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(4000);
    socket.on("connect", () => {
      console.log(`[PASS] TCP Connectivity: Successfully connected to ${hostname}:${port}`);
      socket.destroy();
      resolve();
    });
    socket.on("timeout", () => {
      socket.destroy();
      console.error(`[FAIL] TCP Connectivity timeout connecting to ${hostname}:${port}`);
      reject(new Error("TCP timeout"));
    });
    socket.on("error", (err) => {
      socket.destroy();
      console.error(`[FAIL] TCP Connectivity error:`, err.message);
      reject(err);
    });
    socket.connect(port, hostname);
  });

  // 4. PostgreSQL Connection & SELECT 1
  try {
    const res = await pool.query("SELECT 1 AS num, current_database() AS db_name, version() AS pg_version");
    console.log("[PASS] PostgreSQL connection succeeded.");
    console.log(`[PASS] SELECT 1 returned: ${res.rows[0].num}`);
    console.log(`[PASS] Current Database Name: ${res.rows[0].db_name}`);
    console.log(`[INFO] PostgreSQL Version: ${res.rows[0].pg_version.split("\n")[0]}`);
  } catch (pgErr) {
    console.error("[FAIL] PostgreSQL query failed:", pgErr.message);
    process.exit(1);
  }

  // 5. Inspect expected tables
  try {
    const tableRes = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    const existingTables = tableRes.rows.map((r) => r.table_name);
    console.log("[INFO] Existing public tables:", existingTables.length ? existingTables.join(", ") : "(none)");

    const expected = ["config", "teams", "track_answers", "chat_logs"];
    const missing = expected.filter((t) => !existingTables.includes(t));
    if (missing.length === 0) {
      console.log("[PASS] All expected tables exist: config, teams, track_answers, chat_logs.");
    } else {
      console.log(`[WARN] Missing expected tables: ${missing.join(", ")}. Schema needs to be applied.`);
    }
  } catch (err) {
    console.error("[FAIL] Failed to inspect tables:", err.message);
  } finally {
    await pool.end();
  }
}

runDiagnostics().catch((err) => {
  console.error("Diagnostic execution error:", err);
  process.exit(1);
});
