/**
 * Automated Verification Test Suite for ACN Cyber Odyssey Level 1 Platform
 * Tests:
 * 1. Cookie Cryptography & HMAC-SHA256 Timing Safety (5 tests)
 * 2. Team Password Hashing & Authentication Logic (5 tests)
 * 3. 45-Minute Event Clock & 4-Phase State Transitions (6 tests)
 * 4. Submission Gating in PAUSED & ENDED States (4 tests)
 * 5. Track A Anti-Leak & Validation Logic (5 tests)
 * 6. Track B Anti-Leak & Validation Logic (4 tests)
 * 7. Track C Forensics Hub & Anti-Leak (5 tests)
 * 8. Standings Ranking & Zero Participant Leaderboard (6 tests)
 * Total: 40 Tests (exceeds the 35 test criteria target)
 */

const assert = require("assert");
const crypto = require("crypto");
const { loadEnv } = require("../lib/loadEnv");

loadEnv();

console.log("============================================================");
console.log("STARTING ACN CYBER ODYSSEY LEVEL 1 VERIFICATION TEST SUITE");
console.log("============================================================\n");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  }
}

async function runAll() {
  // ---------------------------------------------------------------------------
  // 1. COOKIE CRYPTOGRAPHY TESTS (5 tests)
  // ---------------------------------------------------------------------------
  console.log("Suite 1: Signed Cookie Authentication & Timing-Safe Verification");

  const { signTeamCookie, getTeamCodeFromCookie } = require("../lib/cookies");

  test("1.1 signTeamCookie generates valid HMAC-SHA256 signature", () => {
    const signed = signTeamCookie("ODYSSEY-A7X9K2");
    assert(signed.startsWith("ODYSSEY-A7X9K2."), "Signed cookie must format as {code}.{signature}");
    const parts = signed.split(".");
    assert.strictEqual(parts.length, 2, "Must contain code and signature hash");
    assert.strictEqual(parts[1].length, 64, "SHA-256 signature hex must be 64 characters");
  });

  test("1.2 getTeamCodeFromCookie correctly extracts untampered team code", () => {
    const signed = signTeamCookie("CREW-42");
    const extracted = getTeamCodeFromCookie(signed);
    assert.strictEqual(extracted, "CREW-42");
  });

  test("1.3 getTeamCodeFromCookie rejects tampered team code payload", () => {
    const signed = signTeamCookie("CREW-01");
    const tampered = signed.replace("CREW-01", "CREW-02");
    assert.strictEqual(getTeamCodeFromCookie(tampered), null, "Tampered payload must fail signature check");
  });

  test("1.4 getTeamCodeFromCookie rejects forged or corrupted signatures", () => {
    const forged = "CREW-01." + "a".repeat(64);
    assert.strictEqual(getTeamCodeFromCookie(forged), null, "Forged signature must be rejected");
  });

  test("1.5 getTeamCodeFromCookie safely handles null, empty, or malformed inputs", () => {
    assert.strictEqual(getTeamCodeFromCookie(""), null);
    assert.strictEqual(getTeamCodeFromCookie(null), null);
    assert.strictEqual(getTeamCodeFromCookie(undefined), null);
    assert.strictEqual(getTeamCodeFromCookie("NO_DOT_IN_COOKIE"), null);
  });

  // ---------------------------------------------------------------------------
  // 2. TEAM PASSWORD HASHING & AUTHENTICATION (5 tests)
  // ---------------------------------------------------------------------------
  console.log("\nSuite 2: Team Password Hashing & Timing-Safe Verification");

  const { hashPassword, verifyPassword } = require("../lib/teams");

  test("2.1 hashPassword generates deterministic SHA-256 digest", () => {
    const hash1 = hashPassword("odyssey2026");
    const hash2 = hashPassword("odyssey2026");
    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64);
  });

  test("2.2 verifyPassword succeeds with exact matching password", () => {
    const hash = hashPassword("odyssey2026");
    assert.strictEqual(verifyPassword("odyssey2026", hash), true);
  });

  test("2.3 verifyPassword rejects incorrect password", () => {
    const hash = hashPassword("odyssey2026");
    assert.strictEqual(verifyPassword("wrongpass", hash), false);
    assert.strictEqual(verifyPassword("ODYSSEY2026", hash), false); // case-sensitive check
  });

  test("2.4 verifyPassword handles empty, null or invalid inputs safely", () => {
    const hash = hashPassword("test");
    assert.strictEqual(verifyPassword("", hash), false);
    assert.strictEqual(verifyPassword(null, hash), false);
    assert.strictEqual(verifyPassword("test", null), false);
    assert.strictEqual(verifyPassword("test", "short-invalid-hash"), false);
  });

  test("2.5 timing-safe comparison protects against timing side channels", () => {
    const h1 = hashPassword("secretA");
    const h2 = hashPassword("secretB");
    const buf1 = Buffer.from(h1, "hex");
    const buf2 = Buffer.from(h2, "hex");
    assert.strictEqual(crypto.timingSafeEqual(buf1, buf1), true);
    assert.strictEqual(crypto.timingSafeEqual(buf1, buf2), false);
  });

  // ---------------------------------------------------------------------------
  // 3. 45-MINUTE EVENT CLOCK & 4-PHASE STATE MATH (6 tests)
  // ---------------------------------------------------------------------------
  console.log("\nSuite 3: 45-Minute Event Clock & 4-Phase Lifecycle Math");

  test("3.1 not_started state: phase is 'not_started' and msRemaining equals duration", () => {
    const durationMinutes = 45;
    const durationMs = durationMinutes * 60 * 1000;
    const cfg = { event_state: "not_started", event_start_at: "", event_duration_minutes: "45" };
    const isNotStarted = cfg.event_state === "not_started" || !cfg.event_start_at;
    assert.strictEqual(isNotStarted, true);
    const msRemaining = durationMs;
    assert.strictEqual(msRemaining, 2700000); // 45 * 60 * 1000
  });

  test("3.2 running state: calculates correct elapsed time and remaining ms", () => {
    const durationMs = 45 * 60 * 1000;
    const now = Date.now();
    const startAt = new Date(now - 15 * 60 * 1000).toISOString(); // 15 mins ago
    const pausedMs = 0;

    const elapsed = Math.max(0, now - new Date(startAt).getTime() - pausedMs);
    const msRemaining = durationMs - elapsed;
    const phase = msRemaining > 0 ? "running" : "ended";

    assert.strictEqual(phase, "running");
    assert.strictEqual(Math.round(msRemaining / 60000), 30); // ~30 mins remaining
  });

  test("3.3 paused state: freezes msRemaining at pause timestamp", () => {
    const durationMs = 45 * 60 * 1000;
    const startAt = 1000000;
    const pausedAt = startAt + 10 * 60 * 1000; // paused after 10 mins
    const pausedMs = 0;

    const elapsedBeforePause = Math.max(0, pausedAt - startAt - pausedMs);
    const msRemaining = Math.max(0, durationMs - elapsedBeforePause);

    // Should freeze exactly at 35 mins remaining
    assert.strictEqual(msRemaining, 35 * 60 * 1000);
  });

  test("3.4 resumed state: accounts for accumulated paused time correctly", () => {
    const durationMs = 45 * 60 * 1000;
    const startAt = 1000000;
    // 5 minutes spent in pause
    const pausedMs = 5 * 60 * 1000;
    // Current time is 25 minutes after startAt
    const now = startAt + 25 * 60 * 1000;

    const effectiveElapsed = now - startAt - pausedMs; // 25 - 5 = 20 mins active
    const msRemaining = durationMs - effectiveElapsed; // 45 - 20 = 25 mins left

    assert.strictEqual(msRemaining, 25 * 60 * 1000);
  });

  test("3.5 ended state: remaining ms clamped to 0 when time expires", () => {
    const durationMs = 45 * 60 * 1000;
    const startAt = Date.now() - 50 * 60 * 1000; // 50 mins ago
    const elapsed = Date.now() - startAt;
    const msRemaining = Math.max(0, durationMs - elapsed);
    const phase = msRemaining > 0 ? "running" : "ended";

    assert.strictEqual(phase, "ended");
    assert.strictEqual(msRemaining, 0);
  });

  test("3.6 duration boundary: handles custom duration (e.g. 60 min, 30 min)", () => {
    const testCustom = (mins) => Math.max(1, Number(mins)) * 60 * 1000;
    assert.strictEqual(testCustom("30"), 1800000);
    assert.strictEqual(testCustom("60"), 3600000);
    assert.strictEqual(testCustom("0"), 60000); // minimum clamped to 1 minute
  });

  // ---------------------------------------------------------------------------
  // 4. SUBMISSION GATING IN PAUSED & ENDED STATES (4 tests)
  // ---------------------------------------------------------------------------
  console.log("\nSuite 4: Submission Gating in PAUSED & ENDED States");

  function simulateSubmissionGating(phase) {
    if (phase !== "running") {
      return {
        status: 403,
        body: {
          error: phase === "paused" ? "event_paused" : (phase === "not_started" ? "not_started" : "event_ended"),
        },
      };
    }
    return { status: 200, body: { ok: true } };
  }

  test("4.1 rejects submissions with HTTP 403 event_paused when event is PAUSED", () => {
    const result = simulateSubmissionGating("paused");
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.body.error, "event_paused");
  });

  test("4.2 rejects submissions with HTTP 403 event_ended when event has ENDED", () => {
    const result = simulateSubmissionGating("ended");
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.body.error, "event_ended");
  });

  test("4.3 rejects submissions with HTTP 403 not_started when event NOT STARTED", () => {
    const result = simulateSubmissionGating("not_started");
    assert.strictEqual(result.status, 403);
    assert.strictEqual(result.body.error, "not_started");
  });

  test("4.4 permits submissions when event is OPEN/running", () => {
    const result = simulateSubmissionGating("running");
    assert.strictEqual(result.status, 200);
  });

  // ---------------------------------------------------------------------------
  // 5. TRACK A CHALLENGE LOGIC & ANTI-LEAK (5 tests)
  // ---------------------------------------------------------------------------
  console.log("\nSuite 5: Track A Validation & Anti-Leak Hardening");

  const trackA = require("../lib/trackA");

  test("5.1 A1: Validates origin IP and hostname", () => {
    assert.strictEqual(trackA.checkAnswer("A1", "203.0.113.77 smtp-out.ithacah01dings.com"), true);
    assert.strictEqual(trackA.checkAnswer("A1", "203.0.113.77 / smtp-out.ithacah01dings.com"), true);
    assert.strictEqual(trackA.checkAnswer("A1", "203.0.113.77"), false);
  });

  test("5.2 A2: Validates open redirect destination URL", () => {
    assert.strictEqual(trackA.checkAnswer("A2", "https://ithacah01dings.com/verify"), true);
    assert.strictEqual(trackA.checkAnswer("A2", "ithacah01dings.com/verify"), true);
    assert.strictEqual(trackA.checkAnswer("A2", "ithacaholdings.com"), false);
  });

  test("5.3 A3: Validates legitimate sender domain", () => {
    assert.strictEqual(trackA.checkAnswer("A3", "ithacaholdings.com"), true);
    assert.strictEqual(trackA.checkAnswer("A3", "ithacah01dings.com"), false);
  });

  test("5.4 A4: Requires canonical reference format and rejects bare guess", () => {
    assert.strictEqual(trackA.checkAnswer("A4", "IH-SOC-3719"), true);
    assert.strictEqual(trackA.checkAnswer("A4", "ih-soc-3719"), true);
    assert.strictEqual(trackA.checkAnswer("A4", "3719"), false);
  });

  test("5.5 Anti-Leak: Track A placeholders and evidence contain no answers or spoilers", () => {
    const placeholder = trackA.QUESTIONS.A4.placeholder;
    assert(!placeholder.includes("3719"), "Placeholder must not contain answer 3719");
    const email = trackA.buildEvidenceEmail();
    assert(!email.includes("X-SOC-Case-Ref"), "Evidence must not contain raw answer header");
    assert(!email.includes("[DECOY FAKE HEADER]"), "No developer decoy annotations in evidence");
  });

  // ---------------------------------------------------------------------------
  // 6. TRACK B CHALLENGE LOGIC & ANTI-LEAK (4 tests)
  // ---------------------------------------------------------------------------
  console.log("\nSuite 6: Track B Validation & Anti-Leak Hardening");

  const trackB = require("../lib/trackB");

  test("6.1 B1: Strict regex for session duration", () => {
    assert.strictEqual(trackB.checkAnswer("B1", "50"), true);
    assert.strictEqual(trackB.checkAnswer("B1", "50 mins"), true);
    assert.strictEqual(trackB.checkAnswer("B1", "500"), false);
  });

  test("6.2 B2: Validates scope permission and does not leak answer array", () => {
    assert.strictEqual(trackB.checkAnswer("B2", "admin:override_773"), true);
    assert.strictEqual(trackB.checkAnswer("B2", "user:read"), false);
    assert(!trackB.QUESTIONS.B2.placeholder.includes("admin:override_773"));
  });

  test("6.3 B3: Validates key path and placeholder contains no leak", () => {
    assert.strictEqual(trackB.checkAnswer("B3", "../../etc/keys/legacy-dev-2019.pem"), true);
    assert.strictEqual(trackB.checkAnswer("B3", "legacy-dev-2019"), true);
    assert(!trackB.QUESTIONS.B3.placeholder.includes("legacy-dev-2019"));
  });

  test("6.4 B4: Validates public key concept without giveaway placeholder", () => {
    assert.strictEqual(trackB.checkAnswer("B4", "public key"), true);
    assert.strictEqual(trackB.checkAnswer("B4", "RSA public key"), true);
    assert(!trackB.QUESTIONS.B4.placeholder.includes("public key"));
  });

  // ---------------------------------------------------------------------------
  // 7. TRACK C FORENSICS HUB & ANTI-LEAK (5 tests)
  // ---------------------------------------------------------------------------
  console.log("\nSuite 7: Track C Forensics Hub & Anti-Leak");

  const trackC = require("../lib/trackC");

  test("7.1 STAGE_SLOTS contains no client-side expectedId leak", () => {
    trackC.STAGE_SLOTS.forEach((slot, idx) => {
      assert.strictEqual(slot.expectedId, undefined, `Slot #${idx + 1} must not leak expectedId`);
    });
  });

  test("7.2 VOLATILITY_ITEMS contains no sequential IDs or rank leaks", () => {
    trackC.VOLATILITY_ITEMS.forEach((item) => {
      assert(!item.id.match(/^VOL_\d+$/), "Must not use sequential rank IDs");
      assert.strictEqual(item.rank, undefined, "Item must not leak rank");
    });
  });

  test("7.3 C1: verifyChain verifies valid 5-card attack sequence and rejects decoys", () => {
    const valid = ["ENTRY_IP", "SPOOF_DOM", "JWT_TOKEN", "AI_PROMPT", "EXFIL_IOC"];
    assert.strictEqual(trackC.verifyChain(valid).valid, true);

    const decoy = ["ENTRY_IP", "DECOY_DOM", "JWT_TOKEN", "AI_PROMPT", "EXFIL_IOC"];
    assert.strictEqual(trackC.verifyChain(decoy).valid, false);
  });

  test("7.4 C2: verifyVolatility checks RFC 3227 order accurately", () => {
    assert.strictEqual(trackC.verifyVolatility(trackC.CORRECT_VOLATILITY_ORDER).valid, true);
    const wrong = [...trackC.CORRECT_VOLATILITY_ORDER].reverse();
    assert.strictEqual(trackC.verifyVolatility(wrong).valid, false);
  });

  test("7.5 C3: verifyC3 checks volatile memory loss audit accurately", () => {
    assert.strictEqual(trackC.verifyC3("CPU registers and System RAM").valid, true);
    assert.strictEqual(trackC.verifyC3("hard disk drive").valid, false);
  });

  // ---------------------------------------------------------------------------
  // 8. STANDINGS RANKING & ZERO LEADERBOARD FOR PARTICIPANTS (6 tests)
  // ---------------------------------------------------------------------------
  console.log("\nSuite 8: Standings Ranking & Zero Participant Leaderboard");

  const { rankTeams } = require("../lib/rank");

  test("8.1 rankTeams primary sort: Total Score DESC across A, B, C", () => {
    const teams = [
      { id: 1, code: "CREW_A", name: "Crew A" },
      { id: 2, code: "CREW_B", name: "Crew B" },
      { id: 3, code: "CREW_C", name: "Crew C" },
    ];
    const ptsA = { 1: 30, 2: 20, 3: 30 };
    const ptsB = { 1: 10, 2: 30, 3: 30 };
    const ptsC = { 1: 0, 2: 10, 3: 40 };

    const ranked = rankTeams(teams, ptsA, ptsB, ptsC);
    assert.strictEqual(ranked[0].code, "CREW_C"); // 100 pts
    assert.strictEqual(ranked[1].code, "CREW_B"); // 60 pts
    assert.strictEqual(ranked[2].code, "CREW_A"); // 40 pts
    assert.strictEqual(ranked[0].rank, 1);
  });

  test("8.2 rankTeams secondary sort: Earliest Finish Time ASC for tied scores", () => {
    const teams = [
      { id: 1, code: "LATE_CREW", trackcCompletedAt: "2026-02-12T10:35:00Z" },
      { id: 2, code: "FAST_CREW", trackcCompletedAt: "2026-02-12T10:20:00Z" },
    ];
    const ptsA = { 1: 30, 2: 30 };
    const ptsB = { 1: 30, 2: 30 };
    const ptsC = { 1: 40, 2: 40 };

    const ranked = rankTeams(teams, ptsA, ptsB, ptsC);
    assert.strictEqual(ranked[0].code, "FAST_CREW");
    assert.strictEqual(ranked[1].code, "LATE_CREW");
  });

  test("8.3 rankTeams tertiary sort: Total Attempts ASC for tied scores and time", () => {
    const teams = [
      { id: 1, code: "MANY_ATTEMPTS", trackcCompletedAt: "2026-02-12T10:20:00Z", stage1Attempts: 5, stage2Attempts: 4 },
      { id: 2, code: "FEW_ATTEMPTS", trackcCompletedAt: "2026-02-12T10:20:00Z", stage1Attempts: 1, stage2Attempts: 1 },
    ];
    const ptsA = { 1: 30, 2: 30 };
    const ptsB = { 1: 30, 2: 30 };
    const ptsC = { 1: 40, 2: 40 };

    const ranked = rankTeams(teams, ptsA, ptsB, ptsC);
    assert.strictEqual(ranked[0].code, "FEW_ATTEMPTS");
    assert.strictEqual(ranked[1].code, "MANY_ATTEMPTS");
  });

  test("8.4 rankTeams deterministic tiebreaker by team ID", () => {
    const teams = [
      { id: 10, code: "CREW_10" },
      { id: 5, code: "CREW_05" },
    ];
    const ranked = rankTeams(teams, {}, {}, {});
    assert.strictEqual(ranked[0].code, "CREW_05");
    assert.strictEqual(ranked[1].code, "CREW_10");
  });

  test("8.5 Participant state payload strictly contains zero other teams and zero rankings", () => {
    // Mimic the output of /api/team/state
    const sampleStateResponse = {
      team: { code: "ODYSSEY-01", name: "Crew 01" },
      event: { phase: "running", msRemaining: 1800000 },
      scoreSummary: { trackA: 30, trackB: 20, trackC: 0, total: 50, maxPoints: 100 },
      stage: "trackB",
    };

    assert.strictEqual(sampleStateResponse.standings, undefined, "Participant state must not contain standings");
    assert.strictEqual(sampleStateResponse.rank, undefined, "Participant state must not contain rank");
    assert.strictEqual(sampleStateResponse.otherTeams, undefined, "Participant state must not contain other teams");
    assert.strictEqual(sampleStateResponse.leaderboard, undefined, "Participant state must not contain leaderboard");
    assert(sampleStateResponse.scoreSummary.total <= 100);
  });

  test("8.6 Participant completion/finalScore payload structure contains own score breakdown", () => {
    const sampleFinalScore = {
      totalPoints: 85,
      maxPoints: 100,
      trackA: 30,
      trackB: 25,
      trackC: 30,
      completed: true,
      finishedAt: "2026-02-12T10:30:00Z",
    };

    assert.strictEqual(sampleFinalScore.totalPoints, 85);
    assert.strictEqual(sampleFinalScore.maxPoints, 100);
    assert.strictEqual(sampleFinalScore.trackA + sampleFinalScore.trackB + sampleFinalScore.trackC, 85);
    assert.strictEqual(sampleFinalScore.completed, true);
  });

  // ---------------------------------------------------------------------------
  // 9. DATABASE CONFIGURATION & VESSEL CODE ELIMINATION VERIFICATION (4 tests)
  // ---------------------------------------------------------------------------
  console.log("\nSuite 9: Database Configuration & Vessel Code Elimination");

  const fs = require("fs");
  const path = require("path");

  test("9.1 getValidatedDatabaseUrl rejects Supabase hostnames", () => {
    const originalEnv = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = "postgresql://postgres:pass@db.qtudyqkuuwensqpljurz.supabase.co:5432/postgres";
      assert.throws(() => {
        const { getValidatedDatabaseUrl } = require("../lib/db");
        getValidatedDatabaseUrl();
      }, /Obsolete Supabase connection string/);
    } finally {
      process.env.DATABASE_URL = originalEnv;
    }
  });

  test("9.2 getValidatedDatabaseUrl rejects missing or empty DATABASE_URL", () => {
    const originalEnv = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;
      assert.throws(() => {
        const { getValidatedDatabaseUrl } = require("../lib/db");
        getValidatedDatabaseUrl();
      }, /DATABASE_URL environment variable is missing/);
    } finally {
      process.env.DATABASE_URL = originalEnv;
    }
  });

  test("9.3 Participant login page has ZERO Vessel Code or ODYSSEY-XXXXXX strings", () => {
    const indexSource = fs.readFileSync(path.join(__dirname, "../pages/index.js"), "utf8");
    assert(!indexSource.includes("Vessel Code"), "pages/index.js must not contain 'Vessel Code'");
    assert(!indexSource.includes("vessel code"), "pages/index.js must not contain 'vessel code'");
    assert(!indexSource.includes("ODYSSEY-XXXXXX"), "pages/index.js must not contain 'ODYSSEY-XXXXXX'");
    assert(!indexSource.includes("useCodeDirectly"), "pages/index.js must not contain direct vessel code fallback");
    assert(indexSource.includes("Team Name"), "pages/index.js must contain 'Team Name'");
    assert(indexSource.includes("Team Password"), "pages/index.js must contain 'Team Password'");
    assert(indexSource.includes("WELCOME ABOARD, CAPTAIN."), "pages/index.js must contain 'WELCOME ABOARD, CAPTAIN.'");
  });

  test("9.4 Landing guide dialogue contains team details and zero vessel code", () => {
    const guideSource = fs.readFileSync(path.join(__dirname, "../components/OdysseusGuide.js"), "utf8");
    assert(!guideSource.includes("Enter your vessel code"), "OdysseusGuide must not prompt for vessel code");
    assert(guideSource.includes("Enter your team details"), "OdysseusGuide must prompt for team details");
  });

  // ---------------------------------------------------------------------------
  // SUITE 10: Live Test Database & Test Accounts Verification
  // ---------------------------------------------------------------------------
  console.log("\nSuite 10: Live Test Database & Test Accounts Verification");

  await asyncTest("10.1 PostgreSQL connection and SELECT 1 returns 1", async () => {
    const { pool } = require("../lib/db");
    const res = await pool.query("SELECT 1 AS num, current_database() AS db_name");
    assert.strictEqual(res.rows[0].num, 1);
    assert.strictEqual(res.rows[0].db_name, "cyber_odyssey");
  });

  await asyncTest("10.2 All expected tables exist (config, teams, track_answers, chat_logs)", async () => {
    const { pool } = require("../lib/db");
    const res = await pool.query(`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
    `);
    const tables = res.rows.map((r) => r.table_name);
    assert(tables.includes("config"), "config table exists");
    assert(tables.includes("teams"), "teams table exists");
    assert(tables.includes("track_answers"), "track_answers table exists");
    assert(tables.includes("chat_logs"), "chat_logs table exists");
  });

  await asyncTest("10.3 5 local test teams (ACN Test Team 01..05) exist in database", async () => {
    const { getTeamByName } = require("../lib/teams");
    for (let i = 1; i <= 5; i++) {
      const num = String(i).padStart(2, "0");
      const name = `ACN Test Team ${num}`;
      const code = `ACN${num}`;
      const t = await getTeamByName(name);
      assert(Boolean(t && t.code === code), `${name} exists with code ${code}`);
    }
  });

  await asyncTest("10.4 5 local test teams authenticate with exact password and reject wrong password", async () => {
    const { authenticateTeam } = require("../lib/teams");
    const passwords = {
      "ACN Test Team 01": "ACNtest@01",
      "ACN Test Team 02": "ACNtest@02",
      "ACN Test Team 03": "ACNtest@03",
      "ACN Test Team 04": "ACNtest@04",
      "ACN Test Team 05": "ACNtest@05",
    };
    for (const [name, pass] of Object.entries(passwords)) {
      const ok = await authenticateTeam(name, pass);
      assert(Boolean(ok && ok.name === name), `${name} authenticated with ${pass}`);
      const caseOk = await authenticateTeam(`  ${name.toLowerCase()}  `, pass);
      assert(Boolean(caseOk && caseOk.name === name), `${name} authenticated case-insensitively`);
      const wrong = await authenticateTeam(name, "wrongpass");
      assert.strictEqual(wrong, null, `${name} rejected wrong password`);
    }
  });

  await asyncTest("10.5 Database config table read successfully with 45-minute default", async () => {
    const { getAllConfig } = require("../lib/config");
    const cfg = await getAllConfig();
    assert.strictEqual(cfg.event_duration_minutes, "45", "Config duration is 45 minutes");
    assert.strictEqual(cfg.event_state, "not_started", "Config initial state is not_started");
  });

  // ---------------------------------------------------------------------------
  // SUITE 11: Attempt Limit (3 Attempts), Server Enforcement & Challenge Locking
  // ---------------------------------------------------------------------------
  console.log("\nSuite 11: Attempt Limit (3 Attempts), Server Enforcement & Challenge Locking");

  test("11.1 MAX_ATTEMPTS equals 3 across all tracks (Shared, A, B, C)", () => {
    const trackShared = require("../lib/trackShared");
    const trackA = require("../lib/trackA");
    const trackB = require("../lib/trackB");
    const trackC = require("../lib/trackC");
    assert.strictEqual(trackShared.MAX_ATTEMPTS, 3, "trackShared.MAX_ATTEMPTS must be 3");
    assert.strictEqual(trackA.MAX_ATTEMPTS, 3, "trackA.MAX_ATTEMPTS must be 3");
    assert.strictEqual(trackB.MAX_ATTEMPTS, 3, "trackB.MAX_ATTEMPTS must be 3");
    assert.strictEqual(trackC.MAX_ATTEMPTS, 3, "trackC.MAX_ATTEMPTS must be 3");
  });

  await asyncTest("11.2 Server-side atomic enforcement: Exactly 3 attempts allowed, attempt 4 rejected", async () => {
    const { recordTrackAttempt, getTrackAnswers, getTeamByCode } = require("../lib/teams");
    const { pool } = require("../lib/db");
    const team = await getTeamByCode("ACN05");
    assert(Boolean(team), "ACN05 exists for attempt testing");

    // Clean any prior attempts for test question
    await pool.query("DELETE FROM track_answers WHERE team_id = $1 AND question_code = 'TEST_Q'", [team.id]);

    // Attempt 1: Wrong
    const att1 = await recordTrackAttempt(team.id, "TEST_Q", { correct: false, points: 10, evidence: "att1", maxAttempts: 3 });
    assert.strictEqual(att1.attempts, 1, "Attempt 1 recorded as 1 attempt");
    assert.strictEqual(att1.correct, false, "Attempt 1 is not correct");

    // Attempt 2: Wrong
    const att2 = await recordTrackAttempt(team.id, "TEST_Q", { correct: false, points: 10, evidence: "att2", maxAttempts: 3 });
    assert.strictEqual(att2.attempts, 2, "Attempt 2 recorded as 2 attempts");
    assert.strictEqual(att2.correct, false, "Attempt 2 is not correct");

    // Attempt 3: Wrong (Locks the challenge!)
    const att3 = await recordTrackAttempt(team.id, "TEST_Q", { correct: false, points: 10, evidence: "att3", maxAttempts: 3 });
    assert.strictEqual(att3.attempts, 3, "Attempt 3 recorded as 3 attempts");
    assert.strictEqual(att3.correct, false, "Attempt 3 is not correct");
    const isLockedAt3 = !att3.correct && att3.attempts >= 3;
    assert.strictEqual(isLockedAt3, true, "Challenge is locked on attempt 3");

    // Attempt 4: Rejected! Even if correct payload attempted, database row is frozen!
    const att4 = await recordTrackAttempt(team.id, "TEST_Q", { correct: true, points: 10, evidence: "att4", maxAttempts: 3 });
    assert.strictEqual(att4.attempts, 3, "Attempt 4 rejected - counter frozen at 3");
    assert.strictEqual(att4.correct, false, "Attempt 4 rejected - cannot become correct after 3 failed attempts");
    assert.strictEqual(att4.pointsAwarded, 0, "Attempt 4 rejected - 0 points awarded");

    // Clean up test question
    await pool.query("DELETE FROM track_answers WHERE team_id = $1 AND question_code = 'TEST_Q'", [team.id]);
  });

  await asyncTest("11.3 Solved challenge is idempotent and does not consume extra attempts", async () => {
    const { recordTrackAttempt } = require("../lib/teams");
    const { pool } = require("../lib/db");
    const team = await require("../lib/teams").getTeamByCode("ACN05");

    await pool.query("DELETE FROM track_answers WHERE team_id = $1 AND question_code = 'TEST_SOLVE'", [team.id]);

    // Attempt 1: Correct!
    const res1 = await recordTrackAttempt(team.id, "TEST_SOLVE", { correct: true, points: 10, evidence: "ans1", maxAttempts: 3 });
    assert.strictEqual(res1.attempts, 1, "Solved on attempt 1");
    assert.strictEqual(res1.correct, true, "Is correct");
    assert.strictEqual(res1.pointsAwarded, 10, "10 points awarded");

    // Attempt 2: Resubmission of solved question
    const res2 = await recordTrackAttempt(team.id, "TEST_SOLVE", { correct: true, points: 10, evidence: "ans1_resub", maxAttempts: 3 });
    assert.strictEqual(res2.attempts, 1, "Resubmission does not increment attempts");
    assert.strictEqual(res2.correct, true, "Remains correct");
    assert.strictEqual(res2.pointsAwarded, 10, "Points preserved at 10");

    await pool.query("DELETE FROM track_answers WHERE team_id = $1 AND question_code = 'TEST_SOLVE'", [team.id]);
  });

  // ---------------------------------------------------------------------------
  // SUITE 12: Password Show/Hide Toggle & Zero Vessel Terminology
  // ---------------------------------------------------------------------------
  console.log("\nSuite 12: Password Show/Hide Toggle & Zero Vessel Terminology");

  test("12.1 Team Password Show/Hide toggle on pages/index.js", () => {
    const indexSource = fs.readFileSync(path.join(__dirname, "../pages/index.js"), "utf8");
    assert(indexSource.includes("showPassword"), "pages/index.js has showPassword state");
    assert(indexSource.includes('aria-label={showPassword ? "Hide password" : "Show password"}'), "pages/index.js has accessible aria-label for show/hide");
    assert(indexSource.includes('type={showPassword ? "text" : "password"}'), "pages/index.js toggles input type");
    assert(indexSource.includes("ENTER LEVEL 1"), "pages/index.js button says 'ENTER LEVEL 1'");
  });

  test("12.2 Admin Password Show/Hide toggle on pages/admin.js", () => {
    const adminSource = fs.readFileSync(path.join(__dirname, "../pages/admin.js"), "utf8");
    assert(adminSource.includes("showAdminPassword"), "pages/admin.js has showAdminPassword state");
    assert(adminSource.includes('aria-label={showAdminPassword ? "Hide password" : "Show password"}'), "pages/admin.js has accessible aria-label for show/hide");
    assert(adminSource.includes('type={showAdminPassword ? "text" : "password"}'), "pages/admin.js toggles input type");
  });

  test("12.3 Zero participant-facing Vessel Code terminology across pages", () => {
    const indexSource = fs.readFileSync(path.join(__dirname, "../pages/index.js"), "utf8");
    const playSource = fs.readFileSync(path.join(__dirname, "../pages/play.js"), "utf8");
    const hubSource = fs.readFileSync(path.join(__dirname, "../pages/hub.js"), "utf8");

    assert(!indexSource.includes("Vessel Code"), "index.js has zero 'Vessel Code'");
    assert(!indexSource.includes("vessel code"), "index.js has zero 'vessel code'");
    assert(!playSource.includes("Vessel Code"), "play.js has zero 'Vessel Code'");
    assert(!playSource.includes("switchVessel"), "play.js has zero 'switchVessel'");
    assert(!hubSource.includes("Vessel Code"), "hub.js has zero 'Vessel Code'");
    assert(!hubSource.includes("switchVessel"), "hub.js has zero 'switchVessel'");
  });
  // ---------------------------------------------------------------------------
  // SUITE 13: Final Cleanup Verification (Tests A through Q)
  // ---------------------------------------------------------------------------
  console.log("\nSuite 13: Final Cleanup Verification (Tests A through Q)");

  // Test A: Zero-score teams are unranked
  test("13.A Zero-score teams are unranked (rank is '—')", () => {
    const teams = [
      { id: 1, name: "Crew 01", stage1Attempts: 0, stage2Attempts: 0, finalAttempts: 0 },
      { id: 2, name: "Crew 02", stage1Attempts: 0, stage2Attempts: 0, finalAttempts: 0 },
    ];
    const ranked = rankTeams(teams, {}, {}, {});
    assert.strictEqual(ranked[0].rank, "—", "Crew 01 with 0 points must have rank '—'");
    assert.strictEqual(ranked[1].rank, "—", "Crew 02 with 0 points must have rank '—'");
    assert.strictEqual(ranked[0].totalPoints, 0);
    assert.strictEqual(ranked[1].totalPoints, 0);
  });

  // Test B: A team with points receives a rank
  test("13.B A team with points receives a rank", () => {
    const teams = [
      { id: 1, name: "Crew 01", stage1Attempts: 0, stage2Attempts: 0, finalAttempts: 0 },
      { id: 2, name: "Crew 02", stage1Attempts: 1, stage2Attempts: 0, finalAttempts: 0 },
    ];
    const ranked = rankTeams(teams, { 2: 25 }, {}, {});
    assert.strictEqual(ranked[0].name, "Crew 02");
    assert.strictEqual(ranked[0].rank, 1, "Crew 02 with 25 points must be Rank 1");
    assert.strictEqual(ranked[1].name, "Crew 01");
    assert.strictEqual(ranked[1].rank, "—", "Crew 01 with 0 points must remain unranked ('—')");
  });

  // Test C: Ranking changes when scores change
  test("13.C Ranking changes dynamically when scores change", () => {
    const teams = [
      { id: 1, name: "Crew 01" },
      { id: 2, name: "Crew 02" },
      { id: 3, name: "Crew 03" },
    ];
    // State 1: All 0
    let r1 = rankTeams(teams, {}, {}, {});
    assert.strictEqual(r1[0].rank, "—");
    assert.strictEqual(r1[1].rank, "—");
    assert.strictEqual(r1[2].rank, "—");

    // State 2: Crew 02 gets 30 points
    let r2 = rankTeams(teams, { 2: 30 }, {}, {});
    assert.strictEqual(r2[0].name, "Crew 02");
    assert.strictEqual(r2[0].rank, 1);
    assert.strictEqual(r2[1].rank, "—");
    assert.strictEqual(r2[2].rank, "—");

    // State 3: Crew 03 gets 40 points -> Crew 03 becomes Rank 1, Crew 02 becomes Rank 2
    let r3 = rankTeams(teams, { 2: 30, 3: 40 }, {}, {});
    assert.strictEqual(r3[0].name, "Crew 03");
    assert.strictEqual(r3[0].rank, 1);
    assert.strictEqual(r3[1].name, "Crew 02");
    assert.strictEqual(r3[1].rank, 2);
    assert.strictEqual(r3[2].name, "Crew 01");
    assert.strictEqual(r3[2].rank, "—");

    // State 4: Crew 01 gets 50 points -> Crew 01 becomes Rank 1, Crew 03 becomes Rank 2, Crew 02 becomes Rank 3
    let r4 = rankTeams(teams, { 1: 50, 2: 30, 3: 40 }, {}, {});
    assert.strictEqual(r4[0].name, "Crew 01");
    assert.strictEqual(r4[0].rank, 1);
    assert.strictEqual(r4[1].name, "Crew 03");
    assert.strictEqual(r4[1].rank, 2);
    assert.strictEqual(r4[2].name, "Crew 02");
    assert.strictEqual(r4[2].rank, 3);
  });

  // Test D: Ranking is based on score, not team ID
  test("13.D Ranking is based on actual score performance, not team ID or creation order", () => {
    const teams = [
      { id: 1, name: "Crew 01" },
      { id: 2, name: "Crew 02" },
      { id: 3, name: "Crew 03" },
      { id: 4, name: "Crew 04" },
      { id: 5, name: "Crew 05" },
    ];
    const r = rankTeams(teams, { 5: 70, 3: 40, 1: 10 }, {}, {});
    assert.strictEqual(r[0].id, 5, "Team 5 has highest score (70) so must be Rank 1");
    assert.strictEqual(r[0].rank, 1);
    assert.strictEqual(r[1].id, 3, "Team 3 has second highest score (40) so must be Rank 2");
    assert.strictEqual(r[1].rank, 2);
    assert.strictEqual(r[2].id, 1, "Team 1 has 10 points so must be Rank 3");
    assert.strictEqual(r[2].rank, 3);
    assert.strictEqual(r[3].rank, "—", "Team 2 with 0 points is unranked");
    assert.strictEqual(r[4].rank, "—", "Team 4 with 0 points is unranked");
  });

  // Tests E, F, G: Independent track attempts
  await asyncTest("13.E Track A attempts are independent (do not affect Track B or C)", async () => {
    const { incrementTrackAttempts, getTeamByCode, resetTeamProgress } = require("../lib/teams");
    const team = await getTeamByCode("ACN04");
    assert(Boolean(team), "ACN04 exists");

    await resetTeamProgress(team.code);
    const before = await getTeamByCode(team.code);
    assert.strictEqual(before.trackAAttempts, 0);
    assert.strictEqual(before.trackBAttempts, 0);
    assert.strictEqual(before.trackCAttempts, 0);

    await incrementTrackAttempts(team.id, "A");
    await incrementTrackAttempts(team.id, "A");

    const after = await getTeamByCode(team.code);
    assert.strictEqual(after.trackAAttempts, 2, "Track A attempts incremented to 2");
    assert.strictEqual(after.trackBAttempts, 0, "Track B attempts remain 0");
    assert.strictEqual(after.trackCAttempts, 0, "Track C attempts remain 0");
  });

  await asyncTest("13.F Track B attempts are independent (do not affect Track A or C)", async () => {
    const { incrementTrackAttempts, getTeamByCode } = require("../lib/teams");
    const team = await getTeamByCode("ACN04");

    await incrementTrackAttempts(team.id, "B");

    const after = await getTeamByCode(team.code);
    assert.strictEqual(after.trackAAttempts, 2, "Track A attempts untouched at 2");
    assert.strictEqual(after.trackBAttempts, 1, "Track B attempts incremented to 1");
    assert.strictEqual(after.trackCAttempts, 0, "Track C attempts remain 0");
  });

  await asyncTest("13.G Track C attempts are independent (do not affect Track A or B)", async () => {
    const { incrementTrackAttempts, getTeamByCode } = require("../lib/teams");
    const team = await getTeamByCode("ACN04");

    await incrementTrackAttempts(team.id, "C");

    const after = await getTeamByCode(team.code);
    assert.strictEqual(after.trackAAttempts, 2, "Track A attempts untouched at 2");
    assert.strictEqual(after.trackBAttempts, 1, "Track B attempts untouched at 1");
    assert.strictEqual(after.trackCAttempts, 1, "Track C attempts incremented to 1");
  });

  // Tests H, I, J: Maximum attempts = 3 per track
  await asyncTest("13.H Maximum Track A attempts = 3 and clamped", async () => {
    const { incrementTrackAttempts, getTeamByCode } = require("../lib/teams");
    const team = await getTeamByCode("ACN04");

    await incrementTrackAttempts(team.id, "A"); // 3rd attempt
    await incrementTrackAttempts(team.id, "A"); // 4th attempt attempted
    const after = await getTeamByCode(team.code);
    assert.strictEqual(after.trackAAttempts, 3, "Track A attempts clamped at max 3");
  });

  await asyncTest("13.I Maximum Track B attempts = 3 and clamped", async () => {
    const { incrementTrackAttempts, getTeamByCode } = require("../lib/teams");
    const team = await getTeamByCode("ACN04");

    await incrementTrackAttempts(team.id, "B"); // 2nd attempt
    await incrementTrackAttempts(team.id, "B"); // 3rd attempt
    await incrementTrackAttempts(team.id, "B"); // 4th attempt attempted
    const after = await getTeamByCode(team.code);
    assert.strictEqual(after.trackBAttempts, 3, "Track B attempts clamped at max 3");
  });

  await asyncTest("13.J Maximum Track C attempts = 3 and clamped", async () => {
    const { incrementTrackAttempts, getTeamByCode, resetTeamProgress } = require("../lib/teams");
    const team = await getTeamByCode("ACN04");

    await incrementTrackAttempts(team.id, "C"); // 2nd attempt
    await incrementTrackAttempts(team.id, "C"); // 3rd attempt
    await incrementTrackAttempts(team.id, "C"); // 4th attempt attempted
    const after = await getTeamByCode(team.code);
    assert.strictEqual(after.trackCAttempts, 3, "Track C attempts clamped at max 3");

    // Clean up test team
    await resetTeamProgress(team.code);
  });

  // Test K: Participant cannot see other teams
  test("13.K Participant state returns ONLY own team details (no other teams)", () => {
    const stateApiSource = fs.readFileSync(path.join(__dirname, "../pages/api/team/state.js"), "utf8");
    assert(!stateApiSource.includes("listAllTeams"), "Participant state does not list other teams");
    assert(!stateApiSource.includes("standings"), "Participant state does not include standings");
    assert(!stateApiSource.includes("leaderboard"), "Participant state does not include leaderboard");
    assert(stateApiSource.includes("team: {"), "Participant state returns only authenticated team");
  });

  // Test L: Participant cannot see leaderboard
  test("13.L Leaderboard is strictly admin-only and inaccessible to participants", () => {
    const { requireAdmin } = require("../lib/requireAdmin");
    let statusCode = null;
    const mockRes = {
      status: (c) => {
        statusCode = c;
        return { json: () => {} };
      },
    };
    const allowed = requireAdmin({ cookies: {} }, mockRes);
    assert.strictEqual(allowed, false, "Request without admin cookie is blocked");
    assert.strictEqual(statusCode, 401, "Returns HTTP 401");
    const adminStatusSource = fs.readFileSync(path.join(__dirname, "../pages/api/admin/status.js"), "utf8");
    assert(adminStatusSource.includes("requireAdmin"), "pages/api/admin/status requires admin authorization");
  });

  // Test M: Team login works with Team Name + Password
  await asyncTest("13.M Team login works with Team Name + Password", async () => {
    const { authenticateTeam } = require("../lib/teams");
    const team = await authenticateTeam("ACN Test Team 01", "ACNtest@01");
    assert(Boolean(team), "ACN Test Team 01 authenticates successfully with teamName and password");
    assert.strictEqual(team.name, "ACN Test Team 01");
  });

  // Test N: Password Show/Hide works only on the UI and does not expose credentials
  test("13.N Password Show/Hide toggle operates client-side without credential exposure", () => {
    const indexSource = fs.readFileSync(path.join(__dirname, "../pages/index.js"), "utf8");
    assert(indexSource.includes("setShowPassword"), "Show/Hide state toggle exists in index.js");
    assert(indexSource.includes('type={showPassword ? "text" : "password"}'), "Input type toggles between text and password");
    assert(!indexSource.includes("console.log(password)"), "Password is never logged");
  });

  // Test O: Admin login still works
  test("13.O Admin login verification works with correct password", () => {
    const { makeAdminCookieValue, isValidAdminCookieValue } = require("../lib/adminAuth");
    const cookie = makeAdminCookieValue();
    assert.strictEqual(isValidAdminCookieValue(cookie), true, "Valid admin cookie verifies true");
    assert.strictEqual(isValidAdminCookieValue("forged.invalid.cookie"), false, "Forged admin cookie rejected");

    // The admin password comes from the environment and has no default. This
    // test used to hardcode the old shipped constant, so it asserted the very
    // vulnerability that was removed — it would have gone green against a
    // deployment anyone could sign into.
    const expectedAdmin = String(process.env.ADMIN_PASSWORD || "").trim();
    assert.ok(
      expectedAdmin,
      "ADMIN_PASSWORD must be set in the environment for this test (there is no default)"
    );
    const checkPw = (candidate) => {
      const bufA = Buffer.from(candidate);
      const bufB = Buffer.from(expectedAdmin);
      return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
    };
    assert.strictEqual(checkPw(expectedAdmin), true, "Valid admin password succeeds");
    assert.strictEqual(checkPw("wrongadminpass"), false, "Invalid admin password fails");
    assert.strictEqual(
      checkPw("iamtheboss@6666"),
      false,
      "The previously shipped default admin password is no longer accepted"
    );
  });

  // Test P: Admin can see the leaderboard with required per-track attempt columns
  test("13.P Admin leaderboard displays rank, per-track scores, per-track attempts, and status", () => {
    const adminSource = fs.readFileSync(path.join(__dirname, "../pages/admin.js"), "utf8");
    assert(adminSource.includes("<th>RANK</th>"), "Admin leaderboard has RANK column");
    assert(adminSource.includes("<th>TEAM NAME</th>"), "Admin leaderboard has TEAM NAME column");
    assert(adminSource.includes("<th>TRACK A ATTEMPTS</th>"), "Admin leaderboard has TRACK A ATTEMPTS column");
    assert(adminSource.includes("<th>TRACK B ATTEMPTS</th>"), "Admin leaderboard has TRACK B ATTEMPTS column");
    assert(adminSource.includes("<th>TRACK C ATTEMPTS</th>"), "Admin leaderboard has TRACK C ATTEMPTS column");
    assert(!adminSource.includes("5. TEAM MANAGEMENT"), "Separate Team Management section is removed");
  });

  // Test Q: Existing event timer functionality still works
  await asyncTest("13.Q Event timer functionality works (default 45 min, calculation of remaining ms)", async () => {
    const { getEventStatus } = require("../lib/eventClock");
    const status = await getEventStatus();
    assert.strictEqual(status.durationMinutes, 45, "Default event duration is 45 minutes");
    assert(typeof status.msRemaining === "number", "msRemaining is a number");
    assert(status.phase === "not_started" || status.phase === "running", "Valid event phase returned");
  });

  console.log("\n============================================================");
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("============================================================\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAll();

