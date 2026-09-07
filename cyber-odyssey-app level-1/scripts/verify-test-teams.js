const { loadEnv } = require("../lib/loadEnv");
loadEnv();

const { authenticateTeam, getTeamByName } = require("../lib/teams");
const { getAllConfig } = require("../lib/config");

async function verify() {
  console.log("=== VERIFYING TEST TEAMS & AUTHENTICATION ===");

  const testTeams = [
    { name: "ACN Test Team 01", pass: "ACNtest@01" },
    { name: "ACN Test Team 02", pass: "ACNtest@02" },
    { name: "ACN Test Team 03", pass: "ACNtest@03" },
    { name: "ACN Test Team 04", pass: "ACNtest@04" },
    { name: "ACN Test Team 05", pass: "ACNtest@05" },
  ];

  for (const { name, pass } of testTeams) {
    const team = await getTeamByName(name);
    if (!team) {
      console.error(`[FAIL] ${name} not found in database.`);
      process.exit(1);
    }
    console.log(`[PASS] Found in DB: ${team.name} (Code: ${team.code}, ID: ${team.id})`);

    // Verify correct password
    const authSuccess = await authenticateTeam(name, pass);
    if (!authSuccess) {
      console.error(`[FAIL] Authentication failed for ${name} with password '${pass}'.`);
      process.exit(1);
    }
    console.log(`[PASS] Correct password login succeeded for ${name}.`);

    // Verify case-insensitive matching
    const caseMatch = await authenticateTeam(`  ${name.toLowerCase()}  `, pass);
    if (!caseMatch) {
      console.error(`[FAIL] Case-insensitive login failed for ${name}.`);
      process.exit(1);
    }
    console.log(`[PASS] Case-insensitive & trimmed login succeeded for ${name}.`);

    // Verify wrong password
    const authWrong = await authenticateTeam(name, "wrongpassword999");
    if (authWrong) {
      console.error(`[FAIL] Wrong password succeeded for ${name}!`);
      process.exit(1);
    }
    console.log(`[PASS] Wrong password cleanly rejected for ${name}.`);
  }

  // Unknown team
  const unknown = await authenticateTeam("Nonexistent Team", "test1234");
  if (unknown) {
    console.error("[FAIL] Unknown team succeeded!");
    process.exit(1);
  }
  console.log("[PASS] Unknown team cleanly rejected.");

  // Config check
  const cfg = await getAllConfig();
  console.log(`[PASS] Database config table read successfully.`);
  console.log(`[INFO] event_duration_minutes: ${cfg.event_duration_minutes}`);
  console.log(`[INFO] event_state: ${cfg.event_state}`);

  process.exit(0);
}

verify().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
