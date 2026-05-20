"""Phase 3 (ML): emit Terraform for the ML pipeline + endpoints.

Generates:
- infra/main.tf            — provider, S3 backend
- infra/variables.tf       — region, project name, role/bucket, endpoint vars
- infra/iam.tf             — SageMaker execution role + managed policy
- infra/sagemaker.tf       — model package groups, models, endpoint configs, endpoints
- infra/outputs.tf         — pipeline name, group ARNs, endpoint names
- infra/dev.tfvars         — example values

The Pipeline definition itself is upserted by `pipeline.upsert()` from the
SDK at deploy time, not by Terraform — that's why there is no
`aws_sagemaker_pipeline` resource here.
"""
from __future__ import annotations

from ..._types import CompiledArtifacts, CompiledFile
from ...models.graph import Node, Project


def generate_iac_ml(project: Project, sorted_nodes: list[Node]) -> CompiledArtifacts:
    artifacts = CompiledArtifacts()
    project_name = project.name.lower().replace(" ", "-")

    model_register_nodes = [n for n in project.nodes if n.type == "model_register"]
    endpoint_nodes = [n for n in project.nodes if n.type == "endpoint_realtime"]

    artifacts.add(_gen_main_tf(project_name))
    artifacts.add(_gen_variables_tf(project_name, endpoint_nodes))
    artifacts.add(_gen_iam_tf(project_name))
    artifacts.add(_gen_sagemaker_tf(model_register_nodes, endpoint_nodes))
    artifacts.add(_gen_outputs_tf(model_register_nodes, endpoint_nodes))
    artifacts.add(_gen_dev_tfvars(project_name, endpoint_nodes))
    return artifacts


def _tf_name(raw: str) -> str:
    return raw.replace("-", "_").replace(" ", "_") or "default"


def _gen_main_tf(project_name: str) -> CompiledFile:
    content = f'''\
terraform {{
  required_version = ">= 1.9"

  backend "s3" {{
    # Configure via: terraform init -backend-config="bucket=<state-bucket>" \\
    #                              -backend-config="key={project_name}/terraform.tfstate"
    dynamodb_table = "{project_name}-tf-lock"
    encrypt        = true
  }}

  required_providers {{
    aws = {{
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }}
  }}
}}

provider "aws" {{
  region = var.aws_region
}}
'''
    return CompiledFile(path="infra/main.tf", content=content)


def _gen_variables_tf(project_name: str, endpoint_nodes: list[Node]) -> CompiledFile:
    endpoint_vars = ""
    for n in endpoint_nodes:
        ep_name = _tf_name(n.id)
        endpoint_vars += f'''
variable "{ep_name}_model_data_url" {{
  description = "S3 URI of the approved model.tar.gz for endpoint '{n.id}'. Set after the pipeline finishes and the ModelPackage is approved."
  type        = string
  default     = ""
}}

variable "{ep_name}_container_image" {{
  description = "Inference container image URI for endpoint '{n.id}'."
  type        = string
  default     = ""
}}
'''

    content = f'''\
variable "aws_region" {{
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}}

variable "project_name" {{
  description = "Prefix for SageMaker resources."
  type        = string
  default     = "{project_name}"
}}

variable "default_bucket" {{
  description = "S3 bucket used by SageMaker for pipeline artifacts and offline data."
  type        = string
}}
{endpoint_vars}'''
    return CompiledFile(path="infra/variables.tf", content=content)


def _gen_iam_tf(project_name: str) -> CompiledFile:
    content = '''\
# Execution role assumed by SageMaker for pipeline steps and endpoints.
data "aws_iam_policy_document" "sagemaker_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["sagemaker.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "sagemaker" {
  name               = "${var.project_name}-sagemaker"
  assume_role_policy = data.aws_iam_policy_document.sagemaker_assume.json
}

# Managed policy covers training, processing, endpoints, model registry, S3
# access for SageMaker default bucket, and CloudWatch Logs. Tighten the
# resource scope before production.
resource "aws_iam_role_policy_attachment" "sagemaker_full" {
  role       = aws_iam_role.sagemaker.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSageMakerFullAccess"
}

resource "aws_iam_role_policy" "sagemaker_s3" {
  name = "${var.project_name}-sagemaker-s3"
  role = aws_iam_role.sagemaker.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:DeleteObject"]
      Resource = [
        "arn:aws:s3:::${var.default_bucket}",
        "arn:aws:s3:::${var.default_bucket}/*",
      ]
    }]
  })
}
'''
    return CompiledFile(path="infra/iam.tf", content=content)


def _gen_sagemaker_tf(
    model_register_nodes: list[Node],
    endpoint_nodes: list[Node],
) -> CompiledFile:
    blocks: list[str] = []

    # Model Package Groups — one per model_register node.
    for n in model_register_nodes:
        group = n.config.get("model_package_group_name", n.id)
        tf = _tf_name(group)
        blocks.append(f'''\
resource "aws_sagemaker_model_package_group" "{tf}" {{
  model_package_group_name        = "{group}"
  model_package_group_description = "Registered models for {group}."
}}''')

    # Endpoints — one Model + EndpointConfig + Endpoint per endpoint_realtime node.
    for n in endpoint_nodes:
        ep_name = n.config.get("name", n.id)
        ep_tf = _tf_name(n.id)
        instance_type = n.config.get("instance_type", "ml.m5.large")
        initial_count = n.config.get("initial_instance_count", 1)

        blocks.append(f'''\
# Endpoint '{ep_name}' — Model + EndpointConfig + Endpoint.
# {ep_tf}_model_data_url is set after the pipeline finishes and the
# ModelPackage in the registry is moved to Approved.
resource "aws_sagemaker_model" "{ep_tf}" {{
  name               = "${{var.project_name}}-{ep_tf}"
  execution_role_arn = aws_iam_role.sagemaker.arn

  primary_container {{
    image          = var.{ep_tf}_container_image
    model_data_url = var.{ep_tf}_model_data_url
  }}
}}

resource "aws_sagemaker_endpoint_configuration" "{ep_tf}" {{
  name = "${{var.project_name}}-{ep_tf}-config"

  production_variants {{
    variant_name           = "AllTraffic"
    model_name             = aws_sagemaker_model.{ep_tf}.name
    initial_instance_count = {initial_count}
    instance_type          = "{instance_type}"
  }}
}}

resource "aws_sagemaker_endpoint" "{ep_tf}" {{
  name                 = "${{var.project_name}}-{ep_tf}"
  endpoint_config_name = aws_sagemaker_endpoint_configuration.{ep_tf}.name
}}''')

    content = "# SageMaker Model Package Groups and real-time endpoints.\n\n" + "\n\n".join(blocks) + "\n"
    return CompiledFile(path="infra/sagemaker.tf", content=content)


def _gen_outputs_tf(
    model_register_nodes: list[Node],
    endpoint_nodes: list[Node],
) -> CompiledFile:
    outputs = []
    for n in model_register_nodes:
        group = n.config.get("model_package_group_name", n.id)
        tf = _tf_name(group)
        outputs.append(f'''\
output "{tf}_model_package_group_arn" {{
  description = "ARN of the ModelPackage group for {group}."
  value       = aws_sagemaker_model_package_group.{tf}.arn
}}''')
    for n in endpoint_nodes:
        tf = _tf_name(n.id)
        outputs.append(f'''\
output "{tf}_endpoint_name" {{
  description = "Name of the SageMaker endpoint '{n.id}'."
  value       = aws_sagemaker_endpoint.{tf}.name
}}''')

    outputs.append('''\
output "sagemaker_role_arn" {
  description = "Execution role ARN — export to SAGEMAKER_ROLE_ARN when running pipeline.upsert()."
  value       = aws_iam_role.sagemaker.arn
}''')

    return CompiledFile(path="infra/outputs.tf", content="\n\n".join(outputs) + "\n")


def _gen_dev_tfvars(project_name: str, endpoint_nodes: list[Node]) -> CompiledFile:
    endpoint_lines = ""
    for n in endpoint_nodes:
        ep_tf = _tf_name(n.id)
        endpoint_lines += (
            f'# {ep_tf}_model_data_url    = "s3://your-bucket/path/model.tar.gz"\n'
            f'# {ep_tf}_container_image   = "<account>.dkr.ecr.<region>.amazonaws.com/<image>:tag"\n'
        )

    content = f'''\
aws_region     = "us-east-1"
project_name   = "{project_name}"
default_bucket = "REPLACE-WITH-YOUR-SAGEMAKER-BUCKET"

# Endpoint inputs — uncomment and fill after the pipeline finishes and the
# ModelPackage is moved to Approved in the SageMaker Model Registry.
{endpoint_lines}'''
    return CompiledFile(path="infra/dev.tfvars", content=content)
