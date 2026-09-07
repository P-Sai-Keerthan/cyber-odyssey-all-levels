output "bucket_name" {
  value = aws_s3_bucket.uploads.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.uploads.arn
}

output "access_policy_arn" {
  value = aws_iam_policy.portal_uploads_access.arn
}
