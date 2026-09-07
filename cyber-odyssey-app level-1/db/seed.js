const fs = require("fs");
const path = require("path");
const { loadEnv } = require("../lib/loadEnv");

loadEnv();

const { pool } = require("../lib/db");
const { newTeamCode } = require("../lib/codes");
const { DEFAULTS } = require("../lib/config");

const crypto = require("crypto");
const TEAM_COUNT = parseInt(process.env.TEAM_COUNT || "60", 10);

/**
 * Every team gets its OWN password.
 *
 * This used to be one shared value with a public default in this file
 * (`process.env.DEFAULT_TEAM_PASSWORD || "odyssey2026"`). Combined with
 * `authenticateTeam`, which accepts a team NAME, and names that run "Crew 01"
 * through "Crew 60", one constant in the source was enough to sign in as any
 * crew in the event.
 *
 * Distinct random passwords change nothing about how the event is run — the
 * codes and passwords are still written to team-codes.csv for the organiser to
 * hand out — but a crew who learns one password learns exactly one team's.
 *
 * Set DEFAULT_TEAM_PASSWORD to force a single shared password anyway (useful for
 * a throwaway local run). It is not a default and it is announced when used.
 */
const FORCED_PASSWORD = String(process.env.DEFAULT_TEAM_PASSWORD || "").trim();

function newTeamPassword() {
  if (FORCED_PASSWORD) return FORCED_PASSWORD;
  // 8 chars from an unambiguous alphabet: read aloud in a noisy room, typed
  // once, and still ~40 bits — far beyond guessing inside an event window.
  const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let out = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function hashPassword(pw) {
  return crypto.createHash("sha256").update(String(pw).trim()).digest("hex");
}

async function main() {
  console.log(`Seeding database (TEAM_COUNT=${TEAM_COUNT})...`);

  try {
    // 1. Seed default config
    console.log("Setting default config...");
    for (const [key, value] of Object.entries(DEFAULTS)) {
      await pool.query(
        `INSERT INTO config (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [key, String(value)]
      );
    }

    // 2. Generate and insert teams
    console.log(`Generating ${TEAM_COUNT} team codes...`);
    const codes = new Set();
    while (codes.size < TEAM_COUNT) {
      codes.add(newTeamCode());
    }

    const teamList = Array.from(codes);
    const csvRows = ["id,code,name,password"];

    if (FORCED_PASSWORD) {
      console.warn(
        "[seed] DEFAULT_TEAM_PASSWORD is set, so every team shares one password. " +
          "Do not do this for a real event."
      );
    }

    for (let i = 0; i < teamList.length; i++) {
      const code = teamList[i];
      const name = `Crew ${String(i + 1).padStart(2, "0")}`;
      const password = newTeamPassword();
      const { rows } = await pool.query(
        `INSERT INTO teams (code, name, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING
         RETURNING id, code, name`,
        [code, name, hashPassword(password)]
      );
      if (rows[0]) {
        csvRows.push(`${rows[0].id},${rows[0].code},${rows[0].name},${password}`);
      }
    }

    const csvPath = path.join(__dirname, "..", "team-codes.csv");
    fs.writeFileSync(csvPath, csvRows.join("\n"), "utf8");
    console.log(`Seeding complete. Wrote ${teamList.length} teams with passwords to team-codes.csv`);

    // 3. Create/verify exactly the 5 local test teams (idempotent)
    console.log("Seeding 5 local test teams...");
    const testTeams = [
      { name: "ACN Test Team 01", code: "ACN01", password: "ACNtest@01", portalTeamRef: "co_00000000000000000000000000000001" },
      { name: "ACN Test Team 02", code: "ACN02", password: "ACNtest@02", portalTeamRef: "co_00000000000000000000000000000002" },
      { name: "ACN Test Team 03", code: "ACN03", password: "ACNtest@03", portalTeamRef: "co_00000000000000000000000000000003" },
      { name: "ACN Test Team 04", code: "ACN04", password: "ACNtest@04", portalTeamRef: "co_00000000000000000000000000000004" },
      { name: "ACN Test Team 05", code: "ACN05", password: "ACNtest@05", portalTeamRef: "co_00000000000000000000000000000005" },
    ];

    // Clean up any legacy test codes to keep database clean
    await pool.query("DELETE FROM teams WHERE code IN ('TEST01', 'TEST02', 'TEST03')");

    for (const tt of testTeams) {
      const hash = hashPassword(tt.password);
      // Ensure no duplicate team name exists under a different code
      await pool.query("DELETE FROM teams WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND code != $2", [tt.name, tt.code]);
      // Clear any conflicting row holding this portal_team_ref under a different code
      await pool.query("DELETE FROM teams WHERE portal_team_ref = $1 AND code != $2", [tt.portalTeamRef, tt.code]);
      await pool.query(
        `INSERT INTO teams (code, name, password_hash, portal_team_ref)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, portal_team_ref = EXCLUDED.portal_team_ref`,
        [tt.code, tt.name, hash, tt.portalTeamRef]
      );
    }
    console.log("5 local test teams seeded successfully with matching Portal references.");
  } catch (err) {
    console.error("Seeding failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
