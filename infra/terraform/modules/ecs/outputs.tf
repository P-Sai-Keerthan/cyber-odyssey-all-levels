output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

output "portal_ecr_repository_url" {
  value = aws_ecr_repository.portal.repository_url
}

output "level1_ecr_repository_url" {
  value = aws_ecr_repository.level1.repository_url
}

output "portal_task_definition_family" {
  value = aws_ecs_task_definition.portal.family
}

output "portal_seed_task_definition_arn" {
  value = aws_ecs_task_definition.portal_seed.arn
}

output "level1_task_definition_family" {
  value = aws_ecs_task_definition.level1.family
}
