# Log group das tasks Fargate do backend.

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${local.name}-backend"
  retention_in_days = var.log_retention_days
  tags              = local.tags
}
