const http = require("http");

// The admin password is environment-supplied and has no default — see
// pages/api/admin/login.js. A literal here would test a credential the
// application no longer accepts.
const { loadEnv } = require("../lib/loadEnv");
loadEnv();

const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "").trim();
if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD is not set. Load .env (or export it) before running the e2e suite.");
  process.exit(1);
}

let currentPort = 3000;

function request(options, body = null) {
  const headers = { ...(options.headers || {}) };
  let payload = null;
  if (body) {
    payload = typeof body === "string" ? body : JSON.stringify(body);
    headers["Content-Length"] = Buffer.byteLength(payload);
    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
  }
  const mergedOptions = { ...options, headers, port: options.port || currentPort };
  return new Promise((resolve, reject) => {
    const req = http.request(mergedOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          json,
        });
      });
    });
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function parseCookies(headers) {
  const raw = headers["set-cookie"];
  if (!raw) return "";
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function runE2ETests() {
  console.log("=== COMPREHENSIVE E2E HTTP TESTS FOR LEVEL 1 ===");

  // Determine active port (3001 or 3000)
  try {
    const probe = await request({ hostname: "localhost", port: 3001, path: "/api/event/status", method: "GET" });
    if (probe.statusCode === 200) currentPort = 3001;
  } catch {}
  console.log(`[INFO] Testing server on port ${currentPort}`);

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  // 1. GET /api/event/status
  const statusRes = await request({
    hostname: "localhost",
    path: "/api/event/status",
    method: "GET",
  });
  assert(statusRes.statusCode === 200, "GET /api/event/status returns 200");
  assert(statusRes.json?.event?.durationMinutes === 45, "Default event duration is 45 minutes");
  assert(statusRes.json?.event?.phase === "not_started", "Default event phase is 'not_started'");

  // 2. Team Logins: Test All 5 ACN Test Teams
  const acnTeams = [
    { name: "ACN Test Team 01", code: "ACN01", password: "ACNtest@01" },
    { name: "ACN Test Team 02", code: "ACN02", password: "ACNtest@02" },
    { name: "ACN Test Team 03", code: "ACN03", password: "ACNtest@03" },
    { name: "ACN Test Team 04", code: "ACN04", password: "ACNtest@04" },
    { name: "ACN Test Team 05", code: "ACN05", password: "ACNtest@05" },
  ];

  const teamCookies = {};

  for (const t of acnTeams) {
    const res = await request(
      {
        hostname: "localhost",
        path: "/api/team/login",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      { teamName: t.name, password: t.password }
    );
    assert(res.statusCode === 200 && res.json?.ok, `${t.name} + ${t.password} login succeeds`);
    assert(res.json?.team?.name === t.name, `${t.name} name matches in login response`);
    assert(res.json?.team?.code === t.code, `${t.name} code matches in login response`);
    const cookie = parseCookies(res.headers);
    assert(cookie.includes("sb_team="), `${t.name} received signed session cookie`);
    teamCookies[t.code] = cookie;
  }

  // Verify Case-Insensitive and Trimmed login
  const caseInsensitiveRes = await request(
    {
      hostname: "localhost",
      path: "/api/team/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { teamName: "  acn test team 01  ", password: "ACNtest@01" }
  );
  assert(caseInsensitiveRes.statusCode === 200, "Case-insensitive and trimmed login succeeds for '  acn test team 01  '");

  // 3. Login Failure Cases
  // Wrong password
  const wrongPwRes = await request(
    {
      hostname: "localhost",
      path: "/api/team/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { teamName: "ACN Test Team 01", password: "wrongpassword999" }
  );
  assert(wrongPwRes.statusCode === 401, "Wrong password rejected with HTTP 401 (clean authentication failure)");
  assert(wrongPwRes.json?.code === "invalid_credentials" || wrongPwRes.json?.error, "Wrong password has clean error message");

  // Unknown team
  const unknownTeamRes = await request(
    {
      hostname: "localhost",
      path: "/api/team/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { teamName: "Nonexistent Team", password: "test1234" }
  );
  assert(unknownTeamRes.statusCode === 401, "Unknown team rejected with HTTP 401 (clean authentication failure)");

  // Missing fields
  const missingNameRes = await request(
    {
      hostname: "localhost",
      path: "/api/team/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { password: "test1234" }
  );
  assert(missingNameRes.statusCode === 400, "Missing team name rejected with HTTP 400");

  const missingPwRes = await request(
    {
      hostname: "localhost",
      path: "/api/team/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { teamName: "ACN Test Team 01" }
  );
  assert(missingPwRes.statusCode === 400, "Missing password rejected with HTTP 400");

  // 4. Team Session Isolation Across Teams
  for (const t of acnTeams) {
    const state = await request({
      hostname: "localhost",
      path: "/api/team/state",
      method: "GET",
      headers: { Cookie: teamCookies[t.code] },
    });
    assert(state.statusCode === 200, `${t.name} state request returns 200`);
    assert(state.json?.team?.name === t.name, `${t.name} session returns only ${t.name}`);
    assert(state.json?.team?.code === t.code, `${t.name} code is ${t.code}`);
    assert(!state.json?.standings && !state.json?.leaderboard, `${t.name} state contains zero standings/leaderboard`);
  }

  const team1Cookie = teamCookies["ACN01"];

  // 5. Participant Blocked From Admin / Leaderboard
  const participantAdminRes = await request({
    hostname: "localhost",
    path: "/api/admin/status",
    method: "GET",
    headers: { Cookie: team1Cookie },
  });
  assert(
    participantAdminRes.statusCode === 401,
    "Participant session is BLOCKED from /api/admin/status (Leaderboard & Admin state hidden from participants)"
  );

  // 6. Admin Authentication
  const adminWrong = await request(
    {
      hostname: "localhost",
      path: "/api/admin/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { password: "wrongadminpass" }
  );
  assert(adminWrong.statusCode === 401, "Admin login with wrong password returns 401");

  const adminLoginRes = await request(
    {
      hostname: "localhost",
      path: "/api/admin/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { password: ADMIN_PASSWORD }
  );
  assert(
    adminLoginRes.statusCode === 200 && adminLoginRes.json?.ok,
    "Admin login with the configured ADMIN_PASSWORD succeeds"
  );
  const adminCookie = parseCookies(adminLoginRes.headers);
  assert(adminCookie.includes("sb_admin="), "Admin received signed admin cookie");

  // 7. Admin Capabilities: Leaderboard & Standings Inspection
  const adminStatusRes = await request({
    hostname: "localhost",
    path: "/api/admin/status",
    method: "GET",
    headers: { Cookie: adminCookie },
  });
  assert(adminStatusRes.statusCode === 200, "Admin can view /api/admin/status (Leaderboard & Standings)");
  const standings = adminStatusRes.json?.standings || [];
  assert(standings.length >= 5, `Admin sees ${standings.length} teams on leaderboard`);
  for (let i = 1; i <= 5; i++) {
    const num = String(i).padStart(2, "0");
    const name = `ACN Test Team ${num}`;
    const found = standings.find((t) => t.name === name);
    assert(Boolean(found), `Admin sees ${name} on leaderboard`);
  }

  // 8. Admin Capabilities: Duration Configuration (Change to 60 min, then back to 45)
  const setDurationRes = await request(
    {
      hostname: "localhost",
      path: "/api/admin/set-state",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    },
    { durationMinutes: 60 }
  );
  assert(setDurationRes.statusCode === 200, "Admin can change duration to 60 minutes");

  const checkDuration60 = await request({
    hostname: "localhost",
    path: "/api/event/status",
    method: "GET",
  });
  assert(checkDuration60.json?.event?.durationMinutes === 60, "Event status reflects new 60-minute duration");

  // Reset duration back to default 45 min
  await request(
    {
      hostname: "localhost",
      path: "/api/admin/set-state",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    },
    { durationMinutes: 45 }
  );
  const checkDuration45 = await request({
    hostname: "localhost",
    path: "/api/event/status",
    method: "GET",
  });
  assert(checkDuration45.json?.event?.durationMinutes === 45, "Event duration restored to default 45 minutes");

  // 9. Admin Capabilities: Lifecycle controls (open, pause, resume, reset)
  const startRes = await request(
    {
      hostname: "localhost",
      path: "/api/admin/set-state",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    },
    { action: "open" }
  );
  assert(startRes.statusCode === 200 && startRes.json?.event?.phase === "running", "Admin can open/start event");

  const pauseRes = await request(
    {
      hostname: "localhost",
      path: "/api/admin/set-state",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    },
    { action: "pause" }
  );
  assert(pauseRes.statusCode === 200 && pauseRes.json?.event?.phase === "paused", "Admin can pause event");

  const resumeRes = await request(
    {
      hostname: "localhost",
      path: "/api/admin/set-state",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    },
    { action: "resume" }
  );
  assert(resumeRes.statusCode === 200 && resumeRes.json?.event?.phase === "running", "Admin can resume event");

  // 9b. Attempt Limit (3 Attempts) & Challenge Locking E2E Verification
  await request(
    {
      hostname: "localhost",
      path: "/api/admin/reset-team",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    },
    { code: "ACN01" }
  );

  const sub1 = await request(
    {
      hostname: "localhost",
      path: "/api/trackA/submit",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: team1Cookie },
    },
    { questionCode: "A1", answer: "wrong-answer-1" }
  );
  assert(sub1.statusCode === 200 && !sub1.json?.correct, "Attempt 1 submitted: wrong answer");
  assert(sub1.json?.attempts === 1, "Attempt 1 recorded as attempts=1");
  assert(sub1.json?.attemptsRemaining === 2, "Attempt 1: attemptsRemaining is 2");
  assert(!sub1.json?.locked, "Attempt 1: question is not locked");

  const sub2 = await request(
    {
      hostname: "localhost",
      path: "/api/trackA/submit",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: team1Cookie },
    },
    { questionCode: "A1", answer: "wrong-answer-2" }
  );
  assert(sub2.statusCode === 200 && sub2.json?.attempts === 2, "Attempt 2 recorded as attempts=2");
  assert(sub2.json?.attemptsRemaining === 1, "Attempt 2: attemptsRemaining is 1");
  assert(!sub2.json?.locked, "Attempt 2: question is not locked");

  const sub3 = await request(
    {
      hostname: "localhost",
      path: "/api/trackA/submit",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: team1Cookie },
    },
    { questionCode: "A1", answer: "wrong-answer-3" }
  );
  assert(sub3.statusCode === 200 && sub3.json?.attempts === 3, "Attempt 3 recorded as attempts=3");
  assert(sub3.json?.attemptsRemaining === 0, "Attempt 3: attemptsRemaining is 0");
  assert(sub3.json?.locked === true, "Attempt 3: question is now LOCKED");
  assert(!sub3.json?.expectedAnswer && !sub3.json?.solution, "Attempt 3: answer is NOT leaked when locked");

  // Attempt 4 must be rejected server-side
  const sub4 = await request(
    {
      hostname: "localhost",
      path: "/api/trackA/submit",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: team1Cookie },
    },
    { questionCode: "A1", answer: "192.168.1.1" }
  );
  assert(sub4.statusCode === 200 && sub4.json?.locked === true, "Attempt 4 rejected: question remains LOCKED");
  assert(sub4.json?.attempts === 3, "Attempt 4 rejected: attempts counter stays clamped at 3");
  assert(!sub4.json?.correct, "Attempt 4 rejected: cannot be solved after locking");

  // Verify GET /api/team/state retains locked state across refresh
  const stateAfterLock = await request({
    hostname: "localhost",
    path: "/api/team/state",
    method: "GET",
    headers: { Cookie: team1Cookie },
  });
  assert(stateAfterLock.json?.attempts?.trackA === 3, "Team state on refresh preserves trackA attempts=3");
  assert(stateAfterLock.json?.attempts?.maxAttempts === 3, "Track maxAttempts is 3 in team state");
  assert(stateAfterLock.json?.stage === "trackB", "Team advances to Track B so remaining tracks are playable");

  // 10. Admin Reset Single Team
  const resetT1 = await request(
    {
      hostname: "localhost",
      path: "/api/admin/reset-team",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    },
    { code: "ACN01" }
  );
  assert(resetT1.statusCode === 200 && resetT1.json?.ok, "Admin can reset a single test team (ACN01)");

  // 11. Admin Reset Event
  const resetAllRes = await request(
    {
      hostname: "localhost",
      path: "/api/admin/reset-event",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
    },
    { confirm: "RESET" }
  );
  assert(resetAllRes.statusCode === 200 && resetAllRes.json?.ok, "Admin can reset event state with confirmation");

  const finalStatus = await request({
    hostname: "localhost",
    path: "/api/event/status",
    method: "GET",
  });
  assert(finalStatus.json?.event?.phase === "not_started", "Event phase is 'not_started' after reset");

  console.log("\n==================================================");
  console.log(`TOTAL PASSED: ${passed}`);
  console.log(`TOTAL FAILED: ${failed}`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runE2ETests().catch((err) => {
  console.error("E2E test error:", err);
  process.exit(1);
});
