output "postgres_master_password" {
  value     = random_id.postgres_master_password.b64_url
  sensitive = true
}

output "postgres_master_password_arn" {
  value = aws_secretsmanager_secret.this["postgres-master-password"].arn
}

output "session_secret_arn" {
  value = aws_secretsmanager_secret.this["session-secret"].arn
}

output "admin_password_arn" {
  value = aws_secretsmanager_secret.this["admin-password"].arn
}

output "odyssey_level1_secret_arn" {
  value = aws_secretsmanager_secret.this["odyssey-level1-secret"].arn
}

output "creator_password_arn" {
  value = aws_secretsmanager_secret.this["creator-password"].arn
}

output "creator_password" {
  value     = random_id.creator_password.b64_url
  sensitive = true
}

output "odyssey_integration_secret_arn" {
  value = var.enable_orion_bridge ? aws_secretsmanager_secret.this["odyssey-integration-secret"].arn : ""
}
