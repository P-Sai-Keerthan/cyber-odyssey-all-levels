const crypto = require("crypto");
const { query } = require("./db");
const { sendEvent } = require("./portalClient");
const { integrationSecret } = require("./integrationSignature");
const { portalBaseUrl } = require("./portalClient");

/**
 * Durable outbox for Portal score events.
 *
 * ---------------------------------------------------------------------------
 * THE GUARANTEE, AND HOW IT IS MADE
 * ---------------------------------------------------------------------------
 * Every question a squad solves must reach the Portal exactly once. Two things
 * make that true, and neither is a transaction:
 *
 *   1. ENQUEUE IS IDEMPOTENT. `uq_outbox_subject` (team, question, type, hint)
 *      means the same logical event can only ever produce one row. Enqueueing
 *      twice is a no-op, so the call is safe to make from anywhere, any number of
 *      times.
 *
 *   2. ENQUEUE IS RECOVERABLE. `reconcile()` derives what SHOULD be queued
 *      directly from `track_answers` — the same rows the score itself is derived
 *      from — and inserts anything missing. So an enqueue that never ran, because
 *      the process died between the award and the insert, is repaired on the next
 *      sweep.
 *
 * That pairing is deliberately preferred over wrapping the award and the enqueue
 * in one transaction. The award is a single atomic UPSERT (see
 * lib/teams.js#recordTrackAttempt) whose concurrency behaviour is load-bearing
 * and well understood; widening it into a multi-statement transaction to carry a
 * bookkeeping insert would put the thing that matters at risk to protect the
 * thing that can be rebuilt. Here the bookkeeping is rebuildable from the award,
 * so the award stays untouched.
 *
 * ---------------------------------------------------------------------------
 * DELIVERY
 * ---------------------------------------------------------------------------
 * `event_id` is generated ONCE at enqueue and reused on every attempt: the Portal
 * absorbs a redelivery of the same event id as an idempotent success. `nonce` is
 * fresh per attempt: the Portal refuses a repeat, which is what distinguishes a
 * legitimate retry from a replayed request.
 *
 * A 4xx is terminal — the Portal has told us something about the event that will
 * be equally true later. A 5xx, a timeout or a network failure is retried with
 * exponential backoff up to MAX_ATTEMPTS, then ABANDONED and left visible to an
 * operator rather than deleted.
 */

const MAX_ATTEMPTS = 8;
/** 2s, 4s, 8s, ... capped. Long enough to ride out a restart, short enough for a 45-minute event. */
const BACKOFF_BASE_MS = 2000;
const BACKOFF_CAP_MS = 60_000;
/** How many events one drain pass will attempt. Bounds the work per request. */
const DRAIN_BATCH = 25;

const EVENT_SOLVED = "LEVEL1_CHALLENGE_SOLVED";
const EVENT_HINT = "LEVEL1_HINT_UNLOCKED";

/** True when both halves of the bridge configuration are present. */
function bridgeConfigured() {
  return Boolean(integrationSecret() && portalBaseUrl());
}

function backoffMs(attempts) {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempts - 1)));
}

/**
 * Queues one event for delivery.
 *
 * Silently does nothing when the team has no Portal reference — a local-only
 * rehearsal team has nothing to report to and is not an error.
 *
 * The payload is built here and stored, so the body that is eventually signed is
 * the body that was decided at enqueue time. A later change to what we send
 * cannot rewrite an event already waiting in the queue.
 */
async function enqueue({ teamId, portalTeamRef, questionCode, eventType, hintNumber = 0, solvedAt }) {
  if (!portalTeamRef) return null;

  const eventId = crypto.randomUUID();
  const payload = {
    eventId,
    // Placeholder: replaced with a fresh value on every delivery attempt.
    nonce: null,
    eventType,
    externalTeamRef: portalTeamRef,
    externalChallengeRef: questionCode,
    ...(eventType === EVENT_HINT ? { hintNumber } : {}),
    ...(solvedAt ? { solvedAt: new Date(solvedAt).toISOString() } : {}),
  };

  const { rows } = await query(
    `INSERT INTO integration_outbox
       (event_id, event_type, team_id, question_code, hint_number, payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (team_id, question_code, event_type, hint_number) DO NOTHING
     RETURNING id`,
    [eventId, eventType, teamId, questionCode, hintNumber, JSON.stringify(payload)]
  );

  return rows[0] ? rows[0].id : null;
}

/** Queues a verified solve. Safe to call on every submission; only the first sticks. */
async function enqueueSolve(team, questionCode, solvedAt) {
  return enqueue({
    teamId: team.id,
    portalTeamRef: team.portalTeamRef,
    questionCode,
    eventType: EVENT_SOLVED,
    hintNumber: 0,
    solvedAt: solvedAt || new Date(),
  });
}

/** Queues a hint unlock. Safe to call repeatedly; only the first sticks. */
async function enqueueHint(team, questionCode, hintNumber = 1) {
  return enqueue({
    teamId: team.id,
    portalTeamRef: team.portalTeamRef,
    questionCode,
    eventType: EVENT_HINT,
    hintNumber,
  });
}

/**
 * Repairs the queue from the authoritative record.
 *
 * `track_answers` is where the score actually lives. Anything correct in there,
 * for a team with a Portal reference, MUST have a solve event; anything with
 * hint_used must have a hint event. This inserts whatever is missing.
 *
 * Both statements are ON CONFLICT DO NOTHING, so this is safe to run at any time,
 * as often as you like, concurrently with live play. It is what turns "we might
 * have dropped an enqueue" into "we will pick it up within a minute".
 */
async function reconcile() {
  const solved = await query(
    `INSERT INTO integration_outbox
       (event_id, event_type, team_id, question_code, hint_number, payload)
     SELECT
       gen_random_uuid(),
       $1::text,
       ta.team_id,
       ta.question_code,
       0,
       jsonb_build_object(
         'eventId', gen_random_uuid()::text,
         'nonce', NULL,
         'eventType', $1::text,
         'externalTeamRef', t.portal_team_ref,
         'externalChallengeRef', ta.question_code,
         'solvedAt', to_char(COALESCE(ta.first_correct_at, now()) AT TIME ZONE 'UTC',
                             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )
       FROM track_answers ta
       JOIN teams t ON t.id = ta.team_id
      WHERE ta.correct = TRUE
        AND t.portal_team_ref IS NOT NULL
     ON CONFLICT (team_id, question_code, event_type, hint_number) DO NOTHING
     RETURNING id`,
    [EVENT_SOLVED]
  );

  const hints = await query(
    `INSERT INTO integration_outbox
       (event_id, event_type, team_id, question_code, hint_number, payload)
     SELECT
       gen_random_uuid(),
       $1::text,
       ta.team_id,
       ta.question_code,
       1,
       jsonb_build_object(
         'eventId', gen_random_uuid()::text,
         'nonce', NULL,
         'eventType', $1::text,
         'externalTeamRef', t.portal_team_ref,
         'externalChallengeRef', ta.question_code,
         'hintNumber', 1
       )
       FROM track_answers ta
       JOIN teams t ON t.id = ta.team_id
      WHERE ta.hint_used = TRUE
        AND t.portal_team_ref IS NOT NULL
     ON CONFLICT (team_id, question_code, event_type, hint_number) DO NOTHING
     RETURNING id`,
    [EVENT_HINT]
  );

  // The two gen_random_uuid() calls above produce different values, so a
  // reconciled row's stored payload carries a different eventId from its
  // event_id column. Delivery already overrides the payload with `row.event_id`,
  // so this is not a correctness problem — but a row whose stored payload
  // disagrees with its own key is a trap for the next person to read the table,
  // and the audit trail should say what was actually sent.
  await query(
    `UPDATE integration_outbox
        SET payload = jsonb_set(payload, '{eventId}', to_jsonb(event_id::text))
      WHERE payload->>'eventId' IS DISTINCT FROM event_id::text`
  );

  return { solved: solved.rows.length, hints: hints.rows.length };
}

/**
 * How long a claimed event stays claimed before another drain may take it.
 *
 * A lease, not a lock. If a process dies between claiming an event and recording
 * the outcome, the row would otherwise sit in SENDING forever and its score would
 * never arrive. When the lease expires the next drain picks it up — at the cost
 * of a possible re-delivery, which the Portal absorbs idempotently on `eventId`.
 * At-least-once with an idempotent receiver beats at-most-once with a hole in it.
 */
const CLAIM_LEASE_MS = 60_000;

/**
 * Attempts delivery of up to DRAIN_BATCH due events.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CLAIM IS AN UPDATE AND NOT A SELECT ... FOR UPDATE
 * ---------------------------------------------------------------------------
 * `lib/db.js` runs every statement on its own pooled connection in autocommit,
 * so a bare `SELECT ... FOR UPDATE SKIP LOCKED` releases its locks the instant
 * the statement returns — before a single HTTP request has been made. Two
 * concurrent drains would then both select the same rows and both deliver them.
 * That is not a correctness failure at the Portal, which deduplicates on eventId,
 * but it is wasted work and a confusing audit trail.
 *
 * Claiming with an UPDATE moves the row to SENDING and stamps a lease in one
 * statement. The `SKIP LOCKED` subquery still earns its keep: it is evaluated
 * inside the UPDATE's own transaction, so two simultaneous claims take disjoint
 * row sets instead of one blocking on the other.
 */
async function drain({ limit = DRAIN_BATCH } = {}) {
  if (!bridgeConfigured()) {
    return { attempted: 0, delivered: 0, failed: 0, skipped: "bridge_not_configured" };
  }

  const { rows } = await query(
    `UPDATE integration_outbox
        SET status = 'SENDING',
            next_retry_at = now() + ($2 || ' milliseconds')::interval
      WHERE id IN (
        SELECT id
          FROM integration_outbox
         WHERE status IN ('PENDING', 'FAILED', 'SENDING')
           AND next_retry_at <= now()
         ORDER BY created_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, event_id, payload, attempts`,
    [limit, String(CLAIM_LEASE_MS)]
  );

  let delivered = 0;
  let failed = 0;

  for (const row of rows) {
    // Fresh nonce per HTTP attempt; the eventId inside the stored payload stays
    // put. That pairing is the whole retry-vs-replay distinction.
    const payload = { ...row.payload, eventId: row.event_id, nonce: crypto.randomUUID() };

    // eslint-disable-next-line no-await-in-loop
    const result = await sendEvent(payload);

    if (result.ok) {
      // eslint-disable-next-line no-await-in-loop
      await query(
        `UPDATE integration_outbox
            SET status = 'SENT', delivered_at = now(), attempts = attempts + 1, last_error = NULL
          WHERE id = $1`,
        [row.id]
      );
      delivered += 1;
      continue;
    }

    const attempts = Number(row.attempts) + 1;
    const terminal = !result.retryable || attempts >= MAX_ATTEMPTS;
    const note = `${result.status || 0} ${result.code || "unknown"}${result.error ? ` (${result.error})` : ""}`;

    // eslint-disable-next-line no-await-in-loop
    await query(
      `UPDATE integration_outbox
          SET status = $2,
              attempts = $3,
              last_error = $4,
              next_retry_at = now() + ($5 || ' milliseconds')::interval
        WHERE id = $1`,
      [row.id, terminal ? "ABANDONED" : "FAILED", attempts, note, String(backoffMs(attempts))]
    );
    failed += 1;
  }

  return { attempted: rows.length, delivered, failed };
}

/**
 * Fire-and-forget drain for request handlers.
 *
 * Next.js Pages Router has no background worker, so delivery is driven by traffic
 * — which during a live event is plentiful. Guarded two ways: an in-flight flag so
 * concurrent requests do not pile up drains, and a minimum interval so a burst of
 * submissions triggers one drain, not fifty.
 *
 * This is a latency optimisation, NOT the delivery guarantee. The guarantee is
 * `reconcile()` plus a periodic `scripts/drain-outbox.js`, which is what a
 * production deployment should run on a timer. A quiet event still delivers.
 */
let draining = false;
let lastDrainAt = 0;
const MIN_DRAIN_INTERVAL_MS = 1500;

function maybeDrain() {
  if (draining) return;
  if (Date.now() - lastDrainAt < MIN_DRAIN_INTERVAL_MS) return;
  if (!bridgeConfigured()) return;

  draining = true;
  lastDrainAt = Date.now();

  drain()
    .catch((err) => console.error("[OUTBOX] drain failed:", err.message))
    .finally(() => {
      draining = false;
    });
}

/** Counts by status, for the admin dashboard and for operators. */
async function summary() {
  const { rows } = await query(
    `SELECT status, COUNT(*)::int AS count FROM integration_outbox GROUP BY status`
  );
  const out = { PENDING: 0, SENDING: 0, SENT: 0, FAILED: 0, ABANDONED: 0 };
  for (const row of rows) out[row.status] = row.count;
  return { ...out, configured: bridgeConfigured() };
}

module.exports = {
  EVENT_SOLVED,
  EVENT_HINT,
  MAX_ATTEMPTS,
  bridgeConfigured,
  enqueue,
  enqueueSolve,
  enqueueHint,
  reconcile,
  drain,
  maybeDrain,
  summary,
};
