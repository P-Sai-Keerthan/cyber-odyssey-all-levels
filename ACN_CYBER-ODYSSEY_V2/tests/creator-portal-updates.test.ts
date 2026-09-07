import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import * as sessionModule from '@/lib/auth/session';
import { getCreatorLevelResourcesAction } from '@/lib/actions/creator-resource-actions';
import { recordAuditEvent } from '@/lib/audit/audit-log';

describe('Creator Portal Updates (Change 1, 2, 3)', () => {
  let creatorId: string;
  let member1Id: string;
  let member2Id: string;
  let testTeamId: string;

  beforeEach(async () => {
    // Create test creator user
    const creatorUser = await prisma.user.upsert({
      where: { email: 'test_creator_verification@acn.org' },
      update: { role: 'CREATOR', status: 'ACTIVE' },
      create: {
        email: 'test_creator_verification@acn.org',
        username: 'test_creator_v',
        role: 'CREATOR',
        status: 'ACTIVE',
        passwordHash: 'dummy',
      },
    });
    creatorId = creatorUser.id;

    // Create participant 1 (Team Head)
    const p1 = await prisma.user.upsert({
      where: { email: 'test_p1_head@acn.org' },
      update: { role: 'PARTICIPANT', status: 'ACTIVE' },
      create: {
        email: 'test_p1_head@acn.org',
        username: 'head_user',
        role: 'PARTICIPANT',
        status: 'ACTIVE',
        passwordHash: 'dummy',
      },
    });
    member1Id = p1.id;

    // Create participant 2 (Team Member)
    const p2 = await prisma.user.upsert({
      where: { email: 'test_p2_member@acn.org' },
      update: { role: 'PARTICIPANT', status: 'ACTIVE' },
      create: {
        email: 'test_p2_member@acn.org',
        username: 'squad_member_user',
        role: 'PARTICIPANT',
        status: 'ACTIVE',
        passwordHash: 'dummy',
      },
    });
    member2Id = p2.id;

    // Clean any prior team
    await prisma.teamMember.deleteMany({ where: { userId: { in: [member1Id, member2Id] } } });
    await prisma.team.deleteMany({ where: { name: 'ACN Test Team 05 Spec' } });

    // Create squad where p1 is creator/head (slot 1) and p2 is member (slot 2)
    const team = await prisma.team.create({
      data: {
        name: 'ACN Test Team 05 Spec',
        code: 'SPEC-TT05',
        passwordHash: 'dummy',
        creatorId: member1Id,
        members: {
          create: [
            { userId: member1Id, slot: 1, role: 'HEAD' },
            { userId: member2Id, slot: 2, role: 'MEMBER' },
          ],
        },
      },
    });
    testTeamId = team.id;
  });

  describe('Change 1: Team Creator / Member role distinction (HEAD vs MEMBER)', () => {
    it('accurately identifies squad head vs squad member based on authoritative database relationship', async () => {
      const team = await prisma.team.findUnique({
        where: { id: testTeamId },
        include: { members: { include: { user: true }, orderBy: { slot: 'asc' } } },
      });

      expect(team).not.toBeNull();
      expect(team!.creatorId).toBe(member1Id);

      const creatorMember = team!.members.find((m) => m.userId === team!.creatorId);
      const otherMember = team!.members.find((m) => m.userId !== team!.creatorId);

      expect(creatorMember).toBeDefined();
      expect(otherMember).toBeDefined();

      // Presentation formatting check:
      const formatRole = (role: string) =>
        role === 'CREATOR' || role === 'HEAD' ? 'HEAD' : 'MEMBER';

      expect(formatRole(creatorMember!.role)).toBe('HEAD');
      expect(formatRole(otherMember!.role)).toBe('MEMBER');
      expect(formatRole(otherMember!.role)).not.toBe('HEAD');
    });
  });

  describe('Change 2: Level 3 Resources Architecture', () => {
    it('supports Level 3 resources querying via standard action', async () => {
      vi.spyOn(sessionModule, 'getSessionUser').mockResolvedValue({
        id: creatorId,
        username: 'test_creator_v',
        role: 'CREATOR',
        status: 'ACTIVE',
        membership: null,
        // `as never` rather than `as any`: the session type carries fields this
        // test does not need to invent, and `never` satisfies the mock without
        // asserting a shape that could drift out of step with the real one.
      } as never);

      const resLevel2 = await getCreatorLevelResourcesAction(2);
      expect(resLevel2.success).toBe(true);

      const resLevel3 = await getCreatorLevelResourcesAction(3);
      expect(resLevel3.success).toBe(true);
      expect(resLevel3.data).toBeDefined();
      expect(Array.isArray(resLevel3.data!.resources)).toBe(true);
    });
  });

  describe('Change 3: Audit Logging Backend Integrity', () => {
    it('records and retains audit log events without broken infrastructure', async () => {
      await recordAuditEvent({
        action: 'SPEC_VERIFICATION_EVENT',
        actorId: creatorId,
        details: 'Verifying audit trail recording remains operational.',
      });

      const logged = await prisma.auditLog.findFirst({
        where: { action: 'SPEC_VERIFICATION_EVENT', actorId: creatorId },
      });

      expect(logged).not.toBeNull();
      expect(logged!.details).toContain('operational');
    });
  });
});
