resource "aws_db_subnet_group" "this" {
  name       = "${var.environment_name}-db"
  subnet_ids = var.private_subnet_ids
  tags       = { Name = "${var.environment_name}-db-subnet-group" }
}

# One instance, two databases — matching docker-compose.yml's model
# ("one server, two databases... they are the same operational unit, backed
# up and restored together"). RDS creates `level1_db_name` at instance
# creation; the second database is bootstrapped below once the instance is
# reachable.
resource "aws_db_instance" "this" {
  identifier     = "${var.environment_name}-db"
  engine         = "postgres"
  engine_version = "16"

  instance_class        = var.instance_class
  allocated_storage     = var.allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true
  db_name               = var.level1_db_name
  username              = var.master_username
  password              = var.master_password
  port                  = 5432
  db_subnet_group_name  = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.security_group_id]

  multi_az                = var.multi_az
  backup_retention_period = var.backup_retention_days
  backup_window           = "03:00-04:00"
  maintenance_window      = "mon:04:30-mon:05:30"

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.environment_name}-db-final"
  copy_tags_to_snapshot     = true

  # Console/CLI access for pre-event backup verification and the restore
  # rehearsal RUNBOOK.md already calls for (adapted to RDS — see the AWS
  # RUNBOOK section).
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  tags = { Name = "${var.environment_name}-db" }
}

# ---------------------------------------------------------------------------
# Bootstraps the Portal's database on the same instance.
#
# RDS stays fully private — no public IP, no internet-facing security group
# hole for a `psql` client on some operator's laptop to reach it. Instead this
# runs as a one-off ECS Fargate task, in the same private subnets and the same
# security group as the real application tasks (already allowed to reach RDS
# on 5432), using the public `postgres:16-alpine` image purely for its `psql`
# binary. The master password is read from Secrets Manager at container start,
# never embedded in the task definition.
#
# Idempotent: safe to re-run (e.g. on a `terraform apply` after the database
# already exists) because it checks pg_database first.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "db_bootstrap" {
  name              = "/ecs/${var.environment_name}-db-bootstrap"
  retention_in_days = 14
}

resource "aws_iam_role" "db_bootstrap_execution" {
  name = "${var.environment_name}-db-bootstrap-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "db_bootstrap_execution" {
  role       = aws_iam_role.db_bootstrap_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Execution role also needs to read the one secret it injects (the managed
# policy above only covers ECR + CloudWatch Logs, not Secrets Manager).
resource "aws_iam_role_policy" "db_bootstrap_secret_read" {
  name = "${var.environment_name}-db-bootstrap-secret-read"
  role = aws_iam_role.db_bootstrap_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [var.master_password_secret_arn]
    }]
  })
}

resource "aws_ecs_task_definition" "db_bootstrap" {
  family                   = "${var.environment_name}-db-bootstrap"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.db_bootstrap_execution.arn

  container_definitions = jsonencode([
    {
      name  = "bootstrap"
      image = "postgres:16-alpine"
      essential = true
      command = [
        "sh", "-c",
        <<-EOT
        psql -h ${aws_db_instance.this.address} -p ${aws_db_instance.this.port} \
          -U ${var.master_username} -d ${var.level1_db_name} -tAc \
          "SELECT 1 FROM pg_database WHERE datname='${var.portal_db_name}'" | grep -q 1 \
          && echo 'already exists' \
          || psql -h ${aws_db_instance.this.address} -p ${aws_db_instance.this.port} \
               -U ${var.master_username} -d ${var.level1_db_name} \
               -c "CREATE DATABASE ${var.portal_db_name};"
        EOT
      ]
      secrets = [
        { name = "PGPASSWORD", valueFrom = var.master_password_secret_arn }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.db_bootstrap.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "bootstrap"
        }
      }
    }
  ])
}

# Runs the task and blocks the apply until it finishes, so a subsequent
# `terraform apply` of the ECS module never races the database's existence.
# Requires the AWS CLI on the machine running `terraform apply` — the same
# requirement RUNBOOK.md's AWS section already has for image pushes and the
# migration/seed one-off tasks.
resource "null_resource" "portal_database" {
  triggers = {
    task_definition_arn = aws_ecs_task_definition.db_bootstrap.arn
  }

  # PowerShell, not a POSIX shell: Terraform here is a native Windows binary
  # spawning subprocesses directly, so a "/bin/sh" interpreter path doesn't
  # resolve the way it would if something were already inside a POSIX shell.
  # If you're applying this from Linux/macOS/CI instead, swap this block for
  # an `interpreter = ["bash", "-c"]` version of the same three AWS CLI
  # calls (run-task, wait tasks-stopped, describe-tasks).
  provisioner "local-exec" {
    interpreter = ["PowerShell", "-NoProfile", "-Command"]
    command     = <<-EOT
      $ErrorActionPreference = "Stop"
      if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
        $env:PATH += ";C:\Users\vivek\AppData\Local\Programs\Amazon\AWSCLIV2"
      }
      $taskArn = aws ecs run-task `
        --cluster ${var.ecs_cluster_arn} `
        --launch-type FARGATE `
        --task-definition ${aws_ecs_task_definition.db_bootstrap.arn} `
        --network-configuration 'awsvpcConfiguration={subnets=[${join(",", var.private_subnet_ids)}],securityGroups=[${var.ecs_security_group_id}],assignPublicIp=DISABLED}' `
        --query "tasks[0].taskArn" --output text
      if (-not $taskArn -or $taskArn -eq "None") {
        Write-Error "run-task did not return a task ARN"
        exit 1
      }
      aws ecs wait tasks-stopped --cluster ${var.ecs_cluster_arn} --tasks $taskArn
      $exitCode = aws ecs describe-tasks --cluster ${var.ecs_cluster_arn} --tasks $taskArn `
        --query "tasks[0].containers[0].exitCode" --output text
      if ($exitCode -ne "0") {
        Write-Host "Portal database bootstrap task failed (exit $exitCode). Check CloudWatch Logs group ${aws_cloudwatch_log_group.db_bootstrap.name}."
        exit 1
      }
    EOT
  }

  depends_on = [aws_db_instance.this, aws_iam_role_policy.db_bootstrap_secret_read]
}
