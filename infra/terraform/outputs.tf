output "alb_dns_name" {
  description = "If route53_zone_id was not set, point your own DNS at this (CNAME for the domain, or however your provider supports aliasing to an ALB)."
  value       = module.ecs.alb_dns_name
}

output "portal_ecr_repository_url" {
  value = module.ecs.portal_ecr_repository_url
}

output "level1_ecr_repository_url" {
  value = module.ecs.level1_ecr_repository_url
}

output "db_endpoint" {
  value = module.database.endpoint
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "portal_seed_task_definition_arn" {
  value = module.ecs.portal_seed_task_definition_arn
}

output "uploads_bucket_name" {
  value = module.storage.bucket_name
}

output "portal_url" {
  value = "https://${var.portal_domain_name}"
}

output "level1_url" {
  value = "https://${var.level1_domain_name}"
}

output "creator_password_secret_name" {
  description = "Secrets Manager secret name holding the generated Creator bootstrap password. Retrieve with: aws secretsmanager get-secret-value --secret-id <this value> --query SecretString --output text"
  value       = "${var.environment_name}/creator-password"
}
