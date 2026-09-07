variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "environment_name" {
  description = "Short name used as a prefix for every resource (e.g. \"cyber-odyssey-prod\")."
  type        = string
  default     = "cyber-odyssey"
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "availability_zones" {
  description = "Two AZs to spread subnets across. Must be in aws_region."
  type        = list(string)
}

# ---------------------------------------------------------------------------
# DNS / TLS
# ---------------------------------------------------------------------------

variable "portal_domain_name" {
  description = "Public hostname participants use for the Portal, e.g. odyssey.example.org."
  type        = string
}

variable "level1_domain_name" {
  description = "Public hostname participants use for Level 1, e.g. level1.odyssey.example.org."
  type        = string
}

variable "route53_zone_id" {
  description = <<-EOT
    Hosted zone ID that owns both domain names above. When set, Terraform
    creates a DNS-validated ACM certificate and A/AAAA alias records pointing
    at the ALB automatically. Leave blank if DNS is managed outside Route 53
    — in that case set acm_certificate_arn instead and point your own DNS at
    the `alb_dns_name` output by hand.
  EOT
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "Existing ACM certificate ARN to use instead of provisioning one. Ignored if route53_zone_id is set."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

variable "db_instance_class" {
  description = <<-EOT
    RDS instance class. db.t4g.medium (4 GiB RAM, ~450 max_connections) is
    sized for 120-150 participants with wide headroom — see RUNBOOK.md
    "Scaling the Portal" for the connection-pool math this assumes.
  EOT
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage_gb" {
  description = "RDS storage in GB. 20GB is ample for one event's worth of rows; uploads live in S3, not the database."
  type        = number
  default     = 20
}

variable "db_multi_az" {
  description = <<-EOT
    Whether RDS runs Multi-AZ (automatic failover, roughly 2x the instance
    cost). Off by default: this is a short-lived event workload, not
    always-on production infrastructure, and a Single-AZ instance with
    automated backups plus a pre-event snapshot is the documented tradeoff.
    Turn on if the event's cost tolerance allows for zero-downtime failover.
  EOT
  type    = bool
  default = false
}

variable "db_backup_retention_days" {
  description = "Automated backup retention window."
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "Prevent accidental `terraform destroy` / console deletion of the database."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Container images
# ---------------------------------------------------------------------------

variable "portal_image_tag" {
  description = "Tag of the Portal image in its ECR repository to deploy."
  type        = string
  default     = "latest"
}

variable "level1_image_tag" {
  description = "Tag of the Level 1 image in its ECR repository to deploy."
  type        = string
  default     = "latest"
}

# ---------------------------------------------------------------------------
# ECS sizing
# ---------------------------------------------------------------------------

variable "portal_desired_count" {
  description = <<-EOT
    Fixed/starting Portal task count. 2 is the RUNBOOK's measured sweet spot
    for this codebase (see "Scaling the Portal" — 2 instances behind a proxy
    handled 300 concurrent authenticated page loads with all waves passing).
  EOT
  type    = number
  default = 2
}

variable "portal_max_count" {
  description = "Ceiling for Portal autoscaling. Headroom above the measured sweet spot, not a requirement at 120-150 participants."
  type        = number
  default     = 4
}

variable "portal_cpu" {
  description = "Fargate vCPU units per Portal task (1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "portal_memory" {
  description = "Fargate memory (MB) per Portal task."
  type        = number
  default     = 1024
}

variable "level1_cpu" {
  description = "Fargate vCPU units per Level 1 task."
  type        = number
  default     = 512
}

variable "level1_memory" {
  description = "Fargate memory (MB) per Level 1 task."
  type        = number
  default     = 1024
}

variable "outbox_drainer_cpu" {
  description = "Fargate vCPU units for the outbox-drainer task."
  type        = number
  default     = 256
}

variable "outbox_drainer_memory" {
  description = "Fargate memory (MB) for the outbox-drainer task."
  type        = number
  default     = 512
}

# ---------------------------------------------------------------------------
# Application bootstrap values (non-secret)
# ---------------------------------------------------------------------------

variable "creator_email" {
  description = "Bootstrap Creator email, read only by the one-off db:seed task."
  type        = string
}

variable "creator_username" {
  description = "Bootstrap Creator username."
  type        = string
  default     = "event_creator"
}
