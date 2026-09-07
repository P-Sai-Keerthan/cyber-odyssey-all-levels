variable "environment_name" {
  type = string
}

variable "enable_orion_bridge" {
  description = "Whether to generate ODYSSEY_INTEGRATION_SECRET (Level 3 / ORION bridge). Leave false to keep that bridge disabled, matching the app's own documented behavior (endpoints answer 503 rather than accepting unsigned events)."
  type        = bool
  default     = false
}
