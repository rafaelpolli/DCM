variable "aws_region" {
  description = "Regiao AWS para o deploy da plataforma. Use uma regiao com Bedrock habilitado."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefixo de nome para todos os recursos."
  type        = string
  default     = "jaguardata"
}

variable "vpc_cidr" {
  description = "CIDR da VPC da plataforma."
  type        = string
  default     = "10.20.0.0/16"
}

variable "backend_image_uri" {
  description = "URI da imagem do backend no ECR (tag incluida). Preenchido pelo notebook apos o build."
  type        = string
  default     = ""
}

variable "jwt_secret" {
  description = "Valor do JWT_SECRET do backend. Armazenado no Secrets Manager."
  type        = string
  sensitive   = true
}

variable "desired_count" {
  description = "Numero de tasks do ECS service. DEVE ser 1: SQLite em EFS nao tolera multiplos escritores."
  type        = number
  default     = 1

  validation {
    condition     = var.desired_count == 1
    error_message = "desired_count deve ser 1 enquanto o banco for SQLite em EFS. Migre para RDS antes de escalar."
  }
}

variable "backend_port" {
  description = "Porta exposta pelo container do backend (uvicorn)."
  type        = number
  default     = 7860
}

variable "task_cpu" {
  description = "CPU da task Fargate (unidades; 1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Memoria da task Fargate (MiB)."
  type        = number
  default     = 1024
}

variable "acm_certificate_arn" {
  description = "ARN opcional de certificado ACM para o listener HTTPS do ALB. Vazio = somente HTTP (CloudFront ja provê TLS na borda)."
  type        = string
  default     = ""
}

variable "log_retention_days" {
  description = "Retencao dos logs do CloudWatch."
  type        = number
  default     = 30
}
