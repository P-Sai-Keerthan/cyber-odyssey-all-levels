resource "aws_ecs_service" "portal" {
  name            = "${var.environment_name}-portal"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.portal.arn
  desired_count   = var.portal_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.portal.arn
    container_name    = "portal"
    container_port    = 3002
  }

  # Next.js Server Components read cookies() on every authenticated route,
  # so nothing here is safely servable mid-deploy from the old task version —
  # wait for the new one to pass its health check before killing the old one.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener_rule.portal]
}

resource "aws_appautoscaling_target" "portal" {
  max_capacity       = var.portal_max_count
  min_capacity       = var.portal_desired_count
  resource_id        = "service/${var.cluster_name}/${aws_ecs_service.portal.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "portal_cpu" {
  name               = "${var.environment_name}-portal-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.portal.resource_id
  scalable_dimension = aws_appautoscaling_target.portal.scalable_dimension
  service_namespace  = aws_appautoscaling_target.portal.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60
    scale_in_cooldown  = 120
    scale_out_cooldown = 60
  }
}

# ---------------------------------------------------------------------------
# Level 1 — fixed at 1 task, no autoscaling. Its login throttler
# (lib/rateLimitStore.js) is explicitly documented as per-process, in-memory
# state; a second replica would give every client roughly 2x its intended
# attempt allowance. See RUNBOOK.md's AWS section for the shared-store path
# if this ever needs to change.
# ---------------------------------------------------------------------------

resource "aws_ecs_service" "level1" {
  name            = "${var.environment_name}-level1"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.level1.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.level1.arn
    container_name    = "level1"
    container_port    = 3001
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener_rule.level1]
}

resource "aws_ecs_service" "outbox_drainer" {
  name            = "${var.environment_name}-level1-outbox-drainer"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.outbox_drainer.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  # No load_balancer block: this is a polling worker, not a web process.
}
