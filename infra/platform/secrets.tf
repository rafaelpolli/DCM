# JWT_SECRET do backend, injetado na task ECS via `secrets` da task definition.

resource "aws_secretsmanager_secret" "jwt" {
  name        = "${local.name}/jwt-secret"
  description = "JWT signing key do backend JaguarData."
  tags        = local.tags
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = var.jwt_secret
}
