# Architecture Diagrams

`dcm-full-aws-architecture.drawio` — two pages:

1. **Single-account full stack.** DCM (frontend + FastAPI engine + RDS + OpenSearch + SES + CI/CD) + Agent Platform (Bedrock AgentCore Runtime, Memory, Gateway, Identity, per-tool Lambdas, S3 Vectors, DynamoDB, ECR, Guardrails). Same structure replicates per account.
2. **Multi-account topology.** BR centralizadora (hub de observabilidade + Org master) + 2 unidades exemplo (US, EU). VPC peering BR↔unidade, log shipping via Kinesis Firehose, CloudTrail Org Trail centralizado.

## Open

- Browser: drag-drop into https://app.diagrams.net
- VS Code: install Draw.io Integration extension, open the file
- Desktop: Draw.io app

## Edit conventions

- AWS shape library (`mxgraph.aws4.*`) only
- Cores: laranja = compute/plataforma, azul = dados, vermelho = segurança/IAM, rosa = observabilidade, verde-azul = Bedrock, roxo = edge/eventos
- Linhas tracejadas = conexões async ou IAM (não data path)
- Cada nó tem label embaixo (texto separado pra controle de tamanho)
