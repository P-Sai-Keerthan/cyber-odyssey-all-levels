# Remote state, deliberately not configured with real values.
#
# State will contain database passwords, session secrets and the Level 1
# bridge secret in plaintext (see modules/secrets) — Terraform state always
# contains the values it wrote to Secrets Manager. It must NOT be local state
# on a laptop, and the bucket holding it must not be publicly readable.
#
# Create the bucket and lock table ONCE, by hand, before the first `terraform
# init` (this can't be created by the same Terraform run that needs it):
#
#   aws s3api create-bucket --bucket <your-unique-state-bucket-name> \
#     --region us-east-1
#   aws s3api put-bucket-versioning --bucket <your-unique-state-bucket-name> \
#     --versioning-configuration Status=Enabled
#   aws s3api put-bucket-encryption --bucket <your-unique-state-bucket-name> \
#     --server-side-encryption-configuration \
#     '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
#   aws s3api put-public-access-block --bucket <your-unique-state-bucket-name> \
#     --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
#   aws dynamodb create-table --table-name cyber-odyssey-tfstate-lock \
#     --attribute-definitions AttributeName=LockID,AttributeType=S \
#     --key-schema AttributeName=LockID,KeyType=HASH \
#     --billing-mode PAY_PER_REQUEST
#
# Then uncomment and fill in below, and run `terraform init` again.

terraform {
  backend "s3" {
    bucket         = "cyber-odyssey-tfstate-460129176514"
    key            = "cyber-odyssey/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "cyber-odyssey-tfstate-lock"
    encrypt        = true
  }
}
