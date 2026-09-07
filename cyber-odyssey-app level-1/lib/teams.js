const crypto = require("crypto");
const { query } = require("./db");

function hashPassword(pw) {
  return crypto.createHash("sha256").update(String(pw).trim()).digest("hex");
}

function verifyPassword(pw, hash) {
  if (!pw || !hash) return false;
  const testHash = hashPassword(pw);
  const bufA = Buffer.from(testHash, "hex");
  const bufB = Buffer.from(hash, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Maps a snake_case DB row to the camelCase shape the rest of the app uses.
function toTeam(row) {
  if (!row) return null;
  const trackAAttempts = Number(row.track_a_attempts ?? row.stage1_attempts ?? 0);
  const trackBAttempts = Number(row.track_b_attempts ?? row.stage2_attempts ?? 0);
  const trackCAttempts = Number(row.track_c_attempts ?? row.final_attempts ?? 0);
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    passwordHash: row.password_hash || null,
    // Cyber Odyssey Portal squad reference, or null for a local-only team.
    // Non-secret by design — it names a squad, it does not authenticate one, and
    // the HMAC on an integration request is what establishes authenticity. Safe
    // to print in a log on either side of the bridge, which is the point of it.
    portalTeamRef: row.portal_team_ref || null,
    stage1CompletedAt: row.stage1_completed_at,
    trackbCompletedAt: row.trackb_completed_at,
    trackcCompletedAt: row.trackc_completed_at,
    stage2CompletedAt: row.stage2_completed_at,
    finalCompletedAt: row.final_completed_at,
    trackAAttempts,
    trackBAttempts,
    trackCAttempts,
    stage1Attempts: trackAAttempts,
    stage2Attempts: trackBAttempts,
    finalAttempts: trackCAttempts,
    advanced: row.advanced,
    createdAt: row.created_at,
  };
}

async function getTeamByCode(code) {
  if (!code) return null;
  const { rows } = await query("SELECT * FROM teams WHERE code = $1", [String(code).trim().toUpperCase()]);
  return toTeam(rows[0]);
}

async function getTeamByName(name) {
  if (!name) return null;
  const trimmed = String(name).trim();
  const { rows } = await query(
    "SELECT * FROM teams WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))",
    [trimmed]
  );
  return toTeam(rows[0]);
}

/**
 * Resolves a team by its Cyber Odyssey Portal reference.
 *
 * The ONLY way an integration-authenticated identity becomes a local team. Note
 * what it does not do: it never falls back to matching on name or code. A Portal
 * squad named "Crew 07" must not silently resolve to a local rehearsal team that
 * happens to share the name — that would be exactly the cross-team assignment the
 * mapping exists to prevent.
 */
async function getTeamByPortalRef(portalTeamRef) {
  if (!portalTeamRef) return null;
  const { rows } = await query("SELECT * FROM teams WHERE portal_team_ref = $1", [
    String(portalTeamRef).trim(),
  ]);
  return toTeam(rows[0]);
}

/**
 * Binds a local team row to a Portal squad, creating the row if there is none.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ONE STATEMENT
 * ---------------------------------------------------------------------------
 * Two participants from the same squad can click "Enter Level 1" in the same
 * second. "Look for a team with this reference, create one if absent" is a
 * read-then-write, and both would find nothing and both would insert. The UPSERT
 * against `uq_teams_portal_ref` makes the database arbitrate: one row is created,
 * the other request's INSERT collides and takes the existing row instead.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NAME IS NOT UPDATED ON CONFLICT
 * ---------------------------------------------------------------------------
 * `DO UPDATE SET portal_team_ref = EXCLUDED.portal_team_ref` is a no-op write
 * whose only job is to make the row visible to RETURNING. The local name is
 * deliberately left alone: a squad that renames itself in the Portal keeps its
 * local display name and, far more importantly, keeps its progress — the
 * reference is the identity, and nothing about a rename should touch it.
 *
 * The generated local code and password are placeholders. A Portal-provisioned
 * team never authenticates with them: it arrives by ticket. They exist because
 * the columns are NOT NULL / UNIQUE and every other part of the application
 * expects a team to have them.
 */
async function upsertTeamForPortalRef({ portalTeamRef, teamName }) {
  if (!portalTeamRef) return null;

  const ref = String(portalTeamRef).trim();

  const existing = await getTeamByPortalRef(ref);
  if (existing) return existing;

  const { newTeamCode } = require("./codes");
  const placeholderHash = crypto.randomBytes(32).toString("hex");

  // Bounded retry: only a local code collision can fail this, and a fresh code
  // resolves it. A portal_team_ref collision means a concurrent request won the
  // race, and the SELECT below picks up its row.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { rows } = await query(
        `INSERT INTO teams (code, name, password_hash, portal_team_ref)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (portal_team_ref) WHERE portal_team_ref IS NOT NULL DO UPDATE
           SET portal_team_ref = EXCLUDED.portal_team_ref
         RETURNING *`,
        [newTeamCode(), String(teamName || "").trim().slice(0, 128) || `Squad ${ref.slice(0, 8)}`, placeholderHash, ref]
      );
      if (rows[0]) return toTeam(rows[0]);
    } catch (err) {
      // 23505 = unique_violation. The only one reachable here is teams.code.
      if (err.code !== "23505") throw err;
      const raced = await getTeamByPortalRef(ref);
      if (raced) return raced;
    }
  }

  return getTeamByPortalRef(ref);
}

async function authenticateTeam(nameOrCode, password) {
  if (!nameOrCode) return null;
  const clean = String(nameOrCode).trim();
  let team = await getTeamByName(clean);
  if (!team) {
    team = await getTeamByCode(clean);
  }
  if (!team) return null;

  const pw = String(password || "").trim();

  // A team with no stored hash cannot be authenticated by password. FULL STOP.
  //
  // This used to fall through to `if (pw === "odyssey2026") return team;` — a
  // literal in the source that admitted anyone to any team row whose hash was
  // missing. Team names are enumerable ("Crew 01".."Crew 60") and this function
  // accepts a NAME as well as a code, so that fallback was a published password
  // for a guessable account list.
  //
  // Removing it costs nothing real: teams created through the Portal handoff get
  // a random placeholder hash (see upsertTeamForPortalRef) and never sign in by
  // password anyway, and seeded teams each carry their own hash. A row that
  // somehow has neither is a broken row, and refusing it is the right answer.
  if (!team.passwordHash) return null;

  return verifyPassword(pw, team.passwordHash) ? team : null;
}

async function listAllTeams() {
  const { rows } = await query("SELECT * FROM teams ORDER BY id ASC");
  return rows.map(toTeam);
}

async function recordStage1Attempt(code, correct) {
  const { rows } = await query(
    `UPDATE teams
       SET stage1_attempts = stage1_attempts + 1,
           stage1_completed_at = CASE WHEN $2 THEN now() ELSE stage1_completed_at END
     WHERE code = $1
     RETURNING *`,
    [code, correct]
  );
  return toTeam(rows[0]);
}

async function recordStage2Attempt(code, leaked) {
  const { rows } = await query(
    `UPDATE teams
       SET stage2_attempts = stage2_attempts + 1
     WHERE code = $1
     RETURNING *`,
    [code]
  );
  return toTeam(rows[0]);
}

async function markStage2Complete(code) {
  const { rows } = await query(
    `UPDATE teams SET stage2_completed_at = now() WHERE code = $1 AND stage2_completed_at IS NULL RETURNING *`,
    [code]
  );
  return toTeam(rows[0]);
}

async function recordFinalAttempt(code, correct) {
  const { rows } = await query(
    `UPDATE teams
       SET final_attempts = final_attempts + 1,
           final_completed_at = CASE WHEN $2 THEN now() ELSE final_completed_at END
     WHERE code = $1
     RETURNING *`,
    [code, correct]
  );
  return toTeam(rows[0]);
}

async function setAdvanced(code, advanced) {
  const { rows } = await query(
    `UPDATE teams SET advanced = $2 WHERE code = $1 RETURNING *`,
    [code, advanced]
  );
  return toTeam(rows[0]);
}

function toTrackAnswer(row) {
  if (!row) return null;
  return {
    questionCode: row.question_code,
    correct: row.correct,
    pointsAwarded: row.points_awarded,
    attempts: row.attempts,
    evidence: row.evidence,
    firstCorrectAt: row.first_correct_at,
    lastAttemptAt: row.last_attempt_at,
    hintUsed: row.hint_used,
  };
}

// Idempotent — marking a hint used twice, or on a question that doesn't
// have a row yet, both just leave hint_used = TRUE. Deliberately separate
// from recordTrackAttempt: revealing a hint isn't an "attempt" and
// shouldn't touch the attempt counter or lock state, it just flags that
// this question's eventual award (if any) should be reduced by
// HINT_PENALTY — see pages/api/trackB/submit.js, which reads this flag
// and computes the reduced point value BEFORE calling recordTrackAttempt,
// so the scoring UPSERT above stays exactly as it was for Track A.
async function recordHintUsed(teamId, questionCode) {
  const { rows } = await query(
    `INSERT INTO track_answers (team_id, question_code, hint_used, last_attempt_at)
     VALUES ($1, $2, TRUE, now())
     ON CONFLICT (team_id, question_code) DO UPDATE SET hint_used = TRUE
     RETURNING *`,
    [teamId, questionCode]
  );
  return toTrackAnswer(rows[0]);
}

// One atomic UPSERT per submission — this is the whole enforcement point
// for two rules at once, both of which have to hold even when a team's
// four members submit from four different phones within the same second:
//
//   1. Never double-award points for a question already solved.
//   2. Never allow more than `maxAttempts` real tries at a question.
//
// Postgres takes a row-level lock for the duration of an UPSERT against
// the same (team_id, question_code) key, so concurrent submissions queue
// up and each one sees the previous one's committed result rather than
// racing it — there's no window where two simultaneous requests both read
// "3 attempts used" and both proceed, because the second one physically
// can't run its UPDATE until the first one's lock releases. Every branch
// below is keyed off `track_answers.attempts >= $6` (the pre-existing,
// now-locked row) or `track_answers.correct` (already solved) — once
// either is true, the row is frozen: no more attempts counted, no more
// evidence overwritten, no more points possible, no matter how many
// further submissions arrive for that question.
async function recordTrackAttempt(teamId, questionCode, { correct, points, evidence, maxAttempts }) {
  const { rows } = await query(
    `INSERT INTO track_answers
       (team_id, question_code, correct, points_awarded, attempts, evidence, first_correct_at, last_attempt_at)
     VALUES
       ($1, $2, $3, CASE WHEN $3 THEN $4 ELSE 0 END, 1, $5, CASE WHEN $3 THEN now() ELSE NULL END, now())
     ON CONFLICT (team_id, question_code) DO UPDATE SET
       attempts = CASE
                    WHEN track_answers.correct THEN track_answers.attempts
                    WHEN track_answers.attempts >= $6 THEN track_answers.attempts
                    ELSE track_answers.attempts + 1
                  END,
       evidence = CASE
                    WHEN track_answers.correct OR track_answers.attempts >= $6 THEN track_answers.evidence
                    ELSE EXCLUDED.evidence
                  END,
       last_attempt_at = CASE
                    WHEN track_answers.correct OR track_answers.attempts >= $6 THEN track_answers.last_attempt_at
                    ELSE now()
                  END,
       correct = track_answers.correct OR (track_answers.attempts < $6 AND EXCLUDED.correct),
       points_awarded = CASE
                    WHEN track_answers.correct THEN track_answers.points_awarded
                    WHEN track_answers.attempts < $6 AND EXCLUDED.correct THEN EXCLUDED.points_awarded
                    ELSE 0
                  END,
       first_correct_at = CASE
                    WHEN track_answers.correct THEN track_answers.first_correct_at
                    WHEN track_answers.attempts < $6 AND EXCLUDED.correct THEN now()
                    ELSE track_answers.first_correct_at
                  END
     RETURNING *`,
    [teamId, questionCode, Boolean(correct), points, evidence || null, maxAttempts]
  );
  return toTrackAnswer(rows[0]);
}

async function getTrackAnswers(teamId, prefix) {
  const { rows } = await query(
    `SELECT * FROM track_answers WHERE team_id = $1 AND question_code LIKE $2 ORDER BY question_code`,
    [teamId, `${prefix}%`]
  );
  return rows.map(toTrackAnswer);
}

// team_id -> total points across a track's questions, for the admin
// standings table. A team with zero rows just doesn't appear in the map.
async function getTrackPointsByTeam(prefix) {
  const { rows } = await query(
    `SELECT team_id, COALESCE(SUM(points_awarded), 0) AS points
       FROM track_answers
      WHERE question_code LIKE $1
      GROUP BY team_id`,
    [`${prefix}%`]
  );
  const map = {};
  for (const row of rows) map[row.team_id] = Number(row.points);
  return map;
}

async function getTrackAttemptsByTeam() {
  const { rows } = await query(
    `SELECT team_id, COALESCE(SUM(attempts), 0) AS attempts
       FROM track_answers
      GROUP BY team_id`
  );
  const map = {};
  for (const row of rows) map[row.team_id] = Number(row.attempts);
  return map;
}

async function markStage1Complete(code) {
  const { rows } = await query(
    `UPDATE teams SET stage1_completed_at = now() WHERE code = $1 AND stage1_completed_at IS NULL RETURNING *`,
    [code]
  );
  return toTeam(rows[0]);
}

// Track B slots in between Track A and the still-untouched legacy
// stage2/final (Cyclops chat, Great Bow) — those stay exactly as they are
// until Track C's redesign replaces them along with the passkey/rescue
// system. This just adds the one new checkpoint in between.
async function markTrackBComplete(code) {
  const { rows } = await query(
    `UPDATE teams SET trackb_completed_at = now() WHERE code = $1 AND trackb_completed_at IS NULL RETURNING *`,
    [code]
  );
  return toTeam(rows[0]);
}

async function markTrackCComplete(code) {
  const { rows } = await query(
    `UPDATE teams SET trackc_completed_at = now() WHERE code = $1 AND trackc_completed_at IS NULL RETURNING *`,
    [code]
  );
  return toTeam(rows[0]);
}

// Testing/dev-only escape hatch, called from the admin dashboard's
// "Danger Zone" — wipes every team's progress back to a brand-new,
// never-played state without touching the teams themselves (codes and
// names survive, since those are usually already printed/handed out).
// Deliberately does NOT touch the `config` table — event_start_at is
// reset separately by the caller (pages/api/admin/reset-event.js) via
// setConfig, and puzzle answers/duration are left alone since wiping
// progress isn't the same thing as wiping the puzzles themselves.
async function incrementTrackAttempts(teamId, track) {
  const col = track === "A" ? "track_a_attempts" : (track === "B" ? "track_b_attempts" : "track_c_attempts");
  const stageCol = track === "A" ? "stage1_attempts" : (track === "B" ? "stage2_attempts" : "final_attempts");
  const { rows } = await query(
    `UPDATE teams
        SET ${col} = LEAST(3, COALESCE(${col}, 0) + 1),
            ${stageCol} = LEAST(3, COALESCE(${stageCol}, 0) + 1)
      WHERE id = $1
      RETURNING *`,
    [teamId]
  );
  const team = toTeam(rows[0]);
  return track === "A" ? team.trackAAttempts : (track === "B" ? team.trackBAttempts : team.trackCAttempts);
}

async function resetAllProgress() {
  await query(
    `UPDATE teams SET
       stage1_completed_at = NULL,
       trackb_completed_at = NULL,
       trackc_completed_at = NULL,
       stage2_completed_at = NULL,
       final_completed_at  = NULL,
       stage1_attempts = 0,
       stage2_attempts = 0,
       final_attempts  = 0,
       track_a_attempts = 0,
       track_b_attempts = 0,
       track_c_attempts = 0,
       advanced = FALSE`
  );
  await query(`DELETE FROM track_answers`);
  await query(`DELETE FROM chat_logs`);
}

async function resetTeamProgress(codeOrId) {
  let team = null;
  if (typeof codeOrId === "number" || !isNaN(Number(codeOrId))) {
    const { rows } = await query("SELECT * FROM teams WHERE id = $1", [Number(codeOrId)]);
    team = toTeam(rows[0]);
  } else {
    team = await getTeamByCode(codeOrId);
  }
  if (!team) return null;

  await query(
    `UPDATE teams SET
       stage1_completed_at = NULL,
       trackb_completed_at = NULL,
       trackc_completed_at = NULL,
       stage2_completed_at = NULL,
       final_completed_at  = NULL,
       stage1_attempts = 0,
       stage2_attempts = 0,
       final_attempts  = 0,
       track_a_attempts = 0,
       track_b_attempts = 0,
       track_c_attempts = 0,
       advanced = FALSE
     WHERE id = $1`,
    [team.id]
  );
  await query(`DELETE FROM track_answers WHERE team_id = $1`, [team.id]);
  await query(`DELETE FROM chat_logs WHERE team_id = $1`, [team.id]);
  return getTeamByCode(team.code);
}

async function getTeamTotalPoints(teamId) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(points_awarded), 0) AS total
       FROM track_answers
      WHERE team_id = $1`,
    [teamId]
  );
  return Number(rows[0]?.total || 0);
}

module.exports = {
  hashPassword,
  verifyPassword,
  getTeamByCode,
  getTeamByName,
  getTeamByPortalRef,
  upsertTeamForPortalRef,
  authenticateTeam,
  listAllTeams,
  recordStage1Attempt,
  recordStage2Attempt,
  markStage2Complete,
  markStage1Complete,
  markTrackBComplete,
  markTrackCComplete,
  recordFinalAttempt,
  setAdvanced,
  recordTrackAttempt,
  recordHintUsed,
  getTrackAnswers,
  getTrackPointsByTeam,
  getTrackAttemptsByTeam,
  incrementTrackAttempts,
  getTeamTotalPoints,
  resetTeamProgress,
  resetAllProgress,
};


