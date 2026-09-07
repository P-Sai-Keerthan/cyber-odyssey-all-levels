data "aws_caller_identity" "current" {}

# Bucket name suffixed with the account ID for global uniqueness without
# relying on a random value that would change the bucket (and orphan
# existing uploads) if state were ever recreated.
resource "aws_s3_bucket" "uploads" {
  bucket = "${var.environment_name}-uploads-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Submission files and Creator resources are proxied through the Portal's own
# route handlers (see src/lib/storage/object-store.ts) — nothing in the
# browser ever talks to S3 directly, so no CORS configuration is needed here.

data "aws_iam_policy_document" "portal_uploads_access" {
  statement {
    sid       = "ReadWriteDeleteUploads"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.uploads.arn}/*"]
  }
}

resource "aws_iam_policy" "portal_uploads_access" {
  name   = "${var.environment_name}-portal-s3-access"
  policy = data.aws_iam_policy_document.portal_uploads_access.json
}
