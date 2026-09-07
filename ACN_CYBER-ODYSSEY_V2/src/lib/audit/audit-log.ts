import { prisma } from '@/lib/prisma';

/**
 * Audit logging helpers.
 *
 * THE PROBLEM THIS SOLVES (Phase 17 / PERF-17-04)
 * -----------------------------------------------
 * Several audit writes were attached to RENDER, not to an action:
 *
 *   - /event/level-2 wrote LEVEL2_OPENED on every render of the workspace —
 *     every refresh, every client-side navigation back to it, and every
 *     re-render triggered by an unrelated `revalidatePath('/event/level-2')`
 *     from the Admin console.
 *   - The Admin participants/teams/submissions consoles each wrote a *_VIEWED
 *     row on every list query, including every filter keystroke.
 *
 * During a live 2-hour Level 2 with ~210 participants this is the single largest
 * source of database writes in the application, and every one of those writes
 * contends for SQLite's single write lock against the writes that actually
 * matter — submissions and evaluations.
 *
 * The fix is not to delete the audit trail. It is to record the SIGNAL ("this
 * participant worked on Level 2", "this admin reviewed the submissions console")
 * exactly once per window instead of once per paint.
 */

/**
 * Default de-duplication window for render-triggered audit events.
 * One row per actor per event per 15 minutes preserves the forensic timeline
 * while bounding writes to roughly `participants / 15min` instead of
 * `participants x refreshes`.
 */
const DEFAULT_DEDUPE_WINDOW_MS = 15 * 60 * 1000;

export interface AuditEventInput {
  actorId?: string | null;
  targetId?: string | null;
  action: string;
  details?: string | null;
}

/**
 * Records an audit event unconditionally.
 *
 * Use for STATE CHANGES and privileged data access — logins, submissions,
 * evaluations, score changes, blocks, deletions, level and portal transitions,
 * file downloads. These are the events an incident investigation depends on and
 * they are never suppressed.
 *
 * Never throws: an audit failure must not roll back or fail the user's action.
 * Callers that need the audit row to be part of the transaction should write it
 * through the transaction client directly instead.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        targetId: input.targetId ?? null,
        action: input.action,
        details: input.details ?? null,
      },
    });
  } catch (error) {
    console.error('[audit] Failed to record event', input.action, error);
  }
}

/**
 * Records an audit event at most once per actor per action per window.
 *
 * Use for VIEW/OPEN events that fire on render. The lookup is served by the
 * `AuditLog(actorId)` index and is a cheap read that replaces an expensive
 * write on the hot path.
 *
 * Returns true if a row was written, false if it was suppressed as a duplicate.
 */
export async function recordThrottledAuditEvent(
  input: AuditEventInput,
  windowMs: number = DEFAULT_DEDUPE_WINDOW_MS,
): Promise<boolean> {
  if (!input.actorId) return false;

  try {
    const since = new Date(Date.now() - windowMs);
    const recent = await prisma.auditLog.findFirst({
      where: {
        actorId: input.actorId,
        action: input.action,
        createdAt: { gte: since },
      },
      select: { id: true },
    });

    if (recent) return false;

    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        targetId: input.targetId ?? null,
        action: input.action,
        details: input.details ?? null,
      },
    });
    return true;
  } catch (error) {
    console.error('[audit] Failed to record throttled event', input.action, error);
    return false;
  }
}
