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

---

## AWS deployment (ECS Fargate)

Terraform for this lives under `infra/terraform/`. It provisions: a VPC (2
public + 2 private subnets across 2 AZs), an ALB with host-based routing to
two target groups, ECS Fargate running three services (Portal, Level 1, and
the outbox drainer as its own service), one RDS PostgreSQL instance holding
both databases, an S3 bucket for uploads, and Secrets Manager entries for
every credential this document's "Required secrets" section lists. This is
an alternative to the Docker Compose stack above, not a replacement — Compose
remains the right tool for local development and a single-host event.

**Why not just run docker-compose.yml on one EC2 instance?** You can — that
is a legitimate, simpler option for 120-150 people, and RUNBOOK's own load
figures (300 concurrent authenticated page loads, single instance: all waves
pass) comfortably cover that scale. ECS Fargate is worth the extra setup if
you want the load balancer's health-check-driven restarts, want to scale the
Portal to 2+ instances without hand-managing a reverse proxy, or don't want
to patch an EC2 host's OS yourself. Both are documented; pick one.

### What changed in the app to make this safe

Three things about the Compose model don't survive being split across
independent Fargate tasks with no shared disk — see the code changes in
`src/lib/storage/object-store.ts` and its callers:

1. **Uploads move to S3.** Each Fargate task has its own ephemeral
   filesystem; a submission file written by one Portal task would be
   invisible to a request served by another. Setting `S3_BUCKET` switches
   `saveSubmissionFile`, `discardSubmissionFiles`, `saveLevelResource`,
   `removeLevelResource` and all five file-download routes from local disk to
   S3. Unset (local dev, the test suite), behavior is byte-for-byte what it
   was before — this is additive, not a rewrite.
2. **Level 1 stays at exactly one task.** Its login throttler
   (`lib/rateLimitStore.js`) is documented in its own file header as
   per-process, in-memory state. A second replica would give every client
   roughly 2x its intended attempt allowance. The Terraform fixes Level 1's
   `desiredCount` at 1 with no autoscaling for exactly this reason. If Level
   1 ever needs to scale, that file already specifies the Postgres-backed
   store schema to implement first.
3. **The outbox drainer is its own service**, not bundled into Level 1's
   container command. `scripts/drain-outbox.js --watch` is a long-running
   poll loop, not a request handler, and Fargate expects one process per
   task. It runs from the same Level 1 image with the command overridden.

### If your domain is NOT on Route 53

`route53_zone_id` stays `""`, so Terraform won't touch DNS or issue a
certificate for you. Get the certificate and the DNS records yourself, in
this order — the certificate must exist and be **ISSUED** before
`terraform apply`, because the ALB listener needs a real ARN, not a
placeholder:

```bash
# 1. Request a certificate covering both hostnames, DNS-validated.
aws acm request-certificate \
  --domain-name odyssey.example.org \
  --subject-alternative-names level1.odyssey.example.org \
  --validation-method DNS \
  --region <region>
# Note the CertificateArn it returns.

# 2. Get the validation CNAME records ACM wants you to create.
aws acm describe-certificate --certificate-arn <arn-from-step-1> --region <region> \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'
# Prints one {Name, Type, Value} pair per hostname (two, here).

# 3. Add BOTH as CNAME records at your registrar (GoDaddy, Namecheap, etc.) —
#    not at AWS. This is the one manual DNS step Route 53 would have skipped.

# 4. Wait for validation (can take a few minutes to ~30):
aws acm wait certificate-validated --certificate-arn <arn-from-step-1> --region <region>
```

Once that returns, you have a real `acm_certificate_arn` for `terraform.tfvars`.

**After `terraform apply` succeeds**, take the `alb_dns_name` output and add
two more CNAME records at the same registrar — this is the step that
actually sends traffic to the ALB:

```
odyssey.example.org           CNAME   <alb_dns_name>
level1.odyssey.example.org    CNAME   <alb_dns_name>
```

(A bare apex domain, e.g. `example.org` with no subdomain, can't use CNAME at
most registrars — this is why both hostnames here are subdomains.) DNS
propagation is typically minutes, occasionally longer depending on the
registrar and any previous record's TTL.

### First-time deploy order

```bash
cd infra/terraform

# 1. Create the state bucket + lock table by hand (see backend.tf), then:
terraform init

# 2. Provide the required variables — see variables.tf for the full list.
#    At minimum: availability_zones, portal_domain_name, level1_domain_name,
#    creator_email, and acm_certificate_arn (from the ACM walkthrough above,
#    since route53_zone_id is blank without a Route 53 domain).
terraform apply

# 3. Build and push both images. NEXT_PUBLIC_PORTAL_BASE_URL is a Level 1
#    BUILD argument (inlined into the browser bundle) — get the domain right
#    here or it needs a rebuild, not a restart, to fix.
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com

docker build -t <portal_ecr_repository_url>:latest ACN_CYBER-ODYSSEY_V2
docker push <portal_ecr_repository_url>:latest

docker build -t <level1_ecr_repository_url>:latest \
  --build-arg NEXT_PUBLIC_PORTAL_BASE_URL=https://<portal_domain_name> \
  "cyber-odyssey-app level-1"
docker push <level1_ecr_repository_url>:latest

# 4. Force both services to pick up the images just pushed (they were
#    created against an empty repository, since the image can't exist before
#    step 3).
aws ecs update-service --cluster <cluster_name> --service <env>-portal --force-new-deployment
aws ecs update-service --cluster <cluster_name> --service <env>-level1 --force-new-deployment

# 5. Run migrations and seed the Portal as one-off tasks (same task
#    definition, overridden command — same commands this document's Docker
#    section already uses, just launched via run-task instead of a shell):
aws ecs run-task --cluster <cluster_name> --launch-type FARGATE \
  --task-definition <env>-portal \
  --network-configuration "awsvpcConfiguration={subnets=[<private_subnet_ids>],securityGroups=[<ecs_security_group_id>],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"portal","command":["node","node_modules/prisma/build/index.js","migrate","deploy"]}]}'

# CREATOR_PASSWORD for this comes from Secrets Manager, not a value you choose:
aws secretsmanager get-secret-value --secret-id <env>/creator-password --query SecretString --output text
# Then run db:seed the same way, with that value and CREATOR_EMAIL passed as
# a plaintext environment override (CREATOR_PASSWORD is read only by this
# one-off command, never by the running service).
```

### Level 1's team-codes.csv

`npm run db:seed` on Level 1 regenerates every crew's password and writes
`team-codes.csv` to the container's local disk — deliberately not S3, since
it's a one-time operator artifact, not application state. On Fargate that
disk disappears with the task. Retrieve the file **immediately** after
running the seed task, before the task stops:

```bash
aws ecs execute-command --cluster <cluster_name> --task <task_arn> \
  --container level1 --interactive --command "cat team-codes.csv"
```

(Requires `enableExecuteCommand` on the task/service and the SSM Session
Manager plugin locally.) Copy the output out immediately — there is no
second chance once the task stops.

### Verifying capacity on the real infrastructure

RUNBOOK's load figures above are real, but they were run against a bare
process on localhost, not through an ALB, TLS termination and Fargate's own
network path. Before opening this to participants:

```bash
# Point the existing scripts at the live ALB URL instead of localhost.
PORTAL_BASE_URL=https://<portal_domain_name> npm run load:scenarios
PORTAL_BASE_URL=https://<portal_domain_name> npm run load:http
```

and run Level 1's `npm run test:scale` the same way. Also do a manual
browser smoke test of Creator → Admin → Evaluator → Participant end to end —
neither this Terraform nor the existing test suite has ever driven a real
browser against this app (see `docs/production-readiness.md` §17).

### Operational notes specific to this infrastructure

- **RDS is not internet-reachable, by design.** The second database
  (`odyssey_portal`) is bootstrapped by a one-off ECS task inside the VPC
  (`modules/database/main.tf`), not by a `psql` client on your laptop —
  avoids ever putting a security-group hole in front of the database for a
  one-time setup step.
- **Divide the connection pool as documented above.** The Portal's
  `DATABASE_URL` secret is generated with `connection_limit=40`; at
  `portal_desired_count = 2` that's 80 connections, well inside a
  `db.t4g.medium`'s ~450 `max_connections`, with headroom for Level 1, the
  outbox drainer, and manual `psql` access during the event.
- **`TRUST_PROXY=1` is set on Level 1's task definition, deliberately.** The
  app's own comment on that variable warns against setting it unless a real
  proxy in front overwrites `X-Forwarded-For` — the ALB does exactly that, so
  this is the correct setting here, not an exception to the warning. Leaving
  it unset behind the ALB would key the login throttler on the ALB's own
  address for every participant, which silently defeats it.
- **Level 1's server-to-server calls to the Portal go over the public ALB
  URL**, not an internal service name — Fargate has no equivalent of
  Compose's internal DNS without adding ECS Service Connect or Cloud Map.
  Fine at this scale; worth revisiting if traffic between the two grows.
