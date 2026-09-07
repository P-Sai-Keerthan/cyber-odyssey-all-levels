resource "aws_ecr_repository" "portal" {
  name                 = "${var.environment_name}/portal"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "level1" {
  name                 = "${var.environment_name}/level1"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "expire_untagged" {
  for_each   = { portal = aws_ecr_repository.portal.name, level1 = aws_ecr_repository.level1.name }
  repository = each.value
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire untagged images after 14 days"
      selection = {
        tagStatus   = "untagged"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 14
      }
      action = { type = "expire" }
    }]
  })
}
