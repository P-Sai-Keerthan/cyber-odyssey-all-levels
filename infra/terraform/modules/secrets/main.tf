# Every credential RUNBOOK.md's "Required secrets" section lists, generated
# at apply time and stored only in Secrets Manager and (unavoidably) Terraform
# state — see backend.tf for why state must live in an encrypted, access-
# restricted bucket. Byte lengths match what RUNBOOK.md and both
# .env.example files already instruct operators to generate by hand
# (`randomBytes(N).toString('base64url')`); doing it here just removes the
# manual step and the chance of pasting a value into the wrong field.

resource "random_id" "postgres_master_password" {
  byte_length = 32
}

resource "random_id" "session_secret" {
  byte_length = 48
}

resource "random_id" "admin_password" {
  byte_length = 32
}

# ONE secret, used by both the Portal and Level 1 task definitions — see
# RUNBOOK.md: "must be identical on both sides ... a 401 that looks like a
# bug in the bridge."
resource "random_id" "odyssey_level1_secret" {
  byte_length = 48
}

resource "random_id" "creator_password" {
  byte_length = 24
}

resource "random_id" "odyssey_integration_secret" {
  count       = var.enable_orion_bridge ? 1 : 0
  byte_length = 48
}

locals {
  # odyssey-integration-secret is only ever a key here when the bridge is
  # enabled — Secrets Manager rejects an empty SecretString outright, so
  # this can't be "included with a blank value" the way the ARN output
  # below tolerates a blank string.
  secrets = merge(
    {
      postgres-master-password = random_id.postgres_master_password.b64_url
      session-secret           = random_id.session_secret.b64_url
      admin-password           = random_id.admin_password.b64_url
      odyssey-level1-secret    = random_id.odyssey_level1_secret.b64_url
      creator-password         = random_id.creator_password.b64_url
    },
    var.enable_orion_bridge ? { odyssey-integration-secret = random_id.odyssey_integration_secret[0].b64_url } : {},
  )
}

resource "aws_secretsmanager_secret" "this" {
  for_each                = local.secrets
  name                     = "${var.environment_name}/${each.key}"
  recovery_window_in_days = 0 # event infra; instant delete on destroy, not a 7-30 day hold
}

resource "aws_secretsmanager_secret_version" "this" {
  for_each      = local.secrets
  secret_id     = aws_secretsmanager_secret.this[each.key].id
  secret_string = each.value
}
