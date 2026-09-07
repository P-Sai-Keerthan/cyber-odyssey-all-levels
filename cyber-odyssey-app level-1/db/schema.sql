-- Cyber Odyssey Level 1 PostgreSQL Schema
-- Idempotent schema initialization

CREATE TABLE IF NOT EXISTS config (
  key VARCHAR(64) PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  code VARCHAR(32) UNIQUE NOT NULL,
  name VARCHAR(128),
  password_hash VARCHAR(256),
  -- Cyber Odyssey Portal squad reference. The Portal is the source of truth for
  -- event team identity; this column is the foreign key into it.
  --
  -- Nullable on purpose. Rehearsal and dry-run teams created by db/seed.js have
  -- no Portal counterpart and must keep working, and the column has to be
  -- addable to a live database without rewriting every row. A row with a NULL
  -- here is a local-only team: it can play, but nothing it scores is reported.
  --
  -- Uniqueness is enforced by a PARTIAL index (below) rather than a UNIQUE
  -- constraint here. PostgreSQL would treat the two the same — NULLs never
  -- collide either way — but an index can be added to an EXISTING table
  -- CONCURRENTLY, without holding a write lock on a live event database, and a
  -- table constraint cannot. This column has to reach a running deployment.
  portal_team_ref VARCHAR(64),
  stage1_completed_at TIMESTAMPTZ,
  trackb_completed_at TIMESTAMPTZ,
  trackc_completed_at TIMESTAMPTZ,
  stage2_completed_at TIMESTAMPTZ,
  final_completed_at TIMESTAMPTZ,
  stage1_attempts INTEGER DEFAULT 0,
  stage2_attempts INTEGER DEFAULT 0,
  final_attempts INTEGER DEFAULT 0,
  track_a_attempts INTEGER DEFAULT 0,
  track_b_attempts INTEGER DEFAULT 0,
  track_c_attempts INTEGER DEFAULT 0,
  advanced BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS track_answers (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  question_code VARCHAR(32) NOT NULL,
  correct BOOLEAN DEFAULT FALSE,
  points_awarded INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  evidence TEXT,
  hint_used BOOLEAN DEFAULT FALSE,
  first_correct_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_team_question UNIQUE (team_id, question_code)
);

CREATE TABLE IF NOT EXISTS chat_logs (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL,
  content TEXT NOT NULL,
  matched VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Durable outbox for Portal integration events.
--
-- WHY AN OUTBOX AND NOT A DIRECT POST
-- -----------------------------------
-- A 45-minute event with 60 crews has no room to notice a lost score and no way
-- to recover one after the fact. A fire-and-forget POST that fails during a
-- network blip is a score that silently never existed. Writing the intent to a
-- table first means the worst case is a delayed score, not a missing one.
--
-- IDEMPOTENCY IS ENFORCED BY THE DATABASE
-- ---------------------------------------
-- uq_outbox_subject makes enqueueing the same logical event twice impossible, so
-- the enqueue itself is safe to retry and safe to run from a reconciliation
-- sweep. event_id is generated once, at enqueue time, and reused on every
-- delivery attempt — that is what lets the Portal absorb a redelivery as an
-- idempotent success instead of awarding twice.
CREATE TABLE IF NOT EXISTS integration_outbox (
  id BIGSERIAL PRIMARY KEY,
  -- Stable idempotency key. Sent unchanged on every retry.
  event_id UUID NOT NULL UNIQUE,
  event_type VARCHAR(48) NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- The question code (A1..C3) this event is about.
  question_code VARCHAR(32) NOT NULL,
  -- Hint tier for a hint event; 0 for a solve. Part of the subject key so a
  -- solve and a hint on the same question are distinct events.
  hint_number INTEGER NOT NULL DEFAULT 0,
  -- The exact JSON body to send. Built once so a policy change cannot rewrite
  -- an event that is already queued.
  payload JSONB NOT NULL,
  -- PENDING   queued, never attempted
  -- SENDING   claimed by a drain; next_retry_at holds the lease expiry, so a
  --           drain that dies does not strand the row forever
  -- SENT      delivered and acknowledged by the Portal
  -- FAILED    a retryable failure; next_retry_at holds the backoff
  -- ABANDONED terminal. Kept, never deleted, so an operator can see what was
  --           lost and re-queue it deliberately.
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  CONSTRAINT uq_outbox_subject UNIQUE (team_id, question_code, event_type, hint_number)
);

-- Performance & Isolation Indexes
CREATE INDEX IF NOT EXISTS idx_teams_code ON teams(code);
-- At most one local team per Portal squad. Partial so the many local-only teams
-- with a NULL reference do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_portal_ref
  ON teams (portal_team_ref) WHERE portal_team_ref IS NOT NULL;
-- Drain query: due, unsent events oldest first.
CREATE INDEX IF NOT EXISTS idx_outbox_due ON integration_outbox (status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_outbox_team ON integration_outbox (team_id);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(LOWER(name));
CREATE INDEX IF NOT EXISTS idx_track_answers_team ON track_answers(team_id);
CREATE INDEX IF NOT EXISTS idx_track_answers_qcode ON track_answers(question_code);
CREATE INDEX IF NOT EXISTS idx_chat_logs_team_time ON chat_logs(team_id, created_at);
