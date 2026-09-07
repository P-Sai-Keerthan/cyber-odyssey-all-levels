import { prisma } from '../src/lib/prisma';
import { generateExternalTeamRef, isWellFormedExternalTeamRef } from '../src/lib/team/external-ref';
import {
  signBody,
  LEVEL1_SIGNATURE_HEADER,
  LEVEL1_TIMESTAMP_HEADER,
} from '../src/lib/integration/hmac';
import { getLeaderboardStandings } from '../src/lib/leaderboard/standings';
import { getTeamLevel1Score } from '../src/lib/level1/scoring';
import crypto from 'crypto';

const TICKET_BYTES = 32;
const TICKET_TTL_MS = 2 * 60 * 1000;

function hashTicket(ticket: string): string {
  return crypto.createHash('sha256').update(ticket, 'utf8').digest('hex');
}

function generateTicketValue(): string {
  return crypto.randomBytes(TICKET_BYTES).toString('hex');
}

async function issueTicket(params: {
  teamId: string;
  level: number;
  issuedToUserId?: string | null;
}) {
  const ticket = generateTicketValue();
  const tokenHash = hashTicket(ticket);
  const expiresAt = new Date(Date.now() + TICKET_TTL_MS);

  await prisma.integrationTicket.updateMany({
    where: { teamId: params.teamId, level: params.level, redeemedAt: null },
    data: { expiresAt: new Date() },
  });

  await prisma.integrationTicket.create({
    data: {
      tokenHash,
      teamId: params.teamId,
      level: params.level,
      issuedToUserId: params.issuedToUserId ?? null,
      expiresAt,
    },
  });

  return { ticket, expiresAt };
}

// The Portal serves on 3002 (package.json: `next start -p 3002`). This said 3000,
// so every Portal-side request in this script hit a closed port and the script
// could only ever report the Level 1 half of the bridge.
const PORTAL_URL = process.env['PORTAL_BASE_URL'] ?? 'http://localhost:3002';
const LEVEL1_URL = process.env['LEVEL1_CHALLENGE_URL'] ?? 'http://localhost:3001';
const SECRET =
  process.env['ODYSSEY_LEVEL1_SECRET'] || 'test-level1-secret-value-do-not-use-in-production';

interface TestResult {
  step: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(step: string, passed: boolean, details: string) {
  results.push({ step, passed, details });
  console.log(`${passed ? '✓ PASS' : '✗ FAIL'} [${step}] - ${details}`);
}

async function main() {
  console.log('============================================================');
  console.log('STARTING LIVE PORTAL <-> LEVEL 1 INTEGRATION VERIFICATION');
  console.log('============================================================');

  const timestamp = Date.now();
  const testUsername = `test_user_${timestamp}`;
  const testTeamName = `Test Squad ${timestamp}`;
  const externalTeamRef = generateExternalTeamRef();
  let adminCookie = '';

  console.log(`Test Team: "${testTeamName}", ExternalRef: "${externalTeamRef}"`);

  try {
    // 0. Ensure Level 1 is OPEN in the Portal.
    //
    // Setting status alone is not enough, and getting that wrong is expensive to
    // diagnose. The bridge's own condition is `status === 'LIVE' && !isExpired`,
    // so a level whose window has run out is LIVE and still refuses every ticket
    // with LEVEL_NOT_LIVE. This step used to set only the status and then report
    // PASS — after which nine downstream checks failed with `entry=closed` and
    // nothing said why. The window is opened here explicitly.
    const durationSeconds = 60 * 60;
    const openedAt = new Date();
    const closesAt = new Date(openedAt.getTime() + durationSeconds * 1000);
    await prisma.levelState.upsert({
      where: { levelNumber: 1 },
      update: {
        status: 'LIVE',
        startedAt: openedAt,
        endsAt: closesAt,
        remainingSeconds: durationSeconds,
        pausedAt: null,
        completedAt: null,
      },
      create: {
        levelNumber: 1,
        name: 'Level 1: Threat Hunting & AppSec',
        codename: 'LEVEL_1',
        status: 'LIVE',
        startedAt: openedAt,
        endsAt: closesAt,
        durationMinutes: 60,
        durationSeconds,
        remainingSeconds: durationSeconds,
      },
    });
    record(
      '0. Level 1 State',
      true,
      `Level 1 LIVE with an open window in the Portal (closes ${closesAt.toISOString()}).`,
    );

    // 1. Create Portal team and participant
    record(
      '1. External Team Ref Format',
      isWellFormedExternalTeamRef(externalTeamRef),
      `Ref "${externalTeamRef}" is well-formed.`,
    );

    const user = await prisma.user.create({
      data: {
        email: `${testUsername}@example.test`,
        username: testUsername,
        passwordHash: 'dummy_hash_for_test',
        role: 'PARTICIPANT',
        status: 'ACTIVE',
      },
    });

    const team = await prisma.team.create({
      data: {
        name: testTeamName,
        code: `TST${Math.floor(Math.random() * 9000 + 1000)}`,
        status: 'ACTIVE',
        externalRef: externalTeamRef,
        score: 0,
        passwordHash: 'dummy_team_password_hash',
        creatorId: user.id,
      },
    });

    await prisma.teamMember.create({
      data: {
        userId: user.id,
        teamId: team.id,
        role: 'LEADER',
        slot: 1,
      },
    });
    record(
      '1. Portal Team Creation',
      Boolean(team.id && team.externalRef),
      `Created team "${team.name}" (ID: ${team.id}, ExtRef: ${team.externalRef})`,
    );

    // 2. Mint short-lived one-time Level 1 exchange ticket
    const ticketResult = await issueTicket({
      teamId: team.id,
      level: 1,
      issuedToUserId: user.id,
    });
    const { ticket } = ticketResult;
    const ticketHash = hashTicket(ticket);
    const storedTicket = await prisma.integrationTicket.findUnique({
      where: { tokenHash: ticketHash },
    });

    const ticketValid = Boolean(
      ticket &&
      ticket.length === 64 &&
      storedTicket &&
      storedTicket.teamId === team.id &&
      storedTicket.level === 1 &&
      storedTicket.redeemedAt === null,
    );
    record(
      '2. Ticket Minting & Binding',
      ticketValid,
      `Minted 64-hex ticket, hashed in DB and bound to team ${team.id} for Level 1.`,
    );

    // 3. Security: Cross-level ticket rejection (Level 3 ticket cannot be redeemed at Level 1 endpoint)
    const { ticket: level3Ticket } = await issueTicket({
      teamId: team.id,
      level: 3,
      issuedToUserId: user.id,
    });
    const level3Body = JSON.stringify({
      ticket: level3Ticket,
      requestId: crypto.randomUUID(),
      nonce: crypto.randomUUID(),
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signBody(SECRET, level3Body, ts);
    const wrongLevelRes = await fetch(`${PORTAL_URL}/api/integration/level1/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [LEVEL1_SIGNATURE_HEADER]: sig,
        [LEVEL1_TIMESTAMP_HEADER]: ts,
      },
      body: level3Body,
    });
    const wrongLevelData = (await wrongLevelRes.json()) as any;
    const wrongLevelBlocked =
      wrongLevelRes.status === 409 && wrongLevelData.code === 'TICKET_WRONG_LEVEL';
    record(
      '3. Cross-Level Ticket Rejection',
      wrongLevelBlocked,
      `Level 3 ticket presented to Level 1 endpoint rejected: HTTP ${wrongLevelRes.status}, code=${wrongLevelData.code}`,
    );

    // Mint fresh Level 1 ticket for actual Level 1 handoff
    const { ticket: liveTicket } = await issueTicket({
      teamId: team.id,
      level: 1,
      issuedToUserId: user.id,
    });

    // 4. Test Tampered / Invalid ticket at Level 1 /api/enter
    const invalidTicketRes = await fetch(
      `${LEVEL1_URL}/api/enter?ticket=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`,
      {
        redirect: 'manual',
      },
    );
    const invalidRedirect = invalidTicketRes.headers.get('location');
    record(
      '4. Tampered Ticket Rejection',
      Boolean(invalidTicketRes.status === 302 && invalidRedirect?.includes('entry=')),
      `Tampered ticket redirected to ${invalidRedirect}`,
    );

    // 5. One-time secure handoff: Level 1 redeems ticket server-to-server
    const enterRes = await fetch(`${LEVEL1_URL}/api/enter?ticket=${liveTicket}`, {
      redirect: 'manual',
    });
    const enterRedirect = enterRes.headers.get('location');
    const setCookieHeader = enterRes.headers.get('set-cookie') || '';
    const hasSbTeamCookie = setCookieHeader.includes('sb_team=');
    const sbTeamCookieMatch = setCookieHeader.match(/sb_team=([^;]+)/);
    const sbTeamCookie = sbTeamCookieMatch ? `sb_team=${sbTeamCookieMatch[1]}` : '';

    record(
      '5. One-Time Secure Handoff',
      enterRes.status === 302 && enterRedirect === '/hub',
      `HTTP 302 redirect to /hub (Location: ${enterRedirect})`,
    );
    record(
      '5. Level 1 Session Creation',
      hasSbTeamCookie,
      'Level 1 generated signed sb_team session cookie. No password or manual code required.',
    );

    // 6. Confirm Ticket Reuse Prevention (Single-Use Replay Protection)
    const replayRes = await fetch(`${LEVEL1_URL}/api/enter?ticket=${liveTicket}`, {
      redirect: 'manual',
    });
    const replayRedirect = replayRes.headers.get('location');
    record(
      '6. Ticket Single-Use Guarantee',
      Boolean(replayRes.status === 302 && replayRedirect?.includes('entry=used')),
      `Replayed ticket redirected to ${replayRedirect}`,
    );

    // 7. Verify Level 1 knows the authenticated team
    const teamStateRes = await fetch(`${LEVEL1_URL}/api/team/state`, {
      headers: { Cookie: sbTeamCookie },
    });
    const teamState = (await teamStateRes.json()) as any;
    const teamRecognized = Boolean(
      teamStateRes.status === 200 && teamState.team && teamState.team.name === testTeamName,
    );
    record(
      '7. Level 1 Team Context',
      teamRecognized,
      `Level 1 identifies team "${teamState?.team?.name}" (code: ${teamState?.team?.code})`,
    );

    // Ensure Level 1 event clock is open/running so submissions are accepted
    const adminLoginRes = await fetch(`${LEVEL1_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // From the environment. A literal here was the published default that
      // Level 1 no longer accepts, so this call would silently fail.
      body: JSON.stringify({ password: (process.env['ADMIN_PASSWORD'] ?? '').trim() }),
    });
    adminCookie = adminLoginRes.headers.get('set-cookie')?.split(';')[0] || '';
    await fetch(`${LEVEL1_URL}/api/admin/start-event`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });

    // 8. Solve Track A Question A1
    // A1 requires: IP 203.0.113.77 and host smtp-out.ithacah01dings.com
    const solveRes = await fetch(`${LEVEL1_URL}/api/trackA/submit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: sbTeamCookie,
      },
      body: JSON.stringify({
        questionCode: 'A1',
        answer: '203.0.113.77 smtp-out.ithacah01dings.com',
        evidence: 'Received header analysis from spoofed HR email',
      }),
    });
    const solveData = (await solveRes.json()) as any;
    record(
      '8. Level 1 Question Solve (A1)',
      solveRes.status === 200 && solveData.correct === true,
      `Solve accepted: correct=${solveData.correct}, attempts=${solveData.attempts}, pointsAwarded=${solveData.pointsAwarded}`,
    );

    // Wait a moment for outbox maybeDrain to deliver to Portal
    console.log('Waiting for Level 1 outbox drain to Portal...');
    await new Promise((r) => setTimeout(r, 3000));

    // Check Portal database for Level1Result
    const portalResult = await prisma.level1Result.findFirst({
      where: {
        teamId: team.id,
        challenge: { externalRef: 'A1' },
      },
      include: { challenge: true },
    });

    const scoreReceived = Boolean(portalResult && portalResult.awardedPoints === 5);
    record(
      '9. Portal Score Ingestion',
      scoreReceived,
      `Portal ingested solve for team "${team.name}": Challenge A1, authoritative awardedPoints=${portalResult?.awardedPoints}`,
    );

    // 10. Check Leaderboard Standings
    const standings = await getLeaderboardStandings();
    const teamStanding = standings.rows.find((s) => s.id === team.id);
    const leaderboardCorrect = Boolean(teamStanding && teamStanding.levelScores[1] === 5);
    record(
      '10. Leaderboard Reflection',
      leaderboardCorrect,
      `Leaderboard reports Level 1 score = ${teamStanding?.levelScores[1]} for squad "${teamStanding?.name}"`,
    );

    // 11. Duplicate Solve Prevention (Idempotency)
    const duplicateSolveRes = await fetch(`${LEVEL1_URL}/api/trackA/submit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Cookie: sbTeamCookie,
      },
      body: JSON.stringify({
        questionCode: 'A1',
        answer: '203.0.113.77 smtp-out.ithacah01dings.com',
        evidence: 'duplicate submit',
      }),
    });
    const duplicateSolveData = (await duplicateSolveRes.json()) as any;
    const duplicatePrevented = duplicateSolveData.alreadyDone === true;

    await new Promise((r) => setTimeout(r, 1000));
    const scoreAfterDuplicate = await getTeamLevel1Score(team.id);
    const scoreRemainsOriginal =
      scoreAfterDuplicate.officialScore === 5 && scoreAfterDuplicate.solvedCount === 1;
    record(
      '11. Duplicate Solve Idempotency',
      duplicatePrevented && scoreRemainsOriginal,
      `Repeat solve rejected: alreadyDone=${duplicateSolveData.alreadyDone}, points=${duplicateSolveData.pointsAwarded}, Portal official score remains ${scoreAfterDuplicate.officialScore} (solvedCount: ${scoreAfterDuplicate.solvedCount})`,
    );

    // 12. Attempt Limit Verification (MAX_ATTEMPTS = 3)
    console.log('Testing 3-attempt limit on Track A question A2...');
    // Attempt 1: wrong answer
    const att1Res = await fetch(`${LEVEL1_URL}/api/trackA/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: sbTeamCookie },
      body: JSON.stringify({ questionCode: 'A2', answer: 'wrong_answer_1' }),
    });
    const att1 = (await att1Res.json()) as any;

    // Attempt 2: wrong answer
    const att2Res = await fetch(`${LEVEL1_URL}/api/trackA/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: sbTeamCookie },
      body: JSON.stringify({ questionCode: 'A2', answer: 'wrong_answer_2' }),
    });
    const att2 = (await att2Res.json()) as any;

    // Attempt 3: wrong answer
    const att3Res = await fetch(`${LEVEL1_URL}/api/trackA/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: sbTeamCookie },
      body: JSON.stringify({ questionCode: 'A2', answer: 'wrong_answer_3' }),
    });
    const att3 = (await att3Res.json()) as any;

    // Attempt 4: should be locked / rejected
    const att4Res = await fetch(`${LEVEL1_URL}/api/trackA/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Cookie: sbTeamCookie },
      body: JSON.stringify({ questionCode: 'A2', answer: 'wrong_answer_4' }),
    });
    const att4 = (await att4Res.json()) as any;

    const attemptsStrictly3 = Boolean(
      att1.correct === false &&
      att1.attempts === 1 &&
      att1.attemptsRemaining === 2 &&
      !att1.locked &&
      att2.correct === false &&
      att2.attempts === 2 &&
      att2.attemptsRemaining === 1 &&
      !att2.locked &&
      att3.correct === false &&
      att3.attempts === 3 &&
      att3.attemptsRemaining === 0 &&
      att3.locked &&
      att4.correct === false &&
      att4.locked === true &&
      att4.attemptsRemaining === 0 &&
      att4.attempts === 3,
    );
    record(
      '12. 3-Attempt Limit Enforcement',
      attemptsStrictly3,
      `Attempt 1: attempts=1, rem=2; Attempt 2: attempts=2, rem=1; Attempt 3: attempts=3, locked=true; Attempt 4: rejected (locked=true, attempts=3).`,
    );

    // 13. Security: Client cannot control points
    // Test direct POST to Portal score API with client-supplied points: 9999
    const spoofEvent = {
      eventId: crypto.randomUUID(),
      nonce: crypto.randomUUID(),
      eventType: 'LEVEL1_CHALLENGE_SOLVED',
      externalTeamRef: externalTeamRef,
      externalChallengeRef: 'A3',
      points: 9999, // client attempt to inject 9999 points
    };
    const spoofRaw = JSON.stringify(spoofEvent);
    const spoofTs = String(Math.floor(Date.now() / 1000));
    const spoofSig = signBody(SECRET, spoofRaw, spoofTs);

    const spoofRes = await fetch(`${PORTAL_URL}/api/integration/level1/score`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [LEVEL1_SIGNATURE_HEADER]: spoofSig,
        [LEVEL1_TIMESTAMP_HEADER]: spoofTs,
      },
      body: spoofRaw,
    });
    await spoofRes.json();
    const a3Result = await prisma.level1Result.findFirst({
      where: { teamId: team.id, challenge: { externalRef: 'A3' } },
    });
    const clientPointsIgnored = a3Result?.awardedPoints === 10; // Catalogue points for A3 is 10, not 9999
    record(
      '13. Client-Controlled Points Ignored',
      spoofRes.status === 200 && clientPointsIgnored,
      `Injected points=9999 ignored by Portal; authoritative score awarded: ${a3Result?.awardedPoints} pts (catalogue value)`,
    );

    // 14. Security: Forged HMAC Signature Rejection
    const badSigRes = await fetch(`${PORTAL_URL}/api/integration/level1/score`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [LEVEL1_SIGNATURE_HEADER]: 'invalid_hmac_signature_hex',
        [LEVEL1_TIMESTAMP_HEADER]: spoofTs,
      },
      body: spoofRaw,
    });
    record(
      '14. Forged HMAC Signature Rejection',
      badSigRes.status === 401,
      `Forged HMAC rejected with HTTP ${badSigRes.status}`,
    );

    // 15. Security: Expired Timestamp Rejection
    const oldTs = String(Math.floor(Date.now() / 1000) - 600); // 10 minutes ago
    const oldSig = signBody(SECRET, spoofRaw, oldTs);
    const expiredTsRes = await fetch(`${PORTAL_URL}/api/integration/level1/score`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [LEVEL1_SIGNATURE_HEADER]: oldSig,
        [LEVEL1_TIMESTAMP_HEADER]: oldTs,
      },
      body: spoofRaw,
    });
    record(
      '15. Expired Timestamp Rejection',
      expiredTsRes.status === 401,
      `Timestamp older than clock skew rejected with HTTP ${expiredTsRes.status}`,
    );

    // 16. Security: Unauthenticated Level 1 Submission Rejection
    const unauthSubmitRes = await fetch(`${LEVEL1_URL}/api/trackA/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }, // No cookie
      body: JSON.stringify({
        questionCode: 'A1',
        answer: '203.0.113.77 smtp-out.ithacah01dings.com',
      }),
    });
    record(
      '16. Unauthenticated Level 1 Request Rejection',
      unauthSubmitRes.status === 401,
      `Request without session rejected with HTTP ${unauthSubmitRes.status}`,
    );
  } catch (err: any) {
    console.error('Unhandled error during integration verification:', err);
    record('Verification Execution', false, `Error: ${err.message}`);
  } finally {
    if (adminCookie) {
      await fetch(`${LEVEL1_URL}/api/admin/reset-event`, {
        method: 'POST',
        headers: { Cookie: adminCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESET' }),
      }).catch(() => {});
    }

    console.log('\n============================================================');
    console.log('VERIFICATION SUMMARY:');
    console.log('============================================================');
    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.filter((r) => !r.passed).length;
    console.log(`Total Checks: ${results.length}`);
    console.log(`Passed: ${passedCount}`);
    console.log(`Failed: ${failedCount}`);
    if (failedCount > 0) {
      console.log('Failed steps:');
      results.filter((r) => !r.passed).forEach((r) => console.log(`  - ${r.step}: ${r.details}`));
    }
    console.log('============================================================');
  }
}

main().catch(console.error);
