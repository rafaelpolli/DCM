# JaguarData Platform — infraestrutura AWS (ECS Fargate + ALB + EFS + S3/CloudFront).
# Este modulo deploya a PLATAFORMA. Nao confundir com backend/app/engine/pipeline/
# iac_generator.py, que gera IaC para os agentes que a plataforma compila.

terraform {
  required_version = ">= 1.9"

  # Backend remoto S3. Bucket e tabela de lock sao criados pelo notebook
  # (deploy-sagemaker.ipynb) antes do `terraform init`, que recebe os valores
  # via -backend-config. Para validacao local: `terraform init -backend=false`.
  backend "s3" {
    key     = "platform/terraform.tfstate"
    encrypt = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# CloudFront e recursos globais (ACM de CloudFront) vivem em us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name = var.project_name

  tags = {
    Project   = var.project_name
    ManagedBy = "terraform"
    Component = "platform"
  }
}
