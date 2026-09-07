resource "aws_cloudwatch_log_group" "portal" {
  name              = "/ecs/${var.environment_name}-portal"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "level1" {
  name              = "/ecs/${var.environment_name}-level1"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "outbox_drainer" {
  name              = "/ecs/${var.environment_name}-level1-outbox-drainer"
  retention_in_days = 30
}

locals {
  portal_secrets = concat(
    [
      { name = "DATABASE_URL", valueFrom = var.portal_database_url_secret_arn },
      { name = "ODYSSEY_LEVEL1_SECRET", valueFrom = var.odyssey_level1_secret_arn },
    ],
    var.odyssey_integration_secret_arn != "" ? [
      { name = "ODYSSEY_INTEGRATION_SECRET", valueFrom = var.odyssey_integration_secret_arn }
    ] : []
  )

  level1_secrets = [
    { name = "DATABASE_URL", valueFrom = var.level1_database_url_secret_arn },
    { name = "SESSION_SECRET", valueFrom = var.session_secret_arn },
    { name = "ADMIN_PASSWORD", valueFrom = var.admin_password_arn },
    { name = "ODYSSEY_LEVEL1_SECRET", valueFrom = var.odyssey_level1_secret_arn },
  ]

  outbox_drainer_secrets = [
    { name = "DATABASE_URL", valueFrom = var.level1_database_url_secret_arn },
    { name = "ODYSSEY_LEVEL1_SECRET", valueFrom = var.odyssey_level1_secret_arn },
  ]

  # Mirrors src/lib/auth/password.ts's hashPassword() exactly (scrypt,
  # 16-byte hex salt, 64-byte key, `salt:hex` format) so the app's own
  # verifyPassword() accepts what this creates. See the comment on
  # aws_ecs_task_definition.portal_seed for why this exists instead of
  # running the real seed script.
  creator_bootstrap_script = <<-EOT
    const { PrismaClient } = require('@prisma/client');
    const { scrypt, randomBytes } = require('crypto');
    const { promisify } = require('util');
    const scryptAsync = promisify(scrypt);

    async function hashPassword(password) {
      const salt = randomBytes(16).toString('hex');
      const derivedKey = await scryptAsync(password, salt, 64);
      return salt + ':' + derivedKey.toString('hex');
    }

    async function main() {
      const email = (process.env.CREATOR_EMAIL || '').trim().toLowerCase();
      const username = (process.env.CREATOR_USERNAME || 'event_creator').trim();
      const password = process.env.CREATOR_PASSWORD || '';
      if (!email || !password) {
        console.error('CREATOR_EMAIL and CREATOR_PASSWORD must both be set.');
        process.exit(1);
      }
      if (password.length < 12) {
        console.error('CREATOR_PASSWORD must be at least 12 characters.');
        process.exit(1);
      }
      const passwordHash = await hashPassword(password);
      const prisma = new PrismaClient();
      await prisma.user.upsert({
        where: { email },
        update: { username, role: 'CREATOR', status: 'ACTIVE', passwordHash },
        create: { email, username, passwordHash, role: 'CREATOR', status: 'ACTIVE' },
      });
      await prisma.portalSetting.upsert({
        where: { id: 'default' },
        update: {},
        create: { id: 'default', isOnline: true },
      });
      console.log('Creator account ready:', email);
      await prisma.$disconnect();
    }

    main().catch((e) => { console.error(e); process.exit(1); });
  EOT
}

resource "aws_ecs_task_definition" "portal" {
  family                   = "${var.environment_name}-portal"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.portal_cpu)
  memory                   = tostring(var.portal_memory)
  execution_role_arn       = aws_iam_role.portal_execution.arn
  task_role_arn            = aws_iam_role.portal_task.arn

  container_definitions = jsonencode([
    {
      name      = "portal"
      image     = "${aws_ecr_repository.portal.repository_url}:${var.portal_image_tag}"
      essential = true
      portMappings = [{ containerPort = 3002, protocol = "tcp" }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        # crypto.scrypt is CPU-bound on the libuv threadpool (default 4
        # threads regardless of core count) — RUNBOOK.md measured this as a
        # 2.4x login-throughput improvement for a one-line env change.
        { name = "UV_THREADPOOL_SIZE", value = "16" },
        { name = "LEVEL1_CHALLENGE_URL", value = "https://${var.level1_domain_name}" },
        { name = "S3_BUCKET", value = var.uploads_bucket_name },
        { name = "AWS_REGION", value = var.aws_region },
      ]
      secrets = local.portal_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.portal.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "portal"
        }
      }
    }
  ])
}

# One-off task that creates/rotates the Creator account. A SEPARATE task
# definition from the running service, specifically so CREATOR_PASSWORD can
# go through the same `secrets` (Secrets Manager) mechanism as everything
# else here — `aws ecs run-task --overrides` has no equivalent of a secrets
# override, only plaintext `environment` overrides, which are stored in the
# task's own describable metadata indefinitely. A plaintext password there
# would be exactly the kind of exposure this module otherwise avoids
# everywhere else.
#
# This does NOT run `prisma/seed.ts` (the full dev/demo fixture — 10
# hardcoded pre-registered test emails, sample announcements, placeholder
# Level 2 resource files). Two independent reasons:
#   1. `prisma db seed` needs tsx, which RUNBOOK.md explains is deliberately
#      NOT in the runtime image.
#   2. seed.ts's own import of `../src/lib/auth/password` can't resolve
#      either: `src/` isn't copied into the image at all (Next's standalone
#      output only traces what the SERVER needs, not arbitrary scripts).
# RUNBOOK.md's Docker section already runs the real `npm run db:seed` from a
# full checkout against the container's exposed DB port for exactly this
# reason. On AWS, that means a full checkout with real network access to
# RDS (which is deliberately not internet-reachable) — a separate, later
# step, not this one.
#
# What this DOES do is hand-replicate the one part of seed.ts that's
# actually load-bearing for a working deployment: without a Creator account
# nobody can sign in to administer the portal at all. It reimplements
# `hashPassword` from src/lib/auth/password.ts (scrypt, 16-byte salt,
# 64-byte key, `salt:hex` format) inline, using only what the runtime image
# already has: @prisma/client and Node's built-in crypto/util.
resource "aws_ecs_task_definition" "portal_seed" {
  family                   = "${var.environment_name}-portal-seed"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.portal_execution.arn
  task_role_arn            = aws_iam_role.portal_task.arn

  container_definitions = jsonencode([
    {
      name      = "portal-seed"
      image     = "${aws_ecr_repository.portal.repository_url}:${var.portal_image_tag}"
      essential = true
      command   = ["node", "-e", local.creator_bootstrap_script]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "CREATOR_EMAIL", value = var.creator_email },
        { name = "CREATOR_USERNAME", value = var.creator_username },
      ]
      secrets = concat(local.portal_secrets, [
        { name = "CREATOR_PASSWORD", valueFrom = var.creator_password_arn },
      ])
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.portal.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "seed"
        }
      }
    }
  ])
}

resource "aws_ecs_task_definition" "level1" {
  family                   = "${var.environment_name}-level1"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.level1_cpu)
  memory                   = tostring(var.level1_memory)
  execution_role_arn       = aws_iam_role.level1_execution.arn
  task_role_arn            = aws_iam_role.level1_task.arn

  container_definitions = jsonencode([
    {
      name      = "level1"
      image     = "${aws_ecr_repository.level1.repository_url}:${var.level1_image_tag}"
      essential = true
      portMappings = [{ containerPort = 3001, protocol = "tcp" }]
      environment = [
        { name = "NODE_ENV", value = "production" },
        # Fargate has no equivalent of docker-compose's internal service DNS
        # name without adding ECS Service Connect / Cloud Map. At this scale,
        # routing Level 1's server-to-server calls back through the same
        # public ALB endpoint is simpler than standing up service discovery
        # for one internal call path — see RUNBOOK.md's AWS section.
        { name = "PORTAL_BASE_URL", value = "https://${var.portal_domain_name}" },
        # The ALB always sets/overwrites X-Forwarded-For with the real client
        # address, so — unlike the bare-VM case this variable's own comment
        # warns about — trusting it here is correct, not a spoofing hole.
        # Leaving this at the default (unset) would key every login attempt
        # on the ALB's own address and silently defeat the throttler.
        { name = "TRUST_PROXY", value = "1" },
      ]
      secrets = local.level1_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.level1.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "level1"
        }
      }
    }
  ])
}

# Same image, different command: the long-running outbox drain loop instead
# of the Next.js server. See RUNBOOK.md / lib/outbox.js — safe under
# concurrent invocation (FOR UPDATE SKIP LOCKED + a 60s claim lease), but
# desiredCount is fixed at 1 in services.tf; there is no reason to run more.
resource "aws_ecs_task_definition" "outbox_drainer" {
  family                   = "${var.environment_name}-level1-outbox-drainer"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.outbox_drainer_cpu)
  memory                   = tostring(var.outbox_drainer_memory)
  execution_role_arn       = aws_iam_role.level1_execution.arn

  container_definitions = jsonencode([
    {
      name      = "outbox-drainer"
      image     = "${aws_ecr_repository.level1.repository_url}:${var.level1_image_tag}"
      essential = true
      command   = ["node", "scripts/drain-outbox.js", "--watch"]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORTAL_BASE_URL", value = "https://${var.portal_domain_name}" },
      ]
      secrets = local.outbox_drainer_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.outbox_drainer.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "outbox"
        }
      }
    }
  ])
}
