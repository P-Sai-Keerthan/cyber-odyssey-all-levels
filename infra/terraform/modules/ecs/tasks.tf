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

resource "aws_ecs_task_definition" "level1" {
  family                   = "${var.environment_name}-level1"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.level1_cpu)
  memory                   = tostring(var.level1_memory)
  execution_role_arn       = aws_iam_role.level1_execution.arn

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
