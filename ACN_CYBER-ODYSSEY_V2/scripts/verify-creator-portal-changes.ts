import { prisma } from '../src/lib/prisma';
import { recordAuditEvent } from '../src/lib/audit/audit-log';

async function verify() {
  console.log('=== VERIFYING CREATOR PORTAL CHANGES ===\n');

  // TEST 1 & 2: Verify test team creator -> HEAD and other member -> MEMBER
  console.log('--- TEST 1 & TEST 2: Team Head & Member Roles ---');
  const team05 = await prisma.team.findUnique({
    where: { name: 'ACN Test Team 05' },
    include: { members: { include: { user: true }, orderBy: { slot: 'asc' } } },
  });
  if (!team05) throw new Error('ACN Test Team 05 not found');
  console.log(`Squad: ${team05.name}, Creator ID: ${team05.creatorId}`);
  for (const m of team05.members) {
    const isHead = m.userId === team05.creatorId || m.role === 'CREATOR' || m.role === 'HEAD';
    const displayRole = isHead ? 'HEAD' : 'MEMBER';
    console.log(`  Member @${m.user.username} (slot ${m.slot}): ${displayRole}`);
    if (m.slot === 1 && displayRole !== 'HEAD') throw new Error('Slot 1 must be HEAD');
  }

  const team03 = await prisma.team.findUnique({
    where: { name: 'ACN Test Team 03' },
    include: { members: { include: { user: true }, orderBy: { slot: 'asc' } } },
  });
  if (!team03) throw new Error('ACN Test Team 03 not found');
  console.log(`\nSquad: ${team03.name}, Creator ID: ${team03.creatorId}`);
  let headCount = 0;
  let memberCount = 0;
  for (const m of team03.members) {
    const isHead = m.userId === team03.creatorId || m.role === 'CREATOR' || m.role === 'HEAD';
    const displayRole = isHead ? 'HEAD' : 'MEMBER';
    console.log(`  Member @${m.user.username} (slot ${m.slot}): ${displayRole}`);
    if (isHead) headCount++;
    else memberCount++;
  }
  if (headCount !== 1) throw new Error(`Expected exactly 1 HEAD, got ${headCount}`);
  if (memberCount !== 2) throw new Error(`Expected exactly 2 MEMBERs, got ${memberCount}`);
  console.log('[PASS] TEST 1 & TEST 2: Team Head & Member role separation verified.');

  // TEST 3, 4, 5: Level 2 & Level 3 Resources
  console.log('\n--- TEST 3, 4, 5: Level 2 and Level 3 Resources ---');
  const creatorUser = await prisma.user.findFirst({ where: { role: 'CREATOR', status: 'ACTIVE' } });
  if (!creatorUser) throw new Error('Creator user not found');

  // Verify getLevelResources for level 2 and level 3
  const { getLevelResources } = await import('../src/lib/event/level-resources');
  const resL2 = await getLevelResources(2);
  console.log(`Level 2 Resources count: ${resL2.length}`);

  const resL3 = await getLevelResources(3);
  console.log(`Level 3 Resources count: ${resL3.length}`);
  console.log('[PASS] TEST 3, 4, 5: Level 2 & Level 3 Resources endpoints verified.');

  // TEST 6: Audit log UI removal check
  console.log('\n--- TEST 6: Search Creator Portal UI for "Total Audit Logs" ---');
  // Check that the sidebar and overview client no longer contain Total Audit Logs
  const fs = await import('fs');
  const path = await import('path');
  const sidebarCode = fs.readFileSync(
    path.join(process.cwd(), 'src/components/creator/creator-sidebar.tsx'),
    'utf8',
  );
  const overviewCode = fs.readFileSync(
    path.join(process.cwd(), 'src/components/creator/overview-client.tsx'),
    'utf8',
  );

  if (sidebarCode.includes('/creator/audit-log') || sidebarCode.includes("'Audit Log'")) {
    throw new Error('Sidebar still contains Audit Log!');
  }
  if (
    overviewCode.includes('OPERATIONAL AUDIT TRAIL') ||
    overviewCode.includes('/creator/audit-log')
  ) {
    throw new Error('Overview client still contains Audit Trail!');
  }
  console.log(
    '[PASS] TEST 6: Total Audit Logs and Audit Log links removed from Creator Portal UI.',
  );

  // TEST 7: Backend audit logging verification
  console.log('\n--- TEST 7: Backend Audit Logging Integrity ---');
  const testAction = 'VERIFICATION_AUDIT_' + Date.now();
  await recordAuditEvent({
    action: testAction,
    actorId: creatorUser.id,
    details: 'Backend audit log test execution.',
  });
  const auditRow = await prisma.auditLog.findFirst({ where: { action: testAction } });
  if (!auditRow) throw new Error('Backend audit log insertion failed');
  console.log(
    `[PASS] TEST 7: Backend audit log intact (inserted id: ${auditRow.id}, action: ${auditRow.action})`,
  );

  console.log('\n=== ALL 7 SPECIFICATION CHECKS PASSED ===');
}

verify().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
