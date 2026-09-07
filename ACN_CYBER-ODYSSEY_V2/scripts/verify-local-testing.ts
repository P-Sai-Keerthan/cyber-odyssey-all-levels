import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { verifyPassword } from '../src/lib/auth/password';
import { issueTicket, hashTicket } from '../src/lib/level1/tickets';
import { getLeaderboardStandings } from '../src/lib/leaderboard/standings';
import { LOCAL_TEST_TEAMS, TEST_PASSWORD } from './seed-local-testing';

const prisma = new PrismaClient();

const PORTAL_URL = process.env['PORTAL_URL'] || 'http://localhost:3002';
const LEVEL1_URL = process.env['LEVEL1_CHALLENGE_URL'] || 'http://localhost:3000';

interface TestResult {
  section: string;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(section: string, name: string, passed: boolean, details: string) {
  results.push({ section, name, passed, details });
  const tag = passed ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
  console.log(`${tag} ${section} :: ${name} - ${details}`);
}

async function requestGet(url: string, cookie?: string): Promise<Response> {
  return fetch(url, {
    method: 'GET',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
    },
    redirect: 'manual',
  });
}

async function requestPost(url: string, body: any, cookie?: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
}

async function main() {
  console.log('======================================================================');
  console.log('  CYBER ODYSSEY LOCAL TESTING SETUP VERIFICATION');
  console.log('  Portal:  ' + PORTAL_URL);
  console.log('  Level 1: ' + LEVEL1_URL);
  console.log('======================================================================\n');

  // -------------------------------------------------------------------------
  // SECTION 1: Portal Test Accounts & Roles
  // -------------------------------------------------------------------------
  console.log('\n--- 1. PORTAL TEST ACCOUNTS & ROLES ---');
  const rolesToCheck = [
    { role: 'PARTICIPANT', email: 'test_p1_t1@odyssey.local' },
    { role: 'EVALUATOR', email: 'test_evaluator@odyssey.local' },
    { role: 'ADMIN', email: 'test_admin@odyssey.local' },
    { role: 'CREATOR', email: 'test_creator@odyssey.local' },
  ];

  for (const { role, email } of rolesToCheck) {
    const user = await prisma.user.findUnique({ where: { email } });
    const existsAndActive = Boolean(user && user.role === role && user.status === 'ACTIVE');
    record(
      '1. Account Roles',
      `${role} Account Presence`,
      existsAndActive,
      `User ${email} found with role=${user?.role} and status=${user?.status}`,
    );

    if (user) {
      const pwValid = await verifyPassword(TEST_PASSWORD, user.passwordHash);
      record(
        '1. Account Roles',
        `${role} Password Verification`,
        pwValid,
        `Shared test password "${TEST_PASSWORD}" verified for ${email}`,
      );

      const wrongPw = await verifyPassword('WrongPassword123!', user.passwordHash);
      record(
        '1. Account Roles',
        `${role} Wrong Password Rejection`,
        !wrongPw,
        `Incorrect password cleanly rejected for ${email}`,
      );
    }
  }

  // Verify Default Creators
  // Read from the environment, never from a literal. These are two real people's
  // CREATOR passwords — the portal's highest privilege — and they used to sit in
  // this file in plain text. When the variables are unset there is nothing to
  // verify, and the check reports that rather than inventing a credential.
  const env = (k: string) => (process.env[k] ?? '').trim().replace(/^["']|["']$/g, '');
  const defaultCreators = [
    {
      email: env('CREATOR_EMAIL'),
      username: env('CREATOR_USERNAME'),
      password: env('CREATOR_PASSWORD'),
    },
    {
      email: env('CREATOR_2_EMAIL'),
      username: env('CREATOR_2_USERNAME'),
      password: env('CREATOR_2_PASSWORD'),
    },
  ].filter((c) => c.email && c.password);

  for (const c of defaultCreators) {
    const creatorUser = await prisma.user.findUnique({ where: { email: c.email } });
    const creatorValid = Boolean(
      creatorUser &&
      creatorUser.role === 'CREATOR' &&
      creatorUser.status === 'ACTIVE' &&
      creatorUser.username === c.username,
    );
    record(
      '1. Account Roles',
      `Default Creator (${c.username}) Presence`,
      creatorValid,
      `User ${c.email} (username=${creatorUser?.username}) found with role=${creatorUser?.role} and status=${creatorUser?.status}`,
    );

    if (creatorUser) {
      const pwValid = await verifyPassword(c.password, creatorUser.passwordHash);
      record(
        '1. Account Roles',
        `Default Creator (${c.username}) Password`,
        pwValid,
        `Designated password verified for ${c.email}`,
      );

      const wrongPw = await verifyPassword('WrongPassword999!', creatorUser.passwordHash);
      record(
        '1. Account Roles',
        `Default Creator (${c.username}) Wrong Password Rejection`,
        !wrongPw,
        `Incorrect password cleanly rejected for ${c.email}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // SECTION 2: Portal Test Teams & Capacity Verification
  // -------------------------------------------------------------------------
  console.log('\n--- 2. PORTAL TEST TEAMS & CAPACITIES ---');
  for (const t of LOCAL_TEST_TEAMS) {
    const team = await prisma.team.findUnique({
      where: { name: t.name },
      include: { members: { include: { user: true } } },
    });

    const found = Boolean(team);
    record(
      '2. Team Structure',
      `${t.name} Presence`,
      found,
      `Team "${t.name}" found with code=${team?.code}, externalRef=${team?.externalRef}`,
    );

    const memberCount = team?.members.length ?? 0;
    const expectedCount = t.members.length;
    record(
      '2. Team Structure',
      `${t.name} Member Count`,
      memberCount === expectedCount,
      `Team has ${memberCount} member(s), expected ${expectedCount}`,
    );

    // Verify slots are contiguous (1..memberCount)
    const slots = (team?.members || []).map((m) => m.slot).sort();
    const expectedSlots = Array.from({ length: expectedCount }, (_, i) => i + 1);
    const slotsValid = JSON.stringify(slots) === JSON.stringify(expectedSlots);
    record(
      '2. Team Structure',
      `${t.name} Slots (1..N)`,
      slotsValid,
      `Slots assigned: [${slots.join(', ')}]`,
    );
  }

  // Verify Over-capacity constraint: Adding 4th member to Team 03 fails
  const team03 = await prisma.team.findUnique({ where: { name: 'ACN Test Team 03' } });
  const unassigned = await prisma.user.findUnique({
    where: { email: 'test_unassigned@odyssey.local' },
  });
  let overCapacityBlocked = false;

  if (team03 && unassigned) {
    try {
      await prisma.teamMember.create({
        data: { teamId: team03.id, userId: unassigned.id, slot: 3, role: 'MEMBER' },
      });
    } catch (e: any) {
      overCapacityBlocked = e.code === 'P2002' || String(e.message).includes('Unique constraint');
    }
  }
  record(
    '2. Team Structure',
    'Database Capacity Constraint',
    overCapacityBlocked,
    'Attempting to exceed capacity (colliding slot 3) rejected with unique constraint error',
  );

  // -------------------------------------------------------------------------
  // SECTION 3: Level 1 Matching Teams Alignment
  // -------------------------------------------------------------------------
  console.log('\n--- 3. LEVEL 1 MATCHING TEAMS ---');
  const level1Root = path.resolve(process.cwd(), '../cyber-odyssey-app level-1');
  const level1EnvFile = fs.readFileSync(path.join(level1Root, '.env'), 'utf8');
  const pgDbMatch = level1EnvFile.match(/DATABASE_URL="([^"]+)"/);
  const pgDbUrl = pgDbMatch
    ? pgDbMatch[1]
    : 'postgresql://postgres:postgres@localhost:5432/cyber_odyssey';

  // Read Level 1 Postgres teams via quick node script
  const readL1TeamsScript = `
    const { pool } = require('./lib/db');
    async function r() {
      const res = await pool.query('SELECT code, name, portal_team_ref FROM teams WHERE portal_team_ref IS NOT NULL');
      console.log(JSON.stringify(res.rows));
      await pool.end();
    }
    r();
  `;
  const l1TeamsJson = execSync('node', {
    input: readL1TeamsScript,
    cwd: level1Root,
    env: { ...process.env, DATABASE_URL: pgDbUrl },
  }).toString();
  const l1Teams: Array<{ code: string; name: string; portal_team_ref: string }> =
    JSON.parse(l1TeamsJson);

  for (const t of LOCAL_TEST_TEAMS) {
    const matchingL1 = l1Teams.find((l) => l.portal_team_ref === t.externalRef);
    const matchOk = Boolean(matchingL1 && matchingL1.name === t.name);
    record(
      '3. Level 1 Matching Teams',
      `Level 1 Link (${t.name})`,
      matchOk,
      `Matched Level 1 team code=${matchingL1?.code} with portal_team_ref=${matchingL1?.portal_team_ref}`,
    );
  }

  // -------------------------------------------------------------------------
  // SECTION 4: Complete Participant Journey
  // -------------------------------------------------------------------------
  console.log('\n--- 4. COMPLETE PARTICIPANT JOURNEY (PORTAL -> LEVEL 1 -> PORTAL) ---');
  const testTeam01 = await prisma.team.findUnique({
    where: { name: 'ACN Test Team 01' },
    include: { members: { include: { user: true } } },
  });
  if (!testTeam01) throw new Error('ACN Test Team 01 not found');
  const teamLead = testTeam01.members[0]!.user;

  // Clean previous answers for Team 01 in both databases to guarantee a clean slate
  const cleanL1Answers = `
    const { pool } = require('./lib/db');
    async function r() {
      await pool.query("UPDATE config SET value = 'running' WHERE key = 'event_state'");
      await pool.query("UPDATE config SET value = $1 WHERE key = 'event_start_at'", [new Date().toISOString()]);
      const res = await pool.query("SELECT id FROM teams WHERE portal_team_ref = 'co_00000000000000000000000000000001'");
      if (res.rows[0]) {
        await pool.query("DELETE FROM track_answers WHERE team_id = $1", [res.rows[0].id]);
        await pool.query("DELETE FROM integration_outbox WHERE team_id = $1", [res.rows[0].id]);
        await pool.query("UPDATE teams SET track_a_attempts = 0, stage1_attempts = 0, stage1_completed_at = null WHERE id = $1", [res.rows[0].id]);
      }
      await pool.end();
    }
    r();
  `;
  execSync('node', {
    input: cleanL1Answers,
    cwd: level1Root,
    env: { ...process.env, DATABASE_URL: pgDbUrl },
  });
  await prisma.level1Result.deleteMany({ where: { teamId: testTeam01.id } });
  await prisma.level1Penalty.deleteMany({ where: { teamId: testTeam01.id } });
  await prisma.integrationEvent.deleteMany({ where: { externalTeamRef: testTeam01.externalRef! } });

  // Step 1: Portal Issues Launch Ticket
  const { ticket } = await issueTicket({
    teamId: testTeam01.id,
    level: 1,
    issuedToUserId: teamLead.id,
  });
  const ticketInDb = await prisma.integrationTicket.findUnique({
    where: { tokenHash: hashTicket(ticket) },
  });
  record(
    '4. Complete Journey',
    'Launch Ticket Issuance',
    Boolean(ticket && ticketInDb?.redeemedAt === null),
    `Portal issued 64-hex ticket: ${ticket.slice(0, 16)}...`,
  );

  // Step 2: Handoff to Level 1 /api/enter?ticket=...
  const enterRes = await requestGet(`${LEVEL1_URL}/api/enter?ticket=${ticket}`);
  const redirectTarget = enterRes.headers.get('location');
  const setCookie = enterRes.headers.get('set-cookie') || '';
  const cookieMatch = setCookie.match(/sb_team=([^;]+)/);
  const sbCookie = cookieMatch ? `sb_team=${cookieMatch[1]}` : '';

  const redeemedOk = enterRes.status === 302 && redirectTarget === '/hub' && Boolean(sbCookie);
  record(
    '4. Complete Journey',
    'Level 1 Ticket Redemption',
    redeemedOk,
    `Handoff redirect to ${redirectTarget} with signed sb_team session cookie.`,
  );

  // Step 3: Verify Level 1 Hub State
  const hubStateRes = await requestGet(`${LEVEL1_URL}/api/team/state`, sbCookie);
  const hubState = (await hubStateRes.json()) as any;
  const hubOk = hubStateRes.status === 200 && hubState?.team?.name === 'ACN Test Team 01';
  record(
    '4. Complete Journey',
    'Level 1 Hub Access & Identity',
    hubOk,
    `Level 1 recognized squad as "${hubState?.team?.name}" without second login.`,
  );

  // Step 4: Participant Solves Question A1 on Level 1
  const submitRes = await requestPost(
    `${LEVEL1_URL}/api/trackA/submit`,
    {
      questionCode: 'A1',
      answer: '203.0.113.77 smtp-out.ithacah01dings.com',
      evidence: 'Local testing verification solve evidence for A1',
    },
    sbCookie,
  );
  const submitData = (await submitRes.json()) as any;
  record(
    '4. Complete Journey',
    'Challenge Solve Submission (A1)',
    Boolean(submitRes.status === 200 && submitData?.correct),
    `Level 1 accepted answer for A1: correct=${submitData?.correct}`,
  );

  // Step 5: Drain Outbox to sync score to Portal
  const drainOutput = execSync('node scripts/drain-outbox.js', {
    cwd: level1Root,
    env: { ...process.env, DATABASE_URL: pgDbUrl },
  }).toString();
  const drainOk =
    !drainOutput.includes('"FAILED": [1-9]') && !drainOutput.includes('ABANDONED event(s)');
  record(
    '4. Complete Journey',
    'Outbox Score Synchronization',
    drainOk,
    `Score event queued and delivered cleanly without errors.`,
  );

  // Step 6: Verify Portal Leaderboard Reflection
  const standings = await getLeaderboardStandings();
  const teamRow = standings.rows.find((r) => r.id === testTeam01.id);
  const resultsCount = await prisma.level1Result.count({
    where: { teamId: testTeam01.id },
  });
  const leaderboardOk = Boolean(teamRow && teamRow.levelScores[1] === 5 && resultsCount === 1);
  record(
    '4. Complete Journey',
    'Portal Leaderboard Score Reflection',
    leaderboardOk,
    `Portal leaderboard standings reflect Level 1 score: ${teamRow?.levelScores[1]} pts (Total: ${teamRow?.totalScore} pts).`,
  );

  // -------------------------------------------------------------------------
  // SECTION 5: Security Invariants
  // -------------------------------------------------------------------------
  console.log('\n--- 5. SECURITY INVARIANTS ---');

  // Vector 1: Replaying Spent Ticket
  const replayRes = await requestGet(`${LEVEL1_URL}/api/enter?ticket=${ticket}`);
  const replayRedirect = replayRes.headers.get('location');
  record(
    '5. Security',
    'Ticket Replay Prevention',
    Boolean(replayRes.status === 302 && replayRedirect?.includes('entry=used')),
    `Replayed ticket rejected with redirect to ${replayRedirect}`,
  );

  // Vector 2: Expired Ticket Rejection
  const expiredPast = new Date(Date.now() - 5 * 60 * 1000);
  const { ticket: expiredTicket } = await issueTicket({
    teamId: testTeam01.id,
    level: 1,
    now: expiredPast,
  });
  const expiredRes = await requestGet(`${LEVEL1_URL}/api/enter?ticket=${expiredTicket}`);
  const expiredRedirect = expiredRes.headers.get('location');
  record(
    '5. Security',
    'Expired Ticket Rejection',
    Boolean(expiredRes.status === 302 && expiredRedirect?.includes('entry=expired')),
    `Expired ticket rejected with redirect to ${expiredRedirect}`,
  );

  // Vector 3: Forged HMAC Signature Rejection
  const forgedRes = await fetch(`${PORTAL_URL}/api/integration/level1/score`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-odyssey-signature': 'forged_invalid_hmac_signature',
      'x-odyssey-timestamp': String(Date.now()),
    },
    body: JSON.stringify({
      eventId: '11111111-1111-1111-1111-111111111111',
      nonce: '22222222-2222-2222-2222-222222222222',
      eventType: 'LEVEL1_CHALLENGE_SOLVED',
      externalTeamRef: 'co_00000000000000000000000000000001',
      externalChallengeRef: 'A2',
    }),
  });
  record(
    '5. Security',
    'Forged HMAC Signature Rejection',
    forgedRes.status === 401,
    `Forged score POST rejected with HTTP status ${forgedRes.status}`,
  );

  // Vector 4: Unauthenticated Session Isolation on Level 1
  const unauthRes = await requestGet(`${LEVEL1_URL}/api/team/state`);
  record(
    '5. Security',
    'Level 1 Session Isolation',
    unauthRes.status === 401,
    `Request without session cookie rejected with HTTP status ${unauthRes.status}`,
  );

  // Reset Level 1 event state to 'not_started' to maintain clean baseline state
  execSync('node', {
    input:
      "const { pool } = require('./lib/db'); pool.query(\"UPDATE config SET value = 'not_started' WHERE key = 'event_state'\").then(() => pool.end());",
    cwd: level1Root,
    env: { ...process.env, DATABASE_URL: pgDbUrl },
  });

  // -------------------------------------------------------------------------
  // SECTION 6: Evaluator Portal Submission & Intake Verification (Requirements 1-17)
  // -------------------------------------------------------------------------
  console.log('\n--- 6. EVALUATOR PORTAL SUBMISSION & INTAKE VERIFICATION ---');

  // Vector 1: Level 1 Submission Exclusion
  const l1Subs = await prisma.submission.findMany({ where: { level: 1 } });
  record(
    '6. Evaluator Intake',
    'Level 1 Submission Exclusion',
    l1Subs.length === 0,
    'No Level 1 rows exist in Submission table; Level 1 is question-based automatic scoring only.',
  );

  // Vector 2: Case 1 — Level 1 Automated Team
  const t1Subs = await prisma.submission.findMany({
    where: { team: { name: 'ACN Test Team 01' } },
  });
  const t1L1Results = await prisma.level1Result.count({
    where: { team: { name: 'ACN Test Team 01' } },
  });
  record(
    '6. Evaluator Intake',
    'Case 1: Level 1 Automated Team (No Deliverables)',
    t1Subs.length === 0 && t1L1Results > 0,
    `Team 01 has ${t1L1Results} solved challenges and 0 deliverable submissions.`,
  );

  // Vector 3: Case 2 — Level 2 Pending Submission with Submitter Name
  const t2Sub = await prisma.submission.findFirst({
    where: { team: { name: 'ACN Test Team 02' } },
    include: { files: true, evaluation: true, user: true },
  });
  const t2UserPreReg = t2Sub
    ? await prisma.preRegisteredParticipant.findUnique({ where: { email: t2Sub.user.email } })
    : null;
  const t2Ok = Boolean(
    t2Sub &&
    t2Sub.level === 2 &&
    t2Sub.files.length === 3 &&
    t2Sub.answers &&
    t2Sub.evaluation?.status === 'PENDING' &&
    t2UserPreReg?.name === 'Vikram Rao',
  );
  record(
    '6. Evaluator Intake',
    'Case 2: Level 2 Pending Submission & Name Resolution',
    t2Ok,
    `Team 02 has Level 2 deliverable (3 files, structured answers, submitter: "${t2UserPreReg?.name}", status: PENDING).`,
  );

  // Vector 4: Case 3 — Level 2 Team with No Submission
  const t3Sub = await prisma.submission.findFirst({
    where: { team: { name: 'ACN Test Team 03' } },
  });
  record(
    '6. Evaluator Intake',
    'Case 3: Unsubmitted Squad Visibility',
    t3Sub === null,
    'Team 03 has 0 submissions in database; accurately recognized as not submitted without fake records.',
  );

  // Vector 5: Case 4 — Level 2 Evaluated Submission
  const t4Sub = await prisma.submission.findFirst({
    where: { team: { name: 'ACN Test Team 04' } },
    include: { evaluation: true },
  });
  const t4Ok = Boolean(
    t4Sub &&
    t4Sub.level === 2 &&
    t4Sub.evaluation?.status === 'EVALUATED' &&
    t4Sub.evaluation.score === 85,
  );
  record(
    '6. Evaluator Intake',
    'Case 4: Level 2 Evaluated Submission (85 PTS)',
    t4Ok,
    `Team 04 has evaluated submission with score=${t4Sub?.evaluation?.score} PTS and status=EVALUATED.`,
  );

  // Vector 6: Case 5 — Level 3 Submission
  const t5Sub = await prisma.submission.findFirst({
    where: { team: { name: 'ACN Test Team 05' } },
    include: { evaluation: true },
  });
  const t5Ok = Boolean(t5Sub && t5Sub.level === 3 && t5Sub.evaluation?.status === 'IN_REVIEW');
  record(
    '6. Evaluator Intake',
    'Case 5: Level 3 Submission & In-Review Status',
    t5Ok,
    `Team 05 has Level 3 submission (status=${t5Sub?.status}, evaluation=${t5Sub?.evaluation?.status}).`,
  );

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n======================================================================');
  console.log('  VERIFICATION SUMMARY');
  console.log('======================================================================');
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  console.log(`  Passed: ${passedCount} / ${totalCount}`);

  if (passedCount === totalCount) {
    console.log('\x1b[32m  >>> ALL LOCAL TESTING SETUP CHECKS PASSED SUCCESSFULLY <<<\x1b[0m\n');
    process.exit(0);
  } else {
    console.log('\x1b[31m  >>> SOME CHECKS FAILED <<<\x1b[0m\n');
    process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error('Verification script crashed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
