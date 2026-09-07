data "aws_iam_policy_document" "ecs_assume" {
  statement {
    effect    = "Allow"
    actions   = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# ---------------------------------------------------------------------------
# Portal — execution role (pulls the image, reads its secrets, writes logs)
# and task role (what the running app uses — S3 for uploads).
# ---------------------------------------------------------------------------

resource "aws_iam_role" "portal_execution" {
  name               = "${var.environment_name}-portal-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "portal_execution_base" {
  role       = aws_iam_role.portal_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "portal_execution_secrets" {
  statement {
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = compact([
      var.portal_database_url_secret_arn,
      var.odyssey_level1_secret_arn,
      var.odyssey_integration_secret_arn,
    ])
  }
}

resource "aws_iam_role_policy" "portal_execution_secrets" {
  name   = "${var.environment_name}-portal-exec-secrets"
  role   = aws_iam_role.portal_execution.id
  policy = data.aws_iam_policy_document.portal_execution_secrets.json
}

resource "aws_iam_role" "portal_task" {
  name               = "${var.environment_name}-portal-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "portal_task_s3" {
  role       = aws_iam_role.portal_task.name
  policy_arn = var.uploads_access_policy_arn
}

# ---------------------------------------------------------------------------
# Level 1 — shared by the web service and the outbox-drainer service, since
# the drainer's secret needs are a strict subset of the web service's.
# ---------------------------------------------------------------------------

# Only the web service gets this — needed for `aws ecs execute-command`
# (retrieving team-codes.csv, see RUNBOOK.md), which the outbox drainer has
# no reason to support. Not "an AWS API the app calls" in the usual sense;
# the ECS Exec agent inside the task assumes this role to open its SSM
# channel, independent of anything Level 1's own code does.
resource "aws_iam_role" "level1_task" {
  name               = "${var.environment_name}-level1-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "level1_task_exec" {
  name = "${var.environment_name}-level1-task-exec"
  role = aws_iam_role.level1_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel",
      ]
      Resource = "*"
    }]
  })
}

resource "aws_iam_role" "level1_execution" {
  name               = "${var.environment_name}-level1-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "level1_execution_base" {
  role       = aws_iam_role.level1_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "level1_execution_secrets" {
  statement {
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      var.level1_database_url_secret_arn,
      var.session_secret_arn,
      var.admin_password_arn,
      var.odyssey_level1_secret_arn,
    ]
  }
}

resource "aws_iam_role_policy" "level1_execution_secrets" {
  name   = "${var.environment_name}-level1-exec-secrets"
  role   = aws_iam_role.level1_execution.id
  policy = data.aws_iam_policy_document.level1_execution_secrets.json
}

# ---------------------------------------------------------------------------
# One-off task (migrations, db:seed) — reuses the Portal's execution role
# plus the Creator bootstrap secret, which the running service never reads.
# ---------------------------------------------------------------------------

resource "aws_iam_role_policy" "portal_execution_creator_secret" {
  name = "${var.environment_name}-portal-exec-creator-secret"
  role = aws_iam_role.portal_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [var.creator_password_arn]
    }]
  })
}
