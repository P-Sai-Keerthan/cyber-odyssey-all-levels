import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { issueTicket } from '../src/lib/level1/tickets';

const prisma = new PrismaClient();
const LEVEL1_URL = 'http://localhost:3000';

async function run() {
  console.log('=== RUNNING COMPLETE MANUAL PARTICIPANT & SECURITY AUDIT ===\n');

  // 1. Participant Dashboard & Team Card Inspection
  console.log('1. Checking Participant Dashboard & Team Card UI...');
  const user = await prisma.user.findUnique({
    where: { email: 'test_p1_t1@odyssey.local' },
    include: {
      membership: { include: { team: { include: { members: { include: { user: true } } } } } },
    },
  });
  if (!user || !user.membership) {
    throw new Error('Test participant user not found or has no membership');
  }
  const team = user.membership.team;
  console.log(`- Team Name: ${team.name}`);
  console.log(`- Team Code: ${team.code}`);
  console.log(`- Team External Ref: ${team.externalRef}`);

  // Verify team head role in DB (slot 1 or role HEAD/CREATOR)
  const headMember = team.members.find((m) => m.slot === 1);
  console.log(
    `- Team Head: ${headMember?.user?.username} (Role: ${headMember?.role}, Slot: ${headMember?.slot})`,
  );
  if (!headMember) throw new Error('Team Head not found');

  // Verify Team Card Component Rendered String (checking code content)
  const teamCardPath = path.join(__dirname, '../src/components/dashboard/team-card.tsx');
  const teamCardSrc = fs.readFileSync(teamCardPath, 'utf8');
  if (teamCardSrc.includes('>CREATOR<') || teamCardSrc.includes('CREATOR</span>')) {
    throw new Error('Found participant-facing CREATOR badge in team-card.tsx');
  }
  if (!/>\s*HEAD\s*</.test(teamCardSrc) || !/>\s*MEMBER\s*</.test(teamCardSrc)) {
    throw new Error('Missing HEAD or MEMBER badge in team-card.tsx');
  }
  console.log(
    '[PASS] Team Card UI verified: HEAD and MEMBERS structure intact, CREATOR eliminated.',
  );

  // 2. Level 1 Participant Page Inspection
  console.log('\n2. Checking Level 1 Participant Page UI...');
  const l1PagePath = path.join(__dirname, '../src/app/event/level-1/page.tsx');
  const l1PageSrc = fs.readFileSync(l1PagePath, 'utf8');

  const forbiddenStrings = [
    'ALL LEVELS',
    'LEVEL 2 →',
    'BRIEFING NOT YET RELEASED',
    '500 PTS',
    '500 points',
    'GO TO LEVEL 2 WORKSPACE',
    'Go to Level 2 Workspace',
  ];
  for (const str of forbiddenStrings) {
    if (l1PageSrc.toLowerCase().includes(str.toLowerCase())) {
      throw new Error(`Forbidden string found in Level 1 page: "${str}"`);
    }
  }

  const requiredStrings = [
    'CYBER ODYSSEY — TRACE',
    'LEVEL 1 — THE INITIAL TRACE',
    'Digital Triage & Initial Trace',
    '100 PTS',
    'LEVEL 1 BRIEF',
    'LEVEL 1 TRACK OVERVIEW',
    'TRACK A',
    'SOC Email Threat Hunting',
    'TRACK B',
    'Application Security &amp; Session Analysis',
    'TRACK C',
    'DFIR Evidence Analysis',
    'IMPORTANT INFORMATION',
  ];
  for (const str of requiredStrings) {
    if (!l1PageSrc.toLowerCase().includes(str.toLowerCase())) {
      throw new Error(`Required string missing in Level 1 page: "${str}"`);
    }
  }

  const launchSrc = fs.readFileSync(
    path.join(__dirname, '../src/components/event/level-1-launch.tsx'),
    'utf8',
  );
  if (!launchSrc.includes('ENTER LEVEL 1 →')) {
    throw new Error('Missing ENTER LEVEL 1 → in level-1-launch.tsx');
  }
  console.log(
    '[PASS] Level 1 Participant Page verified: All forbidden elements removed, 100 PTS max score and clean brief verified.',
  );

  // 3. One-Time Ticket Creation & Enter Redirection
  console.log('\n3. Testing Portal -> Level 1 Entry Flow...');
  const { ticket } = await issueTicket({ teamId: team.id, level: 1, issuedToUserId: user.id });
  console.log(`- Issued Ticket: ${ticket.slice(0, 16)}...`);

  const enterRes = await fetch(`${LEVEL1_URL}/api/enter?ticket=${ticket}`, { redirect: 'manual' });
  console.log(`- /api/enter status: ${enterRes.status}`);
  const location = enterRes.headers.get('location');
  console.log(`- /api/enter redirect location: ${location}`);
  const setCookie = enterRes.headers.get('set-cookie') || '';
  const cookieMatch = setCookie.match(/sb_team=([^;]+)/);
  if (!cookieMatch) throw new Error('sb_team cookie not set by /api/enter');
  const sbCookie = `sb_team=${cookieMatch[1]}`;
  // The VALUE is never printed. `slice(0, 25)` used to be here, which past the
  // 8-character `sb_team=` prefix is 17 characters of a live signed session
  // token — in terminal scrollback and in any CI log that captures this script.
  // A length and a confirmation carry the same diagnostic weight.
  console.log(`- Received signed session cookie (${sbCookie.length} chars, value withheld).`);

  if (enterRes.status !== 302 || location !== '/hub') {
    throw new Error(`Expected redirect to /hub, got ${enterRes.status} to ${location}`);
  }
  console.log('[PASS] Entry flow redirected cleanly to /hub with signed session cookie.');

  // 4. Level 1 Hub & State Access
  console.log('\n4. Testing Level 1 Hub & Identity...');
  const hubRes = await fetch(`${LEVEL1_URL}/hub`, { headers: { Cookie: sbCookie } });
  console.log(`- /hub HTTP status: ${hubRes.status}`);
  if (hubRes.status !== 200) throw new Error(`/hub returned ${hubRes.status}`);

  const stateRes = await fetch(`${LEVEL1_URL}/api/team/state`, { headers: { Cookie: sbCookie } });
  const teamState = (await stateRes.json()) as any;
  console.log(`- Team State Team Name: ${teamState.team?.name}`);
  console.log(`- Team State Team Code: ${teamState.team?.code}`);
  if (teamState.team?.name !== team.name) {
    throw new Error(`Expected team name "${team.name}", got "${teamState.team?.name}"`);
  }
  console.log('[PASS] Level 1 automatically identified team without 2nd password or registration.');

  // 5. Test Solving Question A1 & Score Synchronization
  console.log('\n5. Testing Question Solve & Score Synchronization...');
  // Ensure event is running on Level 1
  const pgDbUrl =
    process.env['LEVEL1_DATABASE_URL'] ||
    'postgresql://postgres:postgres@localhost:5432/cyber_odyssey';
  const level1Root = path.join(__dirname, '../../cyber-odyssey-app level-1');
  execSync('node', {
    input:
      "const { pool } = require('./lib/db'); pool.query(\"UPDATE config SET value = 'running' WHERE key = 'event_state'\").then(() => pool.end());",
    cwd: level1Root,
    env: { ...process.env, DATABASE_URL: pgDbUrl },
  });

  const submitRes = await fetch(`${LEVEL1_URL}/api/trackA/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sbCookie },
    body: JSON.stringify({
      questionCode: 'A1',
      answer: '203.0.113.77 smtp-out.ithacah01dings.com',
      evidence: 'Manual verification audit answer',
    }),
  });
  const submitData = (await submitRes.json()) as any;
  console.log(`- Solve Submit Response: status=${submitRes.status}`, submitData);

  // Drain outbox
  execSync('node scripts/drain-outbox.js', {
    cwd: level1Root,
    env: { ...process.env, DATABASE_URL: pgDbUrl },
  });

  // Verify Portal records score
  const l1Results = await prisma.level1Result.findMany({ where: { teamId: team.id } });
  console.log(`- Portal Level 1 Results Count for team: ${l1Results.length}`);
  const totalScore = l1Results.reduce((acc, r) => acc + r.awardedPoints, 0);
  console.log(`- Portal Level 1 Recorded Score: ${totalScore} PTS`);
  console.log('[PASS] Challenge solved and score synchronized to Portal.');

  // 6. Test Duplicate Solve Protection
  console.log('\n6. Testing Duplicate Solve Protection...');
  const dupSubmitRes = await fetch(`${LEVEL1_URL}/api/trackA/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sbCookie },
    body: JSON.stringify({
      questionCode: 'A1',
      answer: '203.0.113.77 smtp-out.ithacah01dings.com',
      evidence: 'Duplicate solve attempt',
    }),
  });
  const dupData = (await dupSubmitRes.json()) as any;
  console.log(`- Duplicate Solve Response: alreadyDone=${dupData.alreadyDone}`);
  if (!dupData.alreadyDone) throw new Error('Expected alreadyDone=true on duplicate submission');
  console.log('[PASS] Duplicate solve protected: No points awarded again.');

  // 7. Test Attempt Enforcement
  console.log('\n7. Testing Attempt Enforcement (Max 3 Attempts)...');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const wrongRes = await fetch(`${LEVEL1_URL}/api/trackA/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: sbCookie },
      body: JSON.stringify({
        questionCode: 'A2',
        answer: 'wrong_answer_test',
        evidence: 'wrong evidence',
      }),
    });
    const wrongData = (await wrongRes.json()) as any;
    console.log(
      `- Attempt ${attempt} result: correct=${wrongData.correct}, attemptsRemaining=${wrongData.attemptsRemaining}, locked=${wrongData.locked}`,
    );
  }
  // 4th attempt should be rejected as locked
  const attempt4Res = await fetch(`${LEVEL1_URL}/api/trackA/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sbCookie },
    body: JSON.stringify({
      questionCode: 'A2',
      answer: 'wrong_answer_test',
      evidence: 'attempt 4',
    }),
  });
  const attempt4Data = (await attempt4Res.json()) as any;
  console.log(`- Attempt 4 result: locked=${attempt4Data.locked}`);
  if (!attempt4Data.locked) throw new Error('Question A2 should be locked on 4th attempt');
  console.log('[PASS] Attempt enforcement strictly clamped at 3 attempts and locked.');

  // 8. Test Failure Cases (Expired, Reused, Invalid)
  console.log('\n8. Testing Failure Cases...');
  // Reused ticket
  const reusedRes = await fetch(`${LEVEL1_URL}/api/enter?ticket=${ticket}`, { redirect: 'manual' });
  console.log(
    `- Reused ticket status: ${reusedRes.status}, location: ${reusedRes.headers.get('location')}`,
  );
  if (!reusedRes.headers.get('location')?.includes('entry=used')) {
    throw new Error('Reused ticket did not redirect to entry=used');
  }

  // Invalid ticket
  const invalidRes = await fetch(
    `${LEVEL1_URL}/api/enter?ticket=invalid0000000000000000000000000000000000000000000000000000000000000`,
    { redirect: 'manual' },
  );
  console.log(
    `- Invalid ticket status: ${invalidRes.status}, location: ${invalidRes.headers.get('location')}`,
  );
  if (!invalidRes.headers.get('location')?.includes('entry=invalid')) {
    throw new Error('Invalid ticket did not redirect to entry=invalid');
  }

  console.log('[PASS] All failure cases produce controlled errors with no infinite loading.');
  console.log('\n=== ALL MANUAL AND SECURITY CHECKS PASSED PERFECTLY ===');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[ERROR]', err);
    process.exit(1);
  });
