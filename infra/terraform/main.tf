module "network" {
  source = "./modules/network"

  environment_name   = var.environment_name
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
}

module "storage" {
  source = "./modules/storage"

  environment_name = var.environment_name
}

module "secrets" {
  source = "./modules/secrets"

  environment_name = var.environment_name
}

# One cluster, shared by the real services (module.ecs) and the one-off
# database-bootstrap task (module.database) — created here, not inside
# either module, so neither has to depend on the other for it.
resource "aws_ecs_cluster" "this" {
  name = var.environment_name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

module "database" {
  source = "./modules/database"

  environment_name       = var.environment_name
  aws_region              = var.aws_region
  vpc_id                  = module.network.vpc_id
  private_subnet_ids      = module.network.private_subnet_ids
  security_group_id       = module.network.rds_security_group_id
  instance_class          = var.db_instance_class
  allocated_storage_gb    = var.db_allocated_storage_gb
  multi_az                = var.db_multi_az
  backup_retention_days   = var.db_backup_retention_days
  deletion_protection     = var.db_deletion_protection
  master_password         = module.secrets.postgres_master_password
  master_password_secret_arn = module.secrets.postgres_master_password_arn
  ecs_cluster_arn         = aws_ecs_cluster.this.arn
}

# The two full DATABASE_URLs, assembled once both the database and the
# password exist, and stored as their own secrets. ECS task definitions
# inject one whole env var from one whole secret — they cannot interpolate a
# password into a larger string — so the complete connection string
# (including the pool parameters RUNBOOK.md calls load-bearing) has to be the
# secret, not just the password.
locals {
  # connection_limit=20 (not the 40 originally sized for db.t4g.medium's
  # ~450 max_connections): this deployment runs on db.t4g.micro (~112
  # max_connections, Free Tier eligible — see terraform.tfvars). At
  # portal_desired_count=2 that's 40 connections, leaving headroom for
  # Level 1, the outbox drainer, and manual psql access. Raise this back to
  # 40 if/when the RDS instance is upgraded off db.t4g.micro.
  portal_database_url = "postgresql://${module.database.master_username}:${module.secrets.postgres_master_password}@${module.database.endpoint}:${module.database.port}/${module.database.portal_db_name}?schema=public&connection_limit=20&pool_timeout=20&connect_timeout=10"
  level1_database_url = "postgresql://${module.database.master_username}:${module.secrets.postgres_master_password}@${module.database.endpoint}:${module.database.port}/${module.database.level1_db_name}"
}

resource "aws_secretsmanager_secret" "portal_database_url" {
  name                    = "${var.environment_name}/portal-database-url"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "portal_database_url" {
  secret_id     = aws_secretsmanager_secret.portal_database_url.id
  secret_string = local.portal_database_url
}

resource "aws_secretsmanager_secret" "level1_database_url" {
  name                    = "${var.environment_name}/level1-database-url"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "level1_database_url" {
  secret_id     = aws_secretsmanager_secret.level1_database_url.id
  secret_string = local.level1_database_url
}

# ---------------------------------------------------------------------------
# TLS certificate — either provisioned with Route 53 DNS validation, or
# supplied pre-existing via var.acm_certificate_arn.
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "this" {
  count                     = var.route53_zone_id != "" ? 1 : 0
  domain_name               = var.portal_domain_name
  subject_alternative_names = [var.level1_domain_name]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = var.route53_zone_id != "" ? {
    for dvo in aws_acm_certificate.this[0].domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  } : {}

  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.value]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  count                   = var.route53_zone_id != "" ? 1 : 0
  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

locals {
  resolved_acm_certificate_arn = var.route53_zone_id != "" ? aws_acm_certificate_validation.this[0].certificate_arn : var.acm_certificate_arn
}

module "ecs" {
  source = "./modules/ecs"

  environment_name = var.environment_name
  aws_region        = var.aws_region

  vpc_id                 = module.network.vpc_id
  public_subnet_ids      = module.network.public_subnet_ids
  private_subnet_ids     = module.network.private_subnet_ids
  alb_security_group_id  = module.network.alb_security_group_id
  ecs_security_group_id  = module.network.ecs_security_group_id

  cluster_arn  = aws_ecs_cluster.this.arn
  cluster_name = aws_ecs_cluster.this.name

  acm_certificate_arn = local.resolved_acm_certificate_arn
  portal_domain_name  = var.portal_domain_name
  level1_domain_name  = var.level1_domain_name

  portal_image_tag = var.portal_image_tag
  level1_image_tag = var.level1_image_tag

  portal_cpu           = var.portal_cpu
  portal_memory        = var.portal_memory
  portal_desired_count = var.portal_desired_count
  portal_max_count     = var.portal_max_count

  level1_cpu    = var.level1_cpu
  level1_memory = var.level1_memory

  outbox_drainer_cpu    = var.outbox_drainer_cpu
  outbox_drainer_memory = var.outbox_drainer_memory

  db_endpoint = module.database.endpoint
  db_port     = module.database.port

  portal_database_url_secret_arn = aws_secretsmanager_secret.portal_database_url.arn
  level1_database_url_secret_arn = aws_secretsmanager_secret.level1_database_url.arn
  session_secret_arn             = module.secrets.session_secret_arn
  admin_password_arn             = module.secrets.admin_password_arn
  odyssey_level1_secret_arn      = module.secrets.odyssey_level1_secret_arn
  creator_password_arn           = module.secrets.creator_password_arn
  odyssey_integration_secret_arn = module.secrets.odyssey_integration_secret_arn

  creator_email    = var.creator_email
  creator_username = var.creator_username

  uploads_bucket_name       = module.storage.bucket_name
  uploads_access_policy_arn = module.storage.access_policy_arn

  # Module-level depends_on, not just the input-variable references above:
  # those only create an edge to aws_db_instance.this (whichever outputs they
  # read), not to the second-database bootstrap task, which is a separate
  # resource in the same module. The Portal service must not start against a
  # database that doesn't exist yet, so wait for all of module.database.
  # Also wait for the *_secret_version resources explicitly: the ARN
  # references above are an edge to the secret, not to its value, and a task
  # that starts before the version exists fails GetSecretValue on its first
  # attempt (ECS retries, so this is self-healing, but there's no reason to
  # race it).
  depends_on = [
    module.database,
    aws_secretsmanager_secret_version.portal_database_url,
    aws_secretsmanager_secret_version.level1_database_url,
  ]
}

resource "aws_route53_record" "portal" {
  count   = var.route53_zone_id != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.portal_domain_name
  type    = "A"

  alias {
    name                   = module.ecs.alb_dns_name
    zone_id                = module.ecs.alb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "level1" {
  count   = var.route53_zone_id != "" ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.level1_domain_name
  type    = "A"

  alias {
    name                   = module.ecs.alb_dns_name
    zone_id                = module.ecs.alb_zone_id
    evaluate_target_health = true
  }
}
