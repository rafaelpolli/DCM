output "cloudfront_domain" {
  description = "Dominio publico da plataforma (frontend + /api)."
  value       = "https://${aws_cloudfront_distribution.main.domain_name}"
}

output "cloudfront_distribution_id" {
  description = "ID da distribuicao CloudFront — usado para invalidacao apos publicar o frontend."
  value       = aws_cloudfront_distribution.main.id
}

output "alb_dns_name" {
  description = "DNS do ALB (acesso direto ao backend, sem CloudFront)."
  value       = aws_lb.main.dns_name
}

output "ecr_repository_url" {
  description = "URL do repositorio ECR — destino do push da imagem do backend."
  value       = aws_ecr_repository.backend.repository_url
}

output "frontend_bucket" {
  description = "Bucket S3 do frontend — destino do `aws s3 sync` do dist/."
  value       = aws_s3_bucket.frontend.bucket
}

output "ecs_cluster" {
  description = "Nome do cluster ECS."
  value       = aws_ecs_cluster.main.name
}

output "ecs_service" {
  description = "Nome do ECS service do backend."
  value       = aws_ecs_service.backend.name
}
