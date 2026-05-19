# Deploy da Plataforma JaguarData na AWS

IaC Terraform + notebook para deployar a plataforma (backend FastAPI + frontend
React) numa conta AWS, executado de dentro de um **SageMaker Studio**.

> Esta é a IaC da **plataforma**. Não confundir com
> `backend/app/engine/pipeline/iac_generator.py`, que gera Terraform para os
> **agentes** que a plataforma compila.

## Arquitetura

```
Usuário → CloudFront ─┬─ default ──→ S3 (frontend React, SPA)
                      └─ /api/*  ──→ ALB → ECS Fargate (FastAPI :7860)
                                                  │
                                       EFS (/app/data: dcm.sqlite3, security.sqlite3)
ECS task role → Bedrock / bedrock-agentcore / CloudWatch Logs
Secrets Manager → JWT_SECRET      ECR → imagem do backend
```

Uma única distribuição CloudFront serve tudo: o caminho `/api/*` é roteado ao
ALB, o resto ao S3. Mesma origem para o browser — **sem CORS**. O frontend é
buildado com `VITE_API_BASE=/api`.

## Como deployar

1. Abra o **SageMaker Studio** na conta AWS alvo.
2. Clone o repositório `Plataforma-Agentica` no Studio (branch `deploy/aws`).
3. Abra `infra/platform/deploy-sagemaker.ipynb`.
4. Execute as células em ordem. O notebook:
   - instala Terraform, `sagemaker-studio-image-build` e Node;
   - cria o backend de state do Terraform (bucket S3 + tabela DynamoDB);
   - cria o ECR, builda a imagem do backend (via CodeBuild) e faz push;
   - builda o frontend;
   - `terraform apply` da infra completa;
   - publica o `dist/` do frontend no S3 e invalida o CloudFront;
   - roda um smoke test em `/api/health`.
5. A URL final sai no output `cloudfront_domain`.

## Pré-requisitos

- **Execution role do SageMaker** com permissão para criar a infra — na prática
  `PowerUserAccess` + `IAMFullAccess` (VPC, ECS, ALB, EFS, IAM, S3, CloudFront,
  Secrets Manager, ECR, DynamoDB, CodeBuild).
- **Bedrock habilitado** na região escolhida.
- O build da imagem usa **CodeBuild** (`sm-docker`): o SageMaker Studio clássico
  não tem daemon Docker.

## Restrições importantes

- **`desired_count` deve ser 1.** O banco é SQLite num volume EFS; WAL sobre NFS
  não tolera múltiplos escritores. `variables.tf` tem uma validação que bloqueia
  qualquer outro valor. Escalar horizontalmente exige migrar para RDS antes.
- O `JWT_SECRET` é gerado a cada execução do notebook e gravado no Secrets
  Manager. Reexecutar rotaciona o segredo (invalida tokens emitidos).
- O `terraform destroy` **não** remove o bucket de state nem a tabela de lock —
  apague-os manualmente se quiser.

## Custo

Fora do free-tier. Custos contínuos principais (ordem de grandeza, varia por
região): NAT gateway, ALB, 1 task Fargate (0,5 vCPU / 1 GB), EFS, CloudFront.
Estime na calculadora AWS antes de deixar rodando.

## Validação local da IaC

```bash
cd infra/platform
terraform init -backend=false
terraform validate
```

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `main.tf` | provider, backend S3, locals |
| `variables.tf` | variáveis de entrada (inclui validação de `desired_count`) |
| `vpc.tf` | VPC, subnets, NAT, security groups |
| `ecr.tf` | repositório ECR da imagem do backend |
| `efs.tf` | EFS + access point para o SQLite |
| `alb.tf` | ALB, target group, listeners |
| `ecs.tf` | cluster, task definition, service Fargate |
| `iam.tf` | execution role e task role |
| `secrets.tf` | JWT_SECRET no Secrets Manager |
| `frontend.tf` | S3 + CloudFront (2 origens) |
| `cloudwatch.tf` | log group do backend |
| `outputs.tf` | URLs e nomes de recursos |
| `terraform.tfvars.example` | exemplo de variáveis |
| `deploy-sagemaker.ipynb` | notebook de deploy para o SageMaker Studio |
