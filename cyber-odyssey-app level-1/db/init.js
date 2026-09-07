const fs = require("fs");
const path = require("path");
const { loadEnv } = require("../lib/loadEnv");

loadEnv();

const { pool } = require("../lib/db");

async function main() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");

  console.log("Applying database schema from db/schema.sql...");
  try {
    // gen_random_uuid() is built into PostgreSQL 13+. On 12 and earlier it comes
    // from pgcrypto, which needs an extension the connecting role may not be
    // allowed to create. Try, and carry on if not — the outbox reconciliation
    // query is the only thing that needs it, and it will fail loudly with a clear
    // message if the function really is absent.
    try {
      await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    } catch (extErr) {
      console.warn(
        "[INIT WARN] Could not ensure pgcrypto is available:",
        extErr.message,
        "\n           PostgreSQL 13+ has gen_random_uuid() built in, so this is",
        "usually harmless."
      );
    }

    // Pre-migration for pre-existing deployments: ensure columns exist before
    // schema.sql applies indexes that reference them (e.g. uq_teams_portal_ref).
    try {
      await pool.query(`
        ALTER TABLE teams ADD COLUMN IF NOT EXISTS portal_team_ref VARCHAR(64);
        ALTER TABLE teams ADD COLUMN IF NOT EXISTS track_a_attempts INTEGER DEFAULT 0;
        ALTER TABLE teams ADD COLUMN IF NOT EXISTS track_b_attempts INTEGER DEFAULT 0;
        ALTER TABLE teams ADD COLUMN IF NOT EXISTS track_c_attempts INTEGER DEFAULT 0;
      `);
    } catch {
      // Table does not exist yet; schema.sql will create it with all columns
    }

    await pool.query(sql);
    // Backward compatibility & per-track migration
    await pool.query(`
      ALTER TABLE teams ADD COLUMN IF NOT EXISTS track_a_attempts INTEGER DEFAULT 0;
      ALTER TABLE teams ADD COLUMN IF NOT EXISTS track_b_attempts INTEGER DEFAULT 0;
      ALTER TABLE teams ADD COLUMN IF NOT EXISTS track_c_attempts INTEGER DEFAULT 0;
      UPDATE teams SET
        track_a_attempts = COALESCE(track_a_attempts, stage1_attempts, 0),
        track_b_attempts = COALESCE(track_b_attempts, stage2_attempts, 0),
        track_c_attempts = COALESCE(track_c_attempts, final_attempts, 0);
    `);

    // Portal integration (Phase 1). Additive and idempotent, in keeping with the
    // rest of this file: an existing deployment gains the column and the outbox
    // without any row being rewritten and without any existing team being
    // disturbed. A team that has no Portal counterpart keeps a NULL reference and
    // carries on exactly as before.
    //
    // ADD COLUMN IF NOT EXISTS on a nullable column with no default is a metadata
    // change in PostgreSQL — it does not rewrite the table and does not take a
    // long lock, so it is safe to run against a live event database.
    await pool.query(`
      ALTER TABLE teams ADD COLUMN IF NOT EXISTS portal_team_ref VARCHAR(64);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_portal_ref
        ON teams (portal_team_ref) WHERE portal_team_ref IS NOT NULL;
    `);
    console.log("Database schema applied successfully.");
  } catch (err) {
    console.error("Failed to apply database schema:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
