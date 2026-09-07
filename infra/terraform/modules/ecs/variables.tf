variable "environment_name" { type = string }
variable "aws_region" { type = string }

variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "private_subnet_ids" { type = list(string) }
variable "alb_security_group_id" { type = string }
variable "ecs_security_group_id" { type = string }

variable "cluster_arn" { type = string }
variable "cluster_name" { type = string }

variable "acm_certificate_arn" { type = string }
variable "portal_domain_name" { type = string }
variable "level1_domain_name" { type = string }

variable "portal_image_tag" { type = string }
variable "level1_image_tag" { type = string }

variable "portal_cpu" { type = number }
variable "portal_memory" { type = number }
variable "portal_desired_count" { type = number }
variable "portal_max_count" { type = number }

variable "level1_cpu" { type = number }
variable "level1_memory" { type = number }

variable "outbox_drainer_cpu" { type = number }
variable "outbox_drainer_memory" { type = number }

# --- Database ---
variable "db_endpoint" { type = string }
variable "db_port" { type = number }

# --- Secrets (ARNs only — task definitions read plaintext at container start,
# never at plan/apply time) ---
variable "portal_database_url_secret_arn" { type = string }
variable "level1_database_url_secret_arn" { type = string }
variable "session_secret_arn" { type = string }
variable "admin_password_arn" { type = string }
variable "odyssey_level1_secret_arn" { type = string }
variable "creator_password_arn" { type = string }
variable "odyssey_integration_secret_arn" {
  type    = string
  default = ""
}
variable "level3_challenge_url" {
  description = "Public URL of the external ORION Level 3 challenge app. Unrelated to this AWS deployment's own infrastructure."
  type        = string
  default     = ""
}

# --- Non-secret bootstrap values, for the one-off db:seed task override ---
variable "creator_email" { type = string }
variable "creator_username" { type = string }

# --- S3 uploads ---
variable "uploads_bucket_name" { type = string }
variable "uploads_access_policy_arn" { type = string }
