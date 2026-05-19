# EFS — volume persistente para o SQLite do backend (dcm.sqlite3, security.sqlite3).
# Montado em /app/data na task Fargate. Access point fixa uid/gid e o diretorio raiz.

resource "aws_efs_file_system" "data" {
  creation_token = "${local.name}-data"
  encrypted      = true

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }

  tags = merge(local.tags, { Name = "${local.name}-data" })
}

resource "aws_efs_mount_target" "data" {
  count           = 2
  file_system_id  = aws_efs_file_system.data.id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.efs.id]
}

# Access point: o container roda como root (uid 0) na imagem atual; o diretorio
# /data e criado com permissoes 0755. Ajuste posix_user se a imagem rodar como
# usuario nao-root no futuro.
resource "aws_efs_access_point" "data" {
  file_system_id = aws_efs_file_system.data.id

  posix_user {
    uid = 0
    gid = 0
  }

  root_directory {
    path = "/data"

    creation_info {
      owner_uid   = 0
      owner_gid   = 0
      permissions = "0755"
    }
  }

  tags = merge(local.tags, { Name = "${local.name}-data-ap" })
}
