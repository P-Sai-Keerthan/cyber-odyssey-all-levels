output "endpoint" {
  value = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "level1_db_name" {
  value = var.level1_db_name
}

output "portal_db_name" {
  value = var.portal_db_name
}

output "master_username" {
  value = var.master_username
}

output "instance_id" {
  value = aws_db_instance.this.id
}
