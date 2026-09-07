'use server';

import { safeRevalidate } from '@/lib/utils/revalidate';
import { prisma } from '@/lib/prisma';
import { resolveLevelEvaluationScale } from '@/lib/evaluation/level-max-score';
import { getSessionUser } from '@/lib/auth/session';
import { getPortalStatus, type PortalStatusData } from '@/lib/event/portal-settings';
import { CRITICAL_WRITE_TX } from '@/lib/db/transaction';
import { isEvaluableLevel, EVALUABLE_LEVELS } from '@/lib/auth/permissions';
import { getTeamLevel1Score } from '@/lib/level1/scoring';
import {
  APPROVAL_STATUS,
  approvalStatusLabel,
  recomputeTeamScore,
} from '@/lib/evaluation/approval';
import type { ScoreAdjustmentDTO } from '@/lib/score-adjustments/types';
import type { ActionResult } from './auth-actions';

/**
 * Standard Criterion structure for forensic investigations
 */
export interface EvaluationCriterionItem {
  id: string;
  criterionId?: string | undefined;
  name: string;
  description?: string | undefined;
  guidance?: string | undefined;
  maxMarks: number;
  awardedMarks: number;
  feedback?: string | undefined;
}

export interface EvaluatorOverviewStats {
  totalTeams: number;
  activeTeams: number;
  totalSubmissions: number;
  pendingEvaluations: number;
  completedEvaluations: number;
  activeLevel: number;
  portalStatus: PortalStatusData;
  recentActivity: Array<{
    id: string;
    action: string;
    details: string | null;
    createdAt: Date;
    actorUsername: string;
  }>;
}

export interface EvaluatorTeamListItem {
  id: string;
  name: string;
  teamHead: string;
  membersCount: number;
  status: string;
  currentLevel: number;
  score: number;
  submissionStatus: string;
  createdAt: Date;
}

export interface EvaluatorTeamDetail {
  id: string;
  name: string;
  score: number;
  status: string;
  createdAt: Date;
  roster: Array<{
    userId: string;
    username: string;
    email: string;
    role: string;
    joinedAt: Date;
  }>;
  levelScores: {
    level1: number;
    level2: number;
    level3: number;
    total: number;
  };
  submissions: Array<{
    id: string;
    level: number;
    status: string;
    submittedAt: Date;
    score: number | null;
    evaluationStatus: string | null;
  }>;
}

export interface EvaluatorSubmissionListItem {
  id: string;
  teamId: string;
  teamName: string;
  teamHead: string;
  level: number;
  submittedBy: string;
  submitterName: string;
  submitterRole: string;
  submittedAt: Date;
  submissionStatus: string;
  evaluationStatus: string;
  score: number | null;
  maxScore: number | null;
  filesCount: number;
  hasReport: boolean;
  hasAnswers: boolean;
  deliverablesSummary: string;
  evaluatedBy: string | null;
  /**
   * Admin decision on this evaluation. The evaluator needs this to know whether
   * their score is live, still awaiting a decision, or has been returned to them
   * for correction — without it the rejection loop is invisible and the
   * correction never happens.
   */
  approvalStatus: string | null;
  approvalStatusLabel: string | null;
  rejectionReason: string | null;
}

export interface EvaluatorSubmissionsSummaryStats {
  totalSubmissions: number;
  level2Submissions: number;
  level3Submissions: number;
  pendingCount: number;
  inReviewCount: number;
  evaluatedCount: number;
}

export interface EvaluatorSquadSubmissionStatusItem {
  teamId: string;
  teamName: string;
  teamHead: string;
  membersCount: number;
  level1Status: {
    isAutomatic: true;
    score: number;
    challengesSolved: number;
  };
  level2Submission: {
    submitted: boolean;
    submissionId?: string;
    submittedAt?: Date;
    submitterName?: string;
    filesCount: number;
    hasReport: boolean;
    hasAnswers: boolean;
    deliverablesSummary?: string;
    evaluationStatus?: string;
    score?: number | null;
  };
  level3Submission: {
    submitted: boolean;
    submissionId?: string;
    submittedAt?: Date;
    submitterName?: string;
    filesCount: number;
    hasReport: boolean;
    hasAnswers: boolean;
    deliverablesSummary?: string;
    evaluationStatus?: string;
    score?: number | null;
  };
}

export interface EvaluatorSubmissionDetail {
  id: string;
  teamId: string;
  teamName: string;
  teamHead: string;
  level: number;
  submittedBy: string;
  submitterName: string;
  submitterRole: string;
  submittedAt: Date;
  submissionStatus: string;
  answers: Record<string, string> | null;
  /**
   * Which attempt this submission is. A squad may resubmit freely before the
   * deadline, so an evaluator needs to see that what they are holding is the
   * latest version and not a draft that has since been superseded.
   */
  attemptCount: number;
  /** Earlier attempts, newest first. History only — never the thing being judged. */
  attempts: Array<{
    attemptNumber: number;
    submittedAt: Date;
    fileNames: string[];
  }>;
  files: Array<{
    id: string;
    fileName: string;
    originalName: string;
    fileSize: number;
    mimeType: string;
  }>;
  team: {
    id: string;
    name: string;
    roster: Array<{
      userId: string;
      username: string;
      displayName?: string | undefined;
      role: string;
    }>;
  };
  criteria: EvaluationCriterionItem[];
  maxPossibleScore: number;
  /** Set when the level's criteria do not sum to its configured maximum. */
  criteriaMismatch: string | null;
  evaluation: {
    id: string;
    status: string;
    score: number;
    maxScore: number;
    criteria: EvaluationCriterionItem[];
    notes: string;
    feedback: string;
    version: number;
    evaluatorId: string;
    evaluatorUsername: string | null;
    startedAt: Date | null;
    submittedAt: Date | null;
  } | null;
  scoreAdjustments?: ScoreAdjustmentDTO[];
}

/**
 * Server Guard: strictly ensures user is an authenticated Evaluator with ACTIVE status.
 */
async function requireEvaluatorRole() {
  const user = await getSessionUser();
  if (!user) {
    throw new Error(
      'Your session has expired. Please sign in again to continue reviewing submissions.',
    );
  }
  if (user.role !== 'EVALUATOR' || user.status !== 'ACTIVE') {
    throw new Error(
      'Your account does not have permission to access the evaluation console. ' +
        'This area is limited to approved, active evaluators. If you requested evaluator ' +
        'access and it is still pending, the event Creator has to approve it first.',
    );
  }
  return user;
}

/**
 * Server Action: Get Mission Control Overview Stats for Evaluators
 */
export async function getEvaluatorOverviewStatsAction(): Promise<
  ActionResult<EvaluatorOverviewStats>
> {
  try {
    await requireEvaluatorRole();
    const portalStatus = await getPortalStatus();

    const [totalTeams, activeTeams, totalSubmissions, pendingCount, completedCount, recentLogs] =
      await Promise.all([
        prisma.team.count(),
        prisma.team.count({ where: { status: 'ACTIVE' } }),
        prisma.submission.count({
          where: { level: { in: [...EVALUABLE_LEVELS] } },
        }),
        prisma.submission.count({
          where: {
            level: { in: [...EVALUABLE_LEVELS] },
            OR: [
              { evaluation: null },
              { evaluation: { status: { in: ['PENDING', 'IN_REVIEW'] } } },
            ],
          },
        }),
        prisma.evaluation.count({
          where: {
            level: { in: [...EVALUABLE_LEVELS] },
            status: 'EVALUATED',
          },
        }),
        prisma.auditLog.findMany({
          where: {
            action: {
              in: [
                'SUBMISSION_OPENED',
                'EVALUATION_STARTED',
                'SCORE_UPDATED',
                'EVALUATION_SUBMITTED',
                'EVALUATION_RETURNED',
                'FILE_ACCESSED',
              ],
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            actor: { select: { username: true } },
          },
        }),
      ]);

    // Active Level is Level 2 by default during forensic phase
    const activeLevel = 2;

    return {
      success: true,
      data: {
        totalTeams,
        activeTeams,
        totalSubmissions,
        pendingEvaluations: pendingCount,
        completedEvaluations: completedCount,
        activeLevel,
        portalStatus,
        recentActivity: recentLogs.map((log) => ({
          id: log.id,
          action: log.action,
          details: log.details,
          createdAt: log.createdAt,
          actorUsername: log.actor?.username || 'SYSTEM',
        })),
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to retrieve evaluator metrics.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Server Action: Get Paginated List of Teams for Evaluators.
 * PRIVACY MANDATE: Team Join Codes (Team.code) and Password Hashes are NEVER queried or returned.
 */
export async function getEvaluatorTeamsAction(params?: {
  search?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}): Promise<
  ActionResult<{ teams: EvaluatorTeamListItem[]; totalCount: number; totalPages: number }>
> {
  try {
    await requireEvaluatorRole();

    const page = Math.max(1, params?.page || 1);
    const limit = Math.min(50, Math.max(1, params?.limit || 20));
    const skip = (page - 1) * limit;
    const search = params?.search?.trim();

    const whereClause = search
      ? {
          OR: [
            { name: { contains: search } },
            { id: { contains: search } },
            { members: { some: { user: { username: { contains: search } } } } },
          ],
        }
      : {};

    const [teams, totalCount] = await Promise.all([
      prisma.team.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          score: true,
          status: true,
          createdAt: true,
          members: {
            select: {
              role: true,
              // Only the squad head's username is rendered in the list; emails
              // are not shown here, so they are not read here.
              user: { select: { username: true } },
            },
            orderBy: { slot: 'asc' },
          },
          submissions: {
            select: {
              level: true,
              status: true,
            },
            orderBy: { level: 'desc' },
            take: 1,
          },
        },
        orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.team.count({ where: whereClause }),
    ]);

    const formattedTeams: EvaluatorTeamListItem[] = teams.map((t) => {
      const headMember = t.members.find((m) => m.role === 'HEAD') || t.members[0];
      const latestSubmission = t.submissions[0];

      return {
        id: t.id,
        name: t.name,
        teamHead: headMember ? `@${headMember.user.username}` : 'UNASSIGNED',
        membersCount: t.members.length,
        status: t.status,
        currentLevel: latestSubmission ? latestSubmission.level : 1,
        score: t.score,
        submissionStatus: latestSubmission ? latestSubmission.status : 'NO_SUBMISSIONS',
        createdAt: t.createdAt,
      };
    });

    return {
      success: true,
      data: {
        teams: formattedTeams,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to query teams.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Server Action: Get Detailed Team Profile and Score Breakdown.
 * PRIVACY MANDATE: Team Join Codes (Team.code) are strictly omitted.
 */
export async function getEvaluatorTeamDetailsAction(
  teamId: string,
): Promise<ActionResult<EvaluatorTeamDetail>> {
  try {
    await requireEvaluatorRole();

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        score: true,
        status: true,
        createdAt: true,
        members: {
          select: {
            role: true,
            joinedAt: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
        submissions: {
          select: {
            id: true,
            level: true,
            status: true,
            submittedAt: true,
            evaluation: {
              select: {
                score: true,
                status: true,
              },
            },
          },
          orderBy: { level: 'asc' },
        },
      },
    });

    if (!team) {
      return { success: false, error: 'Squad not found in registry.' };
    }

    // Level 1 score comes from authoritative automated scoring, NOT from a deliverable submission
    const l1ScoreData = await getTeamLevel1Score(team.id);
    const lvl1Score = l1ScoreData.officialScore ?? 0;

    let lvl2Score = 0;
    let lvl3Score = 0;

    team.submissions.forEach((sub) => {
      const evalScore = sub.evaluation?.score || 0;
      if (sub.level === 2) lvl2Score = evalScore;
      if (sub.level === 3) lvl3Score = evalScore;
    });

    return {
      success: true,
      data: {
        id: team.id,
        name: team.name,
        score: team.score,
        status: team.status,
        createdAt: team.createdAt,
        roster: team.members.map((m) => ({
          userId: m.user.id,
          username: m.user.username,
          email: m.user.email,
          role: m.role === 'HEAD' ? 'Team Head' : 'Squad Member',
          joinedAt: m.joinedAt,
        })),
        levelScores: {
          level1: lvl1Score,
          level2: lvl2Score,
          level3: lvl3Score,
          total: team.score,
        },
        submissions: team.submissions
          .filter((s) => isEvaluableLevel(s.level))
          .map((s) => ({
            id: s.id,
            level: s.level,
            status: s.status,
            submittedAt: s.submittedAt,
            score: s.evaluation?.score ?? null,
            evaluationStatus: s.evaluation?.status ?? 'UNASSIGNED',
          })),
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to query team details.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Helper: Compute Submissions Terminal Summary Statistics from database
 * Level 1 question solves are strictly excluded; counts only reflect deliverable levels (2 & 3).
 */
async function computeSubmissionsSummaryStats(): Promise<EvaluatorSubmissionsSummaryStats> {
  const [
    totalSubmissions,
    level2Submissions,
    level3Submissions,
    pendingCount,
    inReviewCount,
    evaluatedCount,
  ] = await Promise.all([
    prisma.submission.count({
      where: { level: { in: [...EVALUABLE_LEVELS] } },
    }),
    prisma.submission.count({
      where: { level: 2 },
    }),
    prisma.submission.count({
      where: { level: 3 },
    }),
    prisma.submission.count({
      where: {
        level: { in: [...EVALUABLE_LEVELS] },
        OR: [{ evaluation: null }, { evaluation: { status: 'PENDING' } }],
      },
    }),
    prisma.submission.count({
      where: {
        level: { in: [...EVALUABLE_LEVELS] },
        evaluation: { status: 'IN_REVIEW' },
      },
    }),
    prisma.submission.count({
      where: {
        level: { in: [...EVALUABLE_LEVELS] },
        evaluation: { status: 'EVALUATED' },
      },
    }),
  ]);

  return {
    totalSubmissions,
    level2Submissions,
    level3Submissions,
    pendingCount,
    inReviewCount,
    evaluatedCount,
  };
}

/**
 * Server Action: Query Filtered Submissions for Evaluator Review
 */
export async function getEvaluatorSubmissionsAction(params?: {
  level?: number | undefined;
  status?: string | undefined;
  teamId?: string | undefined;
  search?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}): Promise<
  ActionResult<{
    submissions: EvaluatorSubmissionListItem[];
    totalCount: number;
    totalPages: number;
    summaryStats: EvaluatorSubmissionsSummaryStats;
  }>
> {
  try {
    await requireEvaluatorRole();

    // Summary stats are always calculated across all deliverable submissions
    const summaryStats = await computeSubmissionsSummaryStats();

    // LEVEL 1 HAS NO DELIVERABLE SUBMISSIONS.
    // If explicitly filtered for level 1, return empty results immediately.
    if (params?.level === 1) {
      return {
        success: true,
        data: {
          submissions: [],
          totalCount: 0,
          totalPages: 0,
          summaryStats,
        },
      };
    }

    const page = Math.max(1, params?.page || 1);
    const limit = Math.min(50, Math.max(1, params?.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    // Deliverable levels only (Level 2 & Level 3). Never include Level 1.
    if (params?.level && isEvaluableLevel(params.level)) {
      where['level'] = params.level;
    } else {
      where['level'] = { in: [...EVALUABLE_LEVELS] };
    }

    if (params?.teamId) {
      where['teamId'] = params.teamId;
    }

    if (params?.status) {
      if (params.status === 'PENDING') {
        where['OR'] = [{ evaluation: null }, { evaluation: { status: 'PENDING' } }];
      } else if (params.status === 'IN_REVIEW') {
        where['evaluation'] = { status: 'IN_REVIEW' };
      } else if (params.status === 'EVALUATED') {
        where['evaluation'] = { status: 'EVALUATED' };
      } else if (params.status === 'RETURNED') {
        where['evaluation'] = { status: 'RETURNED' };
      }
    }

    if (params?.search?.trim()) {
      const search = params.search.trim();
      where['team'] = {
        name: { contains: search },
      };
    }

    const [submissions, totalCount] = await Promise.all([
      prisma.submission.findMany({
        where,
        select: {
          id: true,
          teamId: true,
          userId: true,
          level: true,
          status: true,
          submittedAt: true,
          answers: true,
          team: {
            select: {
              name: true,
              creatorId: true,
              members: {
                select: {
                  role: true,
                  user: {
                    select: {
                      id: true,
                      username: true,
                      email: true,
                    },
                  },
                },
                orderBy: { slot: 'asc' },
              },
            },
          },
          user: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
          files: {
            select: {
              id: true,
              originalName: true,
              fileSize: true,
              mimeType: true,
            },
          },
          _count: { select: { files: true } },
          evaluation: {
            select: {
              status: true,
              score: true,
              maxScore: true,
              approvalStatus: true,
              rejectionReason: true,
              evaluator: {
                select: { username: true },
              },
            },
          },
        },
        orderBy: { submittedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.submission.count({ where }),
    ]);

    // Resolve pre-registered participant names for human-readable display
    const userEmails = submissions.map((s) => s.user.email).filter(Boolean);
    const headEmails = submissions
      .map((s) => {
        const head = s.team.members.find((m) => m.role === 'HEAD') || s.team.members[0];
        return head?.user.email;
      })
      .filter((e): e is string => Boolean(e));
    const allEmails = Array.from(new Set([...userEmails, ...headEmails]));

    const preRegistered = await prisma.preRegisteredParticipant.findMany({
      where: { email: { in: allEmails } },
      select: { email: true, name: true },
    });
    const nameByEmail = new Map(preRegistered.map((p) => [p.email.toLowerCase(), p.name]));

    const formattedList: EvaluatorSubmissionListItem[] = submissions.map((s) => {
      const submitterRealName = nameByEmail.get(s.user.email.toLowerCase()) || null;
      const isHead =
        s.team.creatorId === s.userId ||
        s.team.members.some((m) => m.user.id === s.userId && m.role === 'HEAD');
      const submitterRole = isHead ? 'Team Head' : 'Squad Member';

      const headMember = s.team.members.find((m) => m.role === 'HEAD') || s.team.members[0];
      const headEmail = headMember?.user.email;
      const headRealName = headEmail ? nameByEmail.get(headEmail.toLowerCase()) : null;
      const teamHead = headRealName
        ? `${headRealName} (@${headMember?.user.username})`
        : headMember
          ? `@${headMember.user.username}`
          : 'UNASSIGNED';

      const hasAnswers = Boolean(
        s.answers &&
        s.answers.trim() !== '' &&
        s.answers.trim() !== '{}' &&
        s.answers.trim() !== 'null',
      );
      const reportFile = s.files.find(
        (f) => /report/i.test(f.originalName) || /\.(pdf|docx?)$/i.test(f.originalName),
      );
      const hasReport = Boolean(reportFile);
      const filesCount = s._count.files;

      const parts: string[] = [];
      if (hasReport) parts.push('Report');
      if (hasAnswers) parts.push('Answers');
      const attachmentCount = hasReport ? Math.max(0, filesCount - 1) : filesCount;
      if (attachmentCount > 0) {
        parts.push(`${attachmentCount} Attachment${attachmentCount > 1 ? 's' : ''}`);
      } else if (!hasReport && !hasAnswers) {
        parts.push(`${filesCount} File${filesCount > 1 ? 's' : ''}`);
      }
      const deliverablesSummary = parts.length > 0 ? parts.join(' + ') : 'Empty Submission';

      return {
        id: s.id,
        teamId: s.teamId,
        teamName: s.team.name,
        teamHead,
        level: s.level,
        submittedBy: `@${s.user.username}`,
        submitterName: submitterRealName
          ? `${submitterRealName} (@${s.user.username})`
          : `@${s.user.username}`,
        submitterRole,
        submittedAt: s.submittedAt,
        submissionStatus: s.status,
        evaluationStatus: s.evaluation?.status || 'PENDING',
        score: s.evaluation?.score ?? null,
        maxScore: s.evaluation?.maxScore ?? null,
        filesCount,
        hasReport,
        hasAnswers,
        deliverablesSummary,
        evaluatedBy: s.evaluation?.evaluator?.username
          ? `@${s.evaluation.evaluator.username}`
          : null,
        approvalStatus: s.evaluation?.approvalStatus ?? null,
        approvalStatusLabel: s.evaluation?.approvalStatus
          ? approvalStatusLabel(s.evaluation.approvalStatus)
          : null,
        rejectionReason: s.evaluation?.rejectionReason ?? null,
      };
    });

    return {
      success: true,
      data: {
        submissions: formattedList,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        summaryStats,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to query submissions.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Server Action: Query Squad-Level Submission Visibility Matrix (Requirement 11).
 * Derives submitted vs not-submitted state cleanly by comparing active teams against
 * real submissions without creating fake database records.
 */
export async function getEvaluatorSquadSubmissionStatusesAction(params?: {
  search?: string | undefined;
}): Promise<
  ActionResult<{
    squads: EvaluatorSquadSubmissionStatusItem[];
  }>
> {
  try {
    await requireEvaluatorRole();

    const search = params?.search?.trim();
    const whereClause: Record<string, unknown> = { status: 'ACTIVE' };

    if (search) {
      whereClause['OR'] = [
        { name: { contains: search } },
        { id: { contains: search } },
        { members: { some: { user: { username: { contains: search } } } } },
      ];
    }

    const [teams, level1Results, level1Penalties] = await Promise.all([
      prisma.team.findMany({
        where: whereClause,
        select: {
          id: true,
          name: true,
          creatorId: true,
          members: {
            select: {
              role: true,
              user: { select: { id: true, username: true, email: true } },
            },
            orderBy: { slot: 'asc' },
          },
          submissions: {
            where: { level: { in: [...EVALUABLE_LEVELS] } },
            include: {
              files: {
                select: { id: true, originalName: true, fileSize: true },
              },
              evaluation: {
                select: { status: true, score: true },
              },
              user: {
                select: { username: true, email: true },
              },
            },
          },
        },
        orderBy: [{ score: 'desc' }, { name: 'asc' }],
      }),
      prisma.level1Result.groupBy({
        by: ['teamId'],
        _sum: { awardedPoints: true },
        _count: { challengeId: true },
      }),
      prisma.level1Penalty.groupBy({
        by: ['teamId'],
        _sum: { points: true },
      }),
    ]);

    const level1ResultMap = new Map(
      level1Results.map((r) => [
        r.teamId,
        { score: r._sum.awardedPoints ?? 0, count: r._count.challengeId },
      ]),
    );
    const level1PenaltyMap = new Map(level1Penalties.map((p) => [p.teamId, p._sum.points ?? 0]));

    // Resolve pre-registered names
    const allEmails = Array.from(
      new Set(
        teams.flatMap((t) => [
          ...t.members.map((m) => m.user.email),
          ...t.submissions.map((s) => s.user.email),
        ]),
      ),
    );
    const preRegistered = await prisma.preRegisteredParticipant.findMany({
      where: { email: { in: allEmails } },
      select: { email: true, name: true },
    });
    const nameByEmail = new Map(preRegistered.map((p) => [p.email.toLowerCase(), p.name]));

    const squads: EvaluatorSquadSubmissionStatusItem[] = teams.map((team) => {
      const headMember = team.members.find((m) => m.role === 'HEAD') || team.members[0];
      const headEmail = headMember?.user.email;
      const headRealName = headEmail ? nameByEmail.get(headEmail.toLowerCase()) : null;
      const teamHead = headRealName
        ? `${headRealName} (@${headMember?.user.username})`
        : headMember
          ? `@${headMember.user.username}`
          : 'UNASSIGNED';

      // Level 1 automated score (authoritative)
      const l1Res = level1ResultMap.get(team.id) || { score: 0, count: 0 };
      const l1Pen = level1PenaltyMap.get(team.id) || 0;
      const l1OfficialScore = Math.max(0, l1Res.score - l1Pen);

      // Level 2 forensic deliverable
      const sub2 = team.submissions.find((s) => s.level === 2);
      let level2Submission: EvaluatorSquadSubmissionStatusItem['level2Submission'];
      if (sub2) {
        const submitterRealName = nameByEmail.get(sub2.user.email.toLowerCase());
        const reportFile = sub2.files.find(
          (f) => /report/i.test(f.originalName) || /\.(pdf|docx?)$/i.test(f.originalName),
        );
        const hasAnswers = Boolean(
          sub2.answers &&
          sub2.answers.trim() !== '' &&
          sub2.answers.trim() !== '{}' &&
          sub2.answers.trim() !== 'null',
        );
        const parts: string[] = [];
        if (reportFile) parts.push('Report');
        if (hasAnswers) parts.push('Answers');
        const attachCount = reportFile ? Math.max(0, sub2.files.length - 1) : sub2.files.length;
        if (attachCount > 0) parts.push(`${attachCount} Files`);
        const deliverablesSummary = parts.length > 0 ? parts.join(' + ') : 'Submitted';

        level2Submission = {
          submitted: true,
          submissionId: sub2.id,
          submittedAt: sub2.submittedAt,
          submitterName: submitterRealName
            ? `${submitterRealName} (@${sub2.user.username})`
            : `@${sub2.user.username}`,
          filesCount: sub2.files.length,
          hasReport: Boolean(reportFile),
          hasAnswers,
          deliverablesSummary,
          evaluationStatus: sub2.evaluation?.status || 'PENDING',
          score: sub2.evaluation?.score ?? null,
        };
      } else {
        level2Submission = {
          submitted: false,
          filesCount: 0,
          hasReport: false,
          hasAnswers: false,
        };
      }

      // Level 3 deliverable
      const sub3 = team.submissions.find((s) => s.level === 3);
      let level3Submission: EvaluatorSquadSubmissionStatusItem['level3Submission'];
      if (sub3) {
        const submitterRealName = nameByEmail.get(sub3.user.email.toLowerCase());
        const reportFile = sub3.files.find(
          (f) => /report/i.test(f.originalName) || /\.(pdf|docx?)$/i.test(f.originalName),
        );
        const hasAnswers = Boolean(
          sub3.answers &&
          sub3.answers.trim() !== '' &&
          sub3.answers.trim() !== '{}' &&
          sub3.answers.trim() !== 'null',
        );
        const parts: string[] = [];
        if (reportFile) parts.push('Report');
        if (hasAnswers) parts.push('Answers');
        const attachCount = reportFile ? Math.max(0, sub3.files.length - 1) : sub3.files.length;
        if (attachCount > 0) parts.push(`${attachCount} Files`);
        const deliverablesSummary = parts.length > 0 ? parts.join(' + ') : 'Submitted';

        level3Submission = {
          submitted: true,
          submissionId: sub3.id,
          submittedAt: sub3.submittedAt,
          submitterName: submitterRealName
            ? `${submitterRealName} (@${sub3.user.username})`
            : `@${sub3.user.username}`,
          filesCount: sub3.files.length,
          hasReport: Boolean(reportFile),
          hasAnswers,
          deliverablesSummary,
          evaluationStatus: sub3.evaluation?.status || 'PENDING',
          score: sub3.evaluation?.score ?? null,
        };
      } else {
        level3Submission = {
          submitted: false,
          filesCount: 0,
          hasReport: false,
          hasAnswers: false,
        };
      }

      return {
        teamId: team.id,
        teamName: team.name,
        teamHead,
        membersCount: team.members.length,
        level1Status: {
          isAutomatic: true,
          score: l1OfficialScore,
          challengesSolved: l1Res.count,
        },
        level2Submission,
        level3Submission,
      };
    });

    return {
      success: true,
      data: { squads },
    };
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error ? err.message : 'Failed to query squad submission statuses.';
    return { success: false, error: errorMsg };
  }
}

/**
 * File names recorded on a superseded attempt.
 *
 * The manifest is a JSON string written when the attempt was made. It is history
 * and it is never judged, so a malformed one must degrade to "no names" rather
 * than break the evaluation desk for the submission that IS being judged.
 */
function readManifestNames(manifest: string): string[] {
  try {
    const parsed: unknown = JSON.parse(manifest);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) =>
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { originalName?: unknown }).originalName === 'string'
          ? (entry as { originalName: string }).originalName
          : null,
      )
      .filter((name): name is string => Boolean(name));
  } catch {
    return [];
  }
}

/**
 * Server Action: Get Detailed Submission Payload for Level 2 Forensic Review.
 * Emits a SUBMISSION_OPENED audit log event.
 */
export async function getEvaluatorSubmissionDetailsAction(
  submissionId: string,
): Promise<ActionResult<EvaluatorSubmissionDetail>> {
  try {
    const user = await requireEvaluatorRole();

    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            creatorId: true,
            members: {
              select: {
                role: true,
                user: {
                  select: {
                    id: true,
                    username: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        files: {
          select: {
            id: true,
            fileName: true,
            originalName: true,
            fileSize: true,
            mimeType: true,
          },
        },
        attempts: {
          select: { attemptNumber: true, createdAt: true, fileManifest: true },
          orderBy: { attemptNumber: 'desc' },
        },
        evaluation: {
          include: {
            evaluator: {
              select: {
                id: true,
                username: true,
              },
            },
            scores: {
              include: {
                criterion: true,
              },
            },
          },
        },
      },
    });

    if (!submission) {
      return { success: false, error: 'Submission record not found.' };
    }

    // Parse structured answers if present
    let parsedAnswers: Record<string, string> | null = null;
    if (submission.answers) {
      try {
        parsedAnswers = JSON.parse(submission.answers);
      } catch {
        parsedAnswers = { raw: submission.answers };
      }
    }

    // The authoritative scale for this level: the configured maximum, plus the
    // rubric ONLY if it sums to that maximum. See level-max-score.ts for why the
    // criteria table is not allowed to move the ceiling on its own.
    const scale = await resolveLevelEvaluationScale(prisma, submission.level);

    // Shaped like the rows the code below already expects. When the rubric was
    // suppressed for disagreeing with the configured maximum this is empty, and
    // the evaluator gets a single total score against `scale.maxScore`.
    const activeCriteria = scale.criteria.map((c) => ({
      id: c.id,
      title: c.name,
      description: c.description || null,
      guidance: c.guidance || null,
      maxPoints: c.maxMarks,
    }));

    // Build criteria breakdown dynamically
    let parsedCriteria: EvaluationCriterionItem[] = [];

    if (
      submission.evaluation &&
      submission.evaluation.scores &&
      submission.evaluation.scores.length > 0
    ) {
      const scoreMap = new Map(submission.evaluation.scores.map((s) => [s.criterionId, s]));

      for (const crit of activeCriteria) {
        const sc = scoreMap.get(crit.id);
        parsedCriteria.push({
          id: crit.id,
          criterionId: crit.id,
          name: crit.title,
          description: crit.description || undefined,
          guidance: crit.guidance || undefined,
          maxMarks: crit.maxPoints,
          awardedMarks: sc ? sc.awardedScore : 0,
          feedback: sc?.notes || '',
        });
      }

      // Preserve any previously scored criteria even if since deactivated
      for (const sc of submission.evaluation.scores) {
        if (!activeCriteria.some((c) => c.id === sc.criterionId)) {
          parsedCriteria.push({
            id: sc.criterion.id,
            criterionId: sc.criterion.id,
            name: sc.criterion.title,
            description: sc.criterion.description || undefined,
            guidance: sc.criterion.guidance || undefined,
            maxMarks: sc.criterion.maxPoints,
            awardedMarks: sc.awardedScore,
            feedback: sc.notes || '',
          });
        }
      }
    } else if (activeCriteria.length > 0) {
      // Map legacy criteria JSON if present
      const legacyCriteriaMap = new Map<string, { awardedMarks: number; feedback?: string }>();
      if (submission.evaluation?.criteria) {
        try {
          const parsed = JSON.parse(submission.evaluation.criteria);
          if (Array.isArray(parsed)) {
            parsed.forEach((item) => {
              if (item && typeof item === 'object') {
                if (item.id) legacyCriteriaMap.set(item.id, item);
                if (item.name) legacyCriteriaMap.set(item.name, item);
              }
            });
          }
        } catch {
          // ignore
        }
      }

      parsedCriteria = activeCriteria.map((crit) => {
        const legacy = legacyCriteriaMap.get(crit.id) || legacyCriteriaMap.get(crit.title);
        return {
          id: crit.id,
          criterionId: crit.id,
          name: crit.title,
          description: crit.description || undefined,
          guidance: crit.guidance || undefined,
          maxMarks: crit.maxPoints,
          awardedMarks: legacy ? Math.min(crit.maxPoints, Math.max(0, legacy.awardedMarks)) : 0,
          feedback: legacy?.feedback || '',
        };
      });
    } else {
      // Fallback if no criteria records exist in DB for this level yet
      if (submission.evaluation?.criteria) {
        try {
          parsedCriteria = JSON.parse(submission.evaluation.criteria);
        } catch {
          parsedCriteria = [];
        }
      }
    }

    // The cap is the LEVEL's configured maximum, full stop. Not the rubric sum,
    // and not whatever this evaluation happened to be created with — a stored
    // `Evaluation.maxScore` from an earlier configuration must not outrank the
    // current one.
    const dynamicMaxScore = scale.maxScore;

    // Record SUBMISSION_OPENED audit log
    await prisma.auditLog
      .create({
        data: {
          actorId: user.id,
          targetId: submission.userId,
          action: 'SUBMISSION_OPENED',
          details: `Evaluator @${user.username} opened Level ${submission.level} deliverables for Squad "${submission.team.name}".`,
        },
      })
      .catch(() => {});

    // Resolve submitter and team member real names from pre-registered records
    const memberEmails = submission.team.members.map((m) => m.user.email);
    const preRegUsers = await prisma.preRegisteredParticipant.findMany({
      where: { email: { in: [submission.user.email, ...memberEmails] } },
      select: { email: true, name: true },
    });
    const nameMap = new Map(preRegUsers.map((p) => [p.email.toLowerCase(), p.name]));

    const submitterRealName = nameMap.get(submission.user.email.toLowerCase());
    const isHead =
      submission.team.creatorId === submission.userId ||
      submission.team.members.some((m) => m.user.id === submission.userId && m.role === 'HEAD');
    const submitterRole = isHead ? 'Team Head' : 'Squad Member';

    const headMember =
      submission.team.members.find((m) => m.role === 'HEAD') || submission.team.members[0];
    const headEmail = headMember?.user.email;
    const headRealName = headEmail ? nameMap.get(headEmail.toLowerCase()) : null;
    const teamHead = headRealName
      ? `${headRealName} (@${headMember?.user.username})`
      : headMember
        ? `@${headMember.user.username}`
        : 'UNASSIGNED';

    return {
      success: true,
      data: {
        id: submission.id,
        teamId: submission.teamId,
        teamName: submission.team.name,
        teamHead,
        level: submission.level,
        submittedBy: `@${submission.user.username}`,
        submitterName: submitterRealName
          ? `${submitterRealName} (@${submission.user.username})`
          : `@${submission.user.username}`,
        submitterRole,
        submittedAt: submission.submittedAt,
        submissionStatus: submission.status,
        answers: parsedAnswers,
        attemptCount: submission.attemptCount,
        // Superseded attempts only. The row above IS the current submission —
        // the unique index on (teamId, level) guarantees there is exactly one —
        // so nothing here can be mistaken for the version under evaluation.
        attempts: submission.attempts
          .filter((a) => a.attemptNumber !== submission.attemptCount)
          .map((a) => ({
            attemptNumber: a.attemptNumber,
            submittedAt: a.createdAt,
            fileNames: readManifestNames(a.fileManifest),
          })),
        files: submission.files,
        team: {
          id: submission.team.id,
          name: submission.team.name,
          roster: submission.team.members.map((m) => ({
            userId: m.user.id,
            username: m.user.username,
            displayName: nameMap.get(m.user.email.toLowerCase()) || undefined,
            role: m.role === 'HEAD' ? 'Team Head' : 'Squad Member',
          })),
        },
        criteria: parsedCriteria,
        maxPossibleScore: dynamicMaxScore,
        // Non-null only when the level's rubric disagrees with its configured
        // maximum. The console renders it as a warning instead of silently
        // scoring against a total nobody configured.
        criteriaMismatch: scale.criteriaMismatch,
        evaluation: submission.evaluation
          ? {
              id: submission.evaluation.id,
              status: submission.evaluation.status,
              score: submission.evaluation.score,
              // The current configured maximum, not the one stored when this
              // evaluation row was created. A level re-configured mid-event must
              // not leave old evaluations rendering against a stale denominator.
              maxScore: dynamicMaxScore,
              criteria: parsedCriteria,
              notes: submission.evaluation.notes || '',
              feedback: submission.evaluation.feedback || '',
              version: submission.evaluation.version,
              evaluatorId: submission.evaluation.evaluatorId,
              evaluatorUsername: submission.evaluation.evaluator.username,
              startedAt: submission.evaluation.startedAt,
              submittedAt: submission.evaluation.submittedAt,
            }
          : null,
        scoreAdjustments: (
          await prisma.scoreAdjustment.findMany({
            where: { teamId: submission.team.id },
            include: {
              requestedBy: { select: { username: true } },
              reviewedBy: { select: { username: true } },
            },
            orderBy: [{ createdAt: 'desc' }],
          })
        ).map((adj) => ({
          id: adj.id,
          teamId: adj.teamId,
          teamName: submission.team.name,
          level: adj.level,
          points: adj.points,
          reason: adj.reason,
          evidenceNote: adj.evidenceNote,
          status: adj.status as 'PENDING' | 'APPROVED' | 'REJECTED',
          requestedByUserId: adj.requestedByUserId,
          requestedByUsername: adj.requestedBy.username,
          reviewedByUserId: adj.reviewedByUserId,
          reviewedByUsername: adj.reviewedBy?.username ?? null,
          reviewedAt: adj.reviewedAt ? adj.reviewedAt.toISOString() : null,
          rejectionReason: adj.rejectionReason,
          createdAt: adj.createdAt.toISOString(),
          updatedAt: adj.updatedAt.toISOString(),
        })),
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to retrieve submission details.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Server Action: Start Evaluation Workflow for a Submission (Sets status to IN_REVIEW)
 */
export async function startEvaluationAction(
  submissionId: string,
): Promise<ActionResult<{ evaluationId: string; version: number }>> {
  try {
    const user = await requireEvaluatorRole();

    // PRIVACY: explicit select — `team: true` previously loaded Team.code (the
    // private squad join code) and Team.passwordHash for a workflow that only
    // needs the squad name.
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        teamId: true,
        userId: true,
        level: true,
        team: { select: { name: true } },
        evaluation: { select: { id: true, startedAt: true } },
      },
    });

    if (!submission) {
      return {
        success: false,
        error:
          'That submission no longer exists. It may have been withdrawn or the squad deleted. ' +
          'Return to the submissions queue and refresh.',
      };
    }

    // LEVEL 1 HAS NO EVALUATION WORKFLOW (Evaluator spec §10).
    // Enforced server-side: a crafted request naming a Level 1 submission is
    // refused here regardless of what the UI offered.
    if (!isEvaluableLevel(submission.level)) {
      return {
        success: false,
        error:
          `Level ${submission.level} submissions are not evaluated. ` +
          `Only Level ${EVALUABLE_LEVELS.join(' and Level ')} deliverables go through evaluation.`,
      };
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // Read the evaluation INSIDE the transaction rather than reusing the row
      // fetched before it. Two evaluators can open the same submission at the
      // same moment; the pre-transaction read could be stale by the time we act
      // on it, whereas this read is consistent with the write that follows.
      const existing = await tx.evaluation.findUnique({
        where: { submissionId },
        select: { id: true, startedAt: true },
      });

      let evaluation;

      if (!existing) {
        // Create initial evaluation record
        evaluation = await tx.evaluation.create({
          data: {
            submissionId,
            evaluatorId: user.id,
            teamId: submission.teamId,
            level: submission.level,
            status: 'IN_REVIEW',
            startedAt: now,
            version: 1,
          },
        });
      } else {
        // Update to IN_REVIEW if PENDING or reassigned
        evaluation = await tx.evaluation.update({
          where: { id: existing.id },
          data: {
            status: 'IN_REVIEW',
            evaluatorId: user.id,
            startedAt: existing.startedAt || now,
            version: { increment: 1 },
          },
        });
      }

      await tx.submission.update({
        where: { id: submissionId },
        data: { status: 'UNDER_REVIEW' },
      });

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          targetId: submission.userId,
          action: 'EVALUATION_STARTED',
          details: `Evaluator @${user.username} started forensic review for Squad "${submission.team.name}" (Level ${submission.level}).`,
        },
      });

      return evaluation;
    }, CRITICAL_WRITE_TX);

    safeRevalidate(
      '/evaluator/submissions',
      '/evaluator/evaluations',
      `/evaluator/evaluations/${submissionId}`,
    );

    return {
      success: true,
      data: {
        evaluationId: result.id,
        version: result.version,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to start evaluation.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Server Action: Submit or Update Forensic Evaluation with Optimistic Concurrency and Atomic Score Aggregation.
 */
export async function saveEvaluationAction(input: {
  submissionId: string;
  score: number;
  criteria?: EvaluationCriterionItem[];
  notes?: string;
  feedback?: string;
  status: 'IN_REVIEW' | 'EVALUATED' | 'RETURNED';
  version?: number;
}): Promise<ActionResult<{ score: number; maxScore: number; status: string; version: number }>> {
  try {
    const user = await requireEvaluatorRole();

    const { submissionId, score, criteria, notes, feedback, status, version } = input;

    // PRIVACY: explicit select; see startEvaluationAction.
    const submission = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        teamId: true,
        userId: true,
        level: true,
        team: { select: { name: true } },
      },
    });

    if (!submission) {
      return {
        success: false,
        error:
          'That submission no longer exists, so the evaluation could not be saved. ' +
          'Return to the submissions queue and refresh.',
      };
    }

    // LEVEL 1 HAS NO EVALUATION WORKFLOW (Evaluator spec §10).
    if (!isEvaluableLevel(submission.level)) {
      return {
        success: false,
        error:
          `Level ${submission.level} submissions are not evaluated. ` +
          `Only Level ${EVALUABLE_LEVELS.join(' and Level ')} deliverables go through evaluation.`,
      };
    }

    const now = new Date();

    // Finalising an evaluation ('EVALUATED') hands it to the Admin approval queue.
    // It does NOT publish to the leaderboard — see recomputeTeamScore below.
    // Drafts and returned-for-revision states are not awaiting a decision.
    const nextApprovalStatus =
      status === 'EVALUATED' ? APPROVAL_STATUS.PENDING_APPROVAL : APPROVAL_STATUS.NOT_SUBMITTED;

    // 2. Perform Transactional Evaluation Update with Dynamic Criteria & Optimistic Lock
    const saved = await prisma.$transaction(async (tx) => {
      // SAME resolver as the open path, inside the transaction so the cap a
      // score is validated against is read under the same snapshot that writes
      // it. This used to be a second, independently written copy of the rule —
      // and the two could disagree, which is exactly how a score gets accepted
      // against one maximum and displayed against another.
      const scale = await resolveLevelEvaluationScale(tx, submission.level);
      const computedMaxScore = scale.maxScore;
      const activeCriteria = scale.criteria.map((c) => ({
        id: c.id,
        title: c.name,
        maxPoints: c.maxMarks,
      }));

      // A level with no configured maximum cannot be scored. Refusing here beats
      // accepting a score against a ceiling of 0 and calling it valid.
      if (computedMaxScore <= 0) {
        throw new Error(
          `Level ${submission.level} has no configured maximum score, so its deliverables cannot be ` +
            `evaluated yet. An Admin sets this at Admin → Levels.`,
        );
      }

      // The rubric disagrees with the configured maximum, so criterion marks
      // cannot be trusted to add up to a valid total. Reject rather than score.
      if (scale.criteriaMismatch && criteria && criteria.length > 0) {
        throw new Error(scale.criteriaMismatch);
      }

      // Validate scores against dynamic limits
      let finalScore = score;

      if (criteria && criteria.length > 0) {
        let criteriaSum = 0;
        for (const item of criteria) {
          const marks = Number(item.awardedMarks);
          if (isNaN(marks) || marks < 0) {
            throw new Error(
              `Criterion "${item.name}" has invalid marks. Awarded marks cannot be negative or empty.`,
            );
          }
          if (marks > item.maxMarks) {
            throw new Error(
              `Criterion "${item.name}" awarded marks (${marks}) exceed the maximum allowable (${item.maxMarks}).`,
            );
          }
          criteriaSum += marks;
        }

        if (criteriaSum < 0 || criteriaSum > computedMaxScore) {
          throw new Error(
            `Total evaluated score (${criteriaSum}) is outside permitted range [0, ${computedMaxScore}].`,
          );
        }

        finalScore = criteriaSum;
      } else {
        if (typeof score !== 'number' || isNaN(score) || !Number.isInteger(score)) {
          throw new Error('Score must be a valid integer.');
        }
        if (score < 0 || score > computedMaxScore) {
          throw new Error(
            `Score ${score} is outside the permitted range [0, ${computedMaxScore}] for Level ${submission.level}.`,
          );
        }
      }

      let evaluation = await tx.evaluation.findUnique({
        where: { submissionId },
      });

      if (!evaluation) {
        evaluation = await tx.evaluation.create({
          data: {
            submissionId,
            evaluatorId: user.id,
            teamId: submission.teamId,
            level: submission.level,
            score: finalScore,
            maxScore: computedMaxScore,
            criteria: criteria ? JSON.stringify(criteria) : null,
            notes: notes || null,
            feedback: feedback || null,
            status,
            approvalStatus: nextApprovalStatus,
            version: 1,
            startedAt: now,
            submittedAt: status === 'EVALUATED' ? now : null,
          },
        });
      } else {
        // Optimistic concurrency control (CONC-17-01)
        const previous = evaluation;

        const updateResult = await tx.evaluation.updateMany({
          where: {
            id: previous.id,
            ...(typeof version === 'number' ? { version } : {}),
          },
          data: {
            evaluatorId: user.id,
            score: finalScore,
            maxScore: computedMaxScore,
            criteria: criteria ? JSON.stringify(criteria) : previous.criteria,
            notes: notes !== undefined ? notes : previous.notes,
            feedback: feedback !== undefined ? feedback : previous.feedback,
            status,
            approvalStatus: nextApprovalStatus,
            rejectedById: null,
            rejectedAt: null,
            rejectionReason: null,
            version: { increment: 1 },
            submittedAt: status === 'EVALUATED' ? now : previous.submittedAt,
          },
        });

        if (updateResult.count === 0) {
          throw new Error('CONCURRENCY_CONFLICT');
        }

        evaluation = await tx.evaluation.findUniqueOrThrow({ where: { id: previous.id } });
      }

      // Persist individual normalized evaluation score records
      if (criteria && criteria.length > 0) {
        for (const item of criteria) {
          const matched = activeCriteria.find(
            (c) => c.id === item.criterionId || c.id === item.id || c.title === item.name,
          );
          if (matched) {
            await tx.evaluationScore.upsert({
              where: {
                evaluationId_criterionId: {
                  evaluationId: evaluation.id,
                  criterionId: matched.id,
                },
              },
              create: {
                evaluationId: evaluation.id,
                criterionId: matched.id,
                awardedScore: Number(item.awardedMarks) || 0,
                notes: item.feedback || null,
              },
              update: {
                awardedScore: Number(item.awardedMarks) || 0,
                notes: item.feedback || null,
              },
            });
          }
        }
      }

      // Update submission status based on evaluation state
      const submissionNextStatus =
        status === 'EVALUATED' ? 'ACCEPTED' : status === 'RETURNED' ? 'REJECTED' : 'UNDER_REVIEW';

      await tx.submission.update({
        where: { id: submissionId },
        data: { status: submissionNextStatus },
      });

      // Recalculate squad total from APPROVED evaluations only
      await recomputeTeamScore(tx, submission.teamId);

      // Record Audit Log
      const auditAction =
        status === 'RETURNED'
          ? 'EVALUATION_RETURNED'
          : status === 'EVALUATED'
            ? 'EVALUATION_SUBMITTED'
            : 'SCORE_UPDATED';

      const approvalNote =
        status === 'EVALUATED' ? ' Submitted for Admin approval; not yet on the leaderboard.' : '';

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          targetId: submission.userId,
          action: auditAction,
          details:
            `Evaluator @${user.username} saved evaluation for Squad "${submission.team.name}" ` +
            `(Level ${submission.level}): Score ${finalScore}/${computedMaxScore}, Status: ${status}.${approvalNote}`,
        },
      });

      return evaluation;
    }, CRITICAL_WRITE_TX);

    safeRevalidate(
      '/evaluator',
      '/evaluator/teams',
      '/evaluator/submissions',
      '/evaluator/evaluations',
      `/evaluator/evaluations/${submissionId}`,
      '/leaderboard',
      '/dashboard',
    );

    return {
      success: true,
      data: {
        score: saved.score,
        maxScore: saved.maxScore,
        status: saved.status,
        version: saved.version,
      },
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'CONCURRENCY_CONFLICT') {
      return {
        success: false,
        error:
          'This evaluation was modified by another evaluator or session. Please reload to inspect latest changes before saving.',
      };
    }
    const errorMsg =
      err instanceof Error ? err.message : 'An error occurred while saving the evaluation.';
    return { success: false, error: errorMsg };
  }
}

/**
 * Server Action: Retrieve Chronological Evaluator Activity Logs with Filtering
 */
export async function getEvaluatorActivityLogsAction(params?: {
  page?: number | undefined;
  limit?: number | undefined;
  action?: string | undefined;
  teamId?: string | undefined;
  level?: number | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}): Promise<
  ActionResult<{
    logs: Array<{
      id: string;
      action: string;
      details: string | null;
      createdAt: Date;
      actor: { id: string; username: string; email: string } | null;
    }>;
    totalCount: number;
    totalPages: number;
  }>
> {
  try {
    await requireEvaluatorRole();

    const page = Math.max(1, params?.page || 1);
    const limit = Math.min(100, Math.max(1, params?.limit || 25));
    const skip = (page - 1) * limit;

    const allowedActions = [
      'SUBMISSION_OPENED',
      'EVALUATION_STARTED',
      'SCORE_UPDATED',
      'EVALUATION_SUBMITTED',
      'EVALUATION_RETURNED',
      'FILE_ACCESSED',
      'LOGIN',
      'LOGOUT',
    ];

    const where: Record<string, unknown> = {
      action: { in: params?.action ? [params.action] : allowedActions },
    };

    // BUG-17-05: this previously compared AuditLog.targetId -- which holds a
    // USER id -- against a TEAM id, so the squad filter silently matched nothing
    // and evaluators saw an empty activity log with no indication why.
    // AuditLog has no team column, so the squad is resolved to its members and
    // matched on either side of the event.
    if (params?.teamId) {
      const members = await prisma.teamMember.findMany({
        where: { teamId: params.teamId },
        select: { userId: true },
      });
      const memberIds = members.map((m) => m.userId);
      where['OR'] = [{ actorId: { in: memberIds } }, { targetId: { in: memberIds } }];
    }

    if (params?.dateFrom || params?.dateTo) {
      const createdAtFilter: Record<string, Date> = {};
      if (params?.dateFrom) {
        createdAtFilter['gte'] = new Date(params.dateFrom);
      }
      if (params?.dateTo) {
        createdAtFilter['lte'] = new Date(params.dateTo);
      }
      where['createdAt'] = createdAtFilter;
    }

    const [logs, totalCount] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          action: true,
          details: true,
          createdAt: true,
          actor: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      success: true,
      data: {
        logs,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to query evaluator activity.';
    return { success: false, error: errorMsg };
  }
}
