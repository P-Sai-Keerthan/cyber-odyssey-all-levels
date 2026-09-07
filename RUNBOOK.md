# ACN Cyber Odyssey — operator runbook

Two independent applications. They are **not** a monorepo: separate `package.json`,
separate lockfiles, separate databases, separate ports, separate release cadence.

| Application | Path | Port | Database |
|---|---|---|---|
| Main Portal | `ACN_CYBER-ODYSSEY_V2` | **3002** | PostgreSQL (`odyssey_portal`) |
| Level 1 | `cyber-odyssey-app level-1` | **3001** | PostgreSQL |

Ports are set in each `package.json` (`next dev -p …` / `next start -p …`). Do not
change them ad hoc to dodge `EADDRINUSE` — find and stop the stale process instead:

```bash
netstat -ano | grep ":3002 .*LISTENING"
```

---

## Build and start order — READ THIS ONE

**Never run `npm run build` while `npm start` is serving the same application.**

`next start` indexes `.next` when it boots. A build that replaces those files
underneath it leaves the running server answering **404** for assets that are
present on disk, and Next serves those 404s as `text/plain`. The browser then
reports:

```
Refused to execute script from '…/_next/static/<build-id>/_buildManifest.js'
because its MIME type ('text/plain') is not executable
Refused to apply style from '…' because its MIME type ('text/html') is not a
supported stylesheet MIME type
```

Nothing is wrong with the code and nothing is wrong with the content types — the
process is simply serving a build it can no longer see. It was reproduced and
confirmed during the pre-deployment audit: the manifests existed on disk with the
matching build id, returned 404 from the running server, and returned **200
`application/javascript`** immediately after a restart.

Correct order, every time:

```bash
# 1. stop the server   2. build   3. start
npm run build && npm start
```

Also do not pipe a build into `head` or `grep`. Closing the pipe early can kill
the build mid-write and leave a truncated manifest, which fails at startup with
`SyntaxError: Unexpected end of JSON input`. Redirect to a file instead.

---

## Local start, from cold

```bash
# Level 1's database must be reachable first.
# Portal — PostgreSQL. Tests use a SEPARATE database (.env.test) because
# several suites truncate tables; never point them at a live event database.
cd "ACN_CYBER-ODYSSEY_V2"
npx prisma migrate deploy
npm run seed:local-test        # test fixture: 5 squads, all roles
npm run build && npm start     # -> http://localhost:3002

# Level 1
cd "../cyber-odyssey-app level-1"
npm run db:init                # applies db/schema.sql (idempotent)
npm run db:seed                # writes team-codes.csv — see the warning below
npm run build && npm start     # -> http://localhost:3001
```

`npm run db:seed` regenerates every crew's password and rewrites
`team-codes.csv`. It is a deliberate pre-event action, never something to run
mid-event.

---

## Resetting the test environment

```bash
cd "ACN_CYBER-ODYSSEY_V2"
npm run seed:local-test   # rebuilds the 5 ACN Test Teams and all role accounts
npm run db:doctor         # integrity check; expect 0 CRITICAL/HIGH
```

Test accounts use `@odyssey.local` addresses so they are trivially separable from
real participants. `TEST_PASSWORD` in `scripts/seed-local-testing.ts` is a
fixture credential and must never be reachable from a production database — seed
production with `npm run db:seed` (which reads `CREATOR_*` from the environment)
and never with `seed:local-test`.

**Note:** the Portal test suites share one database and delete rows they do not
own. Running `npx vitest run` wipes the local fixture; re-seed afterwards.

---

## Event-day state

| Level | Expected at kickoff |
|---|---|
| 1 | LIVE, 60 min, **100 PTS** |
| 2 | LIVE, 120 min, **1000 PTS** |
| 3 | **LOCKED** until the operations desk opens it |

### Level 3 configuration — set BEFORE the level opens

Three values are Creator-configured and ship unset, so a participant opening
Level 3 before they are set sees an honest "not yet assigned" panel rather than a
stale address or a dead download. All three live at
**Creator → Level 3 Resources** (`/creator/resources/level-3`):

| Value | Where it is stored | Participant sees it in |
|---|---|---|
| Target IP address | `Level3Config.targetIp` | Mission Brief → Target Context |
| Sample report (PDF) | `LevelResource` (level 3, `SAMPLE_REPORT`) | Final Submission → Sample Report |
| Track 2 release | `Level3Config.track2Released` | How Scoring Works → Available Score |

The address is IPv4 only, validated server-side, and is a **display value**: the
portal never connects to it, resolves it, or forwards anything to it.

**Track 2 is CUMULATIVE.** Releasing it *replaces* the Track 1 ceiling; it is not
added to it. The stored pair is guarded so `track2Points` can never be below
`track1Points`, which is what makes double-counting impossible to express.

Level 3's point ceiling is therefore:

```
  before Track 2:  3,500 + 200 (report) + 200 (response) = 3,900 PTS
  after  Track 2:  6,500 + 200 (report) + 200 (response) = 6,900 PTS
```

The 200/200 come from the two ACTIVE Level 3 evaluation criteria, keyed
`LEVEL3_REPORT` and `LEVEL3_RESPONSE`, edited at **Admin → Evaluations**. The
evaluator's maximum is the sum of the same rows, so the figure a participant is
shown and the figure an evaluator scores against cannot drift apart.

Level state is authoritative in the Portal database and is set from
Admin → Levels. Level 1 keeps its own separate event clock, started from the
Level 1 admin console.

Run the outbox drainer for the whole event so a quiet period cannot delay score
delivery:

```bash
cd "cyber-odyssey-app level-1" && npm run outbox:watch
```

---

## Scaling the Portal

The Portal's render ceiling is a **per-process** limit. Next.js renders Server
Components on one JavaScript thread, so simultaneous page loads queue behind one
event loop however fast the database answers.

Measured on this codebase, 300 concurrent authenticated page loads:

| Setup | Wave 1 p50 | Throughput | All waves |
|---|---|---|---|
| 1 instance | 5076 ms | 59 req/s | pass |
| 2 instances behind a proxy | 3178 ms | 90 req/s | pass |
| 3 instances behind a proxy | 2604 ms (p95 4577) | 64 req/s | pass |

Deduplicating every repeated query on the render path moved Wave 1 by **0%**
while cutting the API and write waves by 28-54% — which is what identifies the
page-render cost as CPU rather than database work.

**Two instances is the measured sweet spot on the test machine.** Three improved
the median but widened the tail, on hardware also running PostgreSQL and the load
generator; a dedicated server may do better.

### Running replicas

```bash
npx next start -p 3102 &
npx next start -p 3103 &
node scripts/multi-instance-proxy.mjs --port 3002 --targets 3102,3103
```

`scripts/multi-instance-proxy.mjs` is a **development/test** round-robin proxy —
no TLS, no health checks, no retries. A real deployment uses nginx, Caddy or a
cloud load balancer.

Replicas are safe because per-request state lives in PostgreSQL, not in the
process: sessions in `Session`, level state in `LevelState`, scores recomputed
in-transaction under row locks, idempotency on unique indexes. Verified: score
integrity stayed 100/100 squads across two and three instances.

**Two things to get right before running replicas.**

1. **Divide the connection pool.** `connection_limit=20` is PER INSTANCE. Three
   instances opened 81 backends against a server whose `max_connections` is 200,
   and Level 1 needs its own. Set `connection_limit` to roughly
   `(max_connections - headroom) / instances`.

2. **Level 1's login throttler is per-process.** Behind N replicas each client
   gets roughly N times its intended allowance. Level 1 is a single process
   today; if that changes, the counters must move to shared storage first — see
   `lib/rateLimitStore.js`, which exists for exactly this and carries the
   PostgreSQL implementation notes.

---

## Required secrets

Neither application ships a default for any of these. Missing values fail closed.

**Portal** (`.env`) — `DATABASE_URL` (keep the pool parameters),
`CREATOR_EMAIL` / `CREATOR_PASSWORD` / `CREATOR_USERNAME`,
`ODYSSEY_LEVEL1_SECRET`, `LEVEL1_CHALLENGE_URL`, and — only if Level 3 runs —
`ODYSSEY_INTEGRATION_SECRET` and `LEVEL3_CHALLENGE_URL`.

**Level 1** (`.env`) — `DATABASE_URL`, `SESSION_SECRET` (min 24 chars; signs every
team and admin cookie), `ADMIN_PASSWORD`, `PORTAL_BASE_URL`,
`ODYSSEY_LEVEL1_SECRET`, `NEXT_PUBLIC_PORTAL_BASE_URL`.

`ODYSSEY_LEVEL1_SECRET` must be **identical** on both sides. If it differs, every
ticket redemption and every score callback fails with a 401 that looks like a bug
in the bridge.

Generate any secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## Docker

```bash
cp .env.example .env      # fill in every value; .env is git-ignored
docker compose up -d --build
```

### The name `.env` is not optional

`docker compose` loads a file called **`.env`** from the directory holding
`docker-compose.yml`, automatically. Any other name is read only when passed
explicitly with `--env-file`. Forgetting that flag produces:

```
required variable POSTGRES_PASSWORD is missing a value
required variable ADMIN_PASSWORD is missing a value
required variable SESSION_SECRET is missing a value
```

Nothing is misconfigured when that happens — Compose simply never read the file.
Name it `.env` and no flag is needed. Check before starting anything:

```bash
docker compose config >/dev/null && echo OK
```

That resolves every `${VAR:?...}` and fails loudly on anything missing, without
building or starting a container.

Generate each secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`base64url` matters for `POSTGRES_PASSWORD`: it is interpolated into
`DATABASE_URL`, and a password containing `@`, `/`, `:` or `#` breaks that URL in
a way that looks nothing like a bad password.

### Running the stack beside a local dev server

The compose file publishes host ports from `PORTAL_PORT`, `LEVEL1_PORT` and
`POSTGRES_PORT`. If 3001/3002/5432 are already taken by a local `npm start` and
a local PostgreSQL, remap the host side only — and remap `PUBLIC_PORTAL_URL` /
`PUBLIC_LEVEL1_URL` to match, or "Enter Level 1" sends participants to the wrong
port:

```
PORTAL_PORT=4002
LEVEL1_PORT=4001
POSTGRES_PORT=55432
PUBLIC_PORTAL_URL=http://localhost:4002
PUBLIC_LEVEL1_URL=http://localhost:4001
```

### Bootstrapping the first creator

`prisma db seed` runs `tsx`, which is a devDependency and is deliberately **not**
in the runtime image — production images should not ship a toolchain. So the
one-off bootstrap runs from a workstation that has the repository, against the
container's database (the Postgres port is published on loopback):

```bash
cd ACN_CYBER-ODYSSEY_V2
DATABASE_URL="postgresql://odyssey:PASSWORD@localhost:5432/odyssey_portal?schema=public" CREATOR_EMAIL=... CREATOR_PASSWORD=... CREATOR_USERNAME=... npm run db:seed
```

Schema migrations do **not** need this — the Portal container applies them itself
on every start with `prisma migrate deploy`, which only ever replays committed
migrations and is safe to re-run.

The one thing to get right is that there are **two address spaces**:

- `PORTAL_BASE_URL=http://portal:3002` — server-to-server, resolves only inside
  the Docker network.
- `PUBLIC_PORTAL_URL` / `PUBLIC_LEVEL1_URL` — what a participant's browser types.
  A compose service name here is a link that resolves on the server and nowhere
  a participant can reach.

`NEXT_PUBLIC_PORTAL_BASE_URL` is inlined into Level 1's browser bundle at build
time, so changing it needs a rebuild, not a restart.
