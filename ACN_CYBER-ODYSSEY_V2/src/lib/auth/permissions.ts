import 'server-only';

/**
 * Permission model — ROLE + ACTION + RESOURCE SCOPE.
 *
 * Replaces bare `role === 'ADMIN'` checks with an explicit capability grant, so
 * that "what may this actor do to this resource" is answered in one place and can
 * be tested exhaustively.
 *
 * ---------------------------------------------------------------------------
 * SCOPE, AND AN HONEST NOTE ABOUT IT
 * ---------------------------------------------------------------------------
 * The role specifications are written for a MULTI-EVENT platform: "the Creator's
 * own event", "another Creator's event", "the Evaluator's assigned team". This
 * codebase is a SINGLE-EVENT platform. There is no `Event` model — the event is
 * represented by three `LevelState` rows and one `PortalSetting` row — and there
 * is no evaluator-assignment model.
 *
 * Rather than fabricate an `Event` table and an `EvaluatorAssignment` table that
 * nothing would ever populate (which would produce authorization checks that are
 * either always-true or always-false — security theatre), the scope layer is
 * modelled explicitly with `EVENT_SCOPE_SINGLETON`. Every scoped check routes
 * through `isWithinScope()`.
 *
 * The practical consequences today:
 *   - Creator scope covers the single event, so Creator sees all teams/accounts.
 *   - Evaluator scope covers the single event, so any active Evaluator may
 *     evaluate any Level 2/3 submission.
 *
 * When a real `Event` model is introduced, `isWithinScope()` is the ONE function
 * that changes. Callers already pass the resource, so no call site needs editing.
 * This limitation is reported in docs/roles-and-permissions.md.
 */

export type PortalRole = 'PARTICIPANT' | 'EVALUATOR' | 'ADMIN' | 'CREATOR';

/**
 * Every privileged capability in the portal. Named for the action, not the page,
 * so that moving a feature between screens does not change the security model.
 */
export type Permission =
  // --- Creator: event & content -------------------------------------------
  | 'EVENT_EDIT'
  | 'EVENT_LEVEL_CONTENT_EDIT'
  | 'LEVEL_RESOURCE_MANAGE'
  // --- Creator: governance -------------------------------------------------
  | 'STAFF_APPROVE'
  | 'ACCOUNT_VIEW'
  | 'ACCOUNT_BLOCK'
  | 'ACCOUNT_DELETE'
  | 'ACCOUNT_RESET_CREDENTIAL'
  | 'TEAM_VIEW_DETAIL'
  | 'TEAM_MANAGE'
  | 'TEAM_RESET_CREDENTIAL'
  | 'PORTAL_CONTROL'
  | 'AUDIT_LOG_VIEW'
  // --- Communications ------------------------------------------------------
  | 'ANNOUNCEMENT_SEND'
  | 'REPORT_TO_CREATOR_SEND'
  | 'REPORT_TO_CREATOR_VIEW'
  // --- Admin: oversight ----------------------------------------------------
  | 'PARTICIPANT_VIEW'
  | 'TEAM_VIEW'
  | 'LEVEL_LIFECYCLE_CONTROL'
  | 'EVALUATION_VIEW_ALL'
  | 'EVALUATION_APPROVE'
  | 'EVALUATION_REJECT'
  // --- Evaluator: scoring --------------------------------------------------
  | 'SUBMISSION_VIEW'
  | 'EVALUATION_CREATE'
  | 'EVALUATION_SCORE';

/**
 * Capability grants per role.
 *
 * Roles are SEPARATE AUTHORITIES, not a hierarchy. Creator is deliberately NOT
 * granted EVALUATION_APPROVE or EVALUATION_SCORE: the approval gate only means
 * something if the authority that approves is distinct from the authority that
 * creates content and the authority that scores. Admin is likewise not granted
 * Creator governance.
 */
const ROLE_PERMISSIONS: Record<PortalRole, ReadonlySet<Permission>> = {
  CREATOR: new Set<Permission>([
    'EVENT_EDIT',
    'EVENT_LEVEL_CONTENT_EDIT',
    'LEVEL_RESOURCE_MANAGE',
    'STAFF_APPROVE',
    'ACCOUNT_VIEW',
    'ACCOUNT_BLOCK',
    'ACCOUNT_DELETE',
    'ACCOUNT_RESET_CREDENTIAL',
    'TEAM_VIEW',
    'TEAM_VIEW_DETAIL',
    'TEAM_MANAGE',
    'TEAM_RESET_CREDENTIAL',
    'PORTAL_CONTROL',
    'AUDIT_LOG_VIEW',
    'ANNOUNCEMENT_SEND',
    'REPORT_TO_CREATOR_VIEW',
    'PARTICIPANT_VIEW',
    'SUBMISSION_VIEW',
  ]),

  ADMIN: new Set<Permission>([
    'PARTICIPANT_VIEW',
    'TEAM_VIEW',
    'TEAM_VIEW_DETAIL',
    'LEVEL_LIFECYCLE_CONTROL',
    'EVALUATION_VIEW_ALL',
    'EVALUATION_APPROVE',
    'EVALUATION_REJECT',
    'ANNOUNCEMENT_SEND',
    'REPORT_TO_CREATOR_SEND',
    'PORTAL_CONTROL',
  ]),

  EVALUATOR: new Set<Permission>([
    'TEAM_VIEW',
    'TEAM_VIEW_DETAIL',
    'SUBMISSION_VIEW',
    'EVALUATION_CREATE',
    'EVALUATION_SCORE',
  ]),

  PARTICIPANT: new Set<Permission>([]),
};

/** The single event this deployment runs. See the module note above. */
export const EVENT_SCOPE_SINGLETON = 'cyber-odyssey-v2';

export interface ResourceScope {
  /** Event the resource belongs to. Always the singleton in this deployment. */
  eventId?: string | undefined;
  /** Team the resource belongs to, where relevant. */
  teamId?: string | undefined;
  /** Level the resource belongs to, where relevant. */
  level?: number | undefined;
}

export interface Actor {
  id: string;
  role: string;
  status: string;
}

/** An actor is only ever authorised while their account is ACTIVE. */
export function isActiveActor(actor: Actor | null | undefined): actor is Actor {
  return Boolean(actor && actor.status === 'ACTIVE');
}

function asPortalRole(role: string): PortalRole | null {
  return role === 'PARTICIPANT' || role === 'EVALUATOR' || role === 'ADMIN' || role === 'CREATOR'
    ? role
    : null;
}

/** Does this role hold this capability at all, ignoring scope? */
export function roleHasPermission(role: string, permission: Permission): boolean {
  const portalRole = asPortalRole(role);
  if (!portalRole) return false;
  return ROLE_PERMISSIONS[portalRole].has(permission);
}

/**
 * Is the resource inside the actor's authorised scope?
 *
 * Today every staff role is scoped to the single event, so this reduces to an
 * event-identity check. It is written as a real function rather than inlined
 * `true` so that introducing multi-event support is a change in ONE place.
 */
export function isWithinScope(_actor: Actor, scope: ResourceScope | undefined): boolean {
  // `_actor` is unused only because every staff role currently shares the single
  // event scope. It stays in the signature because the moment a real Event model
  // exists, the actor's own event is exactly what this must compare against —
  // and every call site already passes it.
  if (!scope?.eventId) return true;
  return scope.eventId === EVENT_SCOPE_SINGLETON;
}

/**
 * LEVEL 1 HAS NO EVALUATION WORKFLOW.
 *
 * Required by the Evaluator specification and enforced here so that every caller
 * — server action, route, and UI — reads the same rule from one place.
 */
export const EVALUABLE_LEVELS = [2, 3] as const;

export function isEvaluableLevel(level: number): boolean {
  return (EVALUABLE_LEVELS as readonly number[]).includes(level);
}

export interface AuthorizationResult {
  allowed: boolean;
  /** User-facing explanation. Never leaks internal detail. */
  reason?: string;
}

/**
 * The single authorization entry point: ROLE + ACTION + RESOURCE SCOPE.
 *
 * Returns a result rather than throwing so callers can shape their own error
 * response; `assertPermission` is the throwing variant.
 */
export function checkPermission(
  actor: Actor | null | undefined,
  permission: Permission,
  scope?: ResourceScope,
): AuthorizationResult {
  if (!actor) {
    return { allowed: false, reason: 'Your session has expired. Please sign in again.' };
  }

  if (!isActiveActor(actor)) {
    return {
      allowed: false,
      reason:
        'This account is not active, so it cannot perform this action. ' +
        'If your account is awaiting approval or has been blocked, contact an event marshal.',
    };
  }

  if (!roleHasPermission(actor.role, permission)) {
    return {
      allowed: false,
      reason: 'Your account does not have permission to perform this action.',
    };
  }

  if (!isWithinScope(actor, scope)) {
    return {
      allowed: false,
      reason: 'This resource belongs to an event your account does not manage.',
    };
  }

  // Level-scoped capabilities additionally respect the Level 1 exclusion.
  const isEvaluationAction =
    permission === 'EVALUATION_CREATE' ||
    permission === 'EVALUATION_SCORE' ||
    permission === 'EVALUATION_APPROVE' ||
    permission === 'EVALUATION_REJECT';

  if (isEvaluationAction && scope?.level !== undefined && !isEvaluableLevel(scope.level)) {
    return {
      allowed: false,
      reason:
        `Level ${scope.level} does not have an evaluation stage. ` +
        'Only Level 2 and Level 3 submissions are evaluated.',
    };
  }

  return { allowed: true };
}

/** Thrown by `assertPermission`. Carries a safe, user-facing message. */
export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/** Throwing variant of `checkPermission`, for use at the top of server actions. */
export function assertPermission(
  actor: Actor | null | undefined,
  permission: Permission,
  scope?: ResourceScope,
): asserts actor is Actor {
  const result = checkPermission(actor, permission, scope);
  if (!result.allowed) {
    throw new AuthorizationError(result.reason ?? 'Not authorized.');
  }
}

/**
 * Separation of duties: an evaluator may never approve or reject the evaluation
 * they authored, regardless of any other permission they hold.
 */
export function canApproveEvaluation(
  actor: Actor | null | undefined,
  evaluation: { evaluatorId: string; level: number },
): AuthorizationResult {
  const base = checkPermission(actor, 'EVALUATION_APPROVE', { level: evaluation.level });
  if (!base.allowed) return base;

  if (actor && actor.id === evaluation.evaluatorId) {
    return {
      allowed: false,
      reason:
        'You cannot approve an evaluation you authored yourself. ' +
        'Approval must come from a different reviewer.',
    };
  }

  return { allowed: true };
}
