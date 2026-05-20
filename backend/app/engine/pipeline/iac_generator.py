"""Phase 3: IaC Generator — emits Terraform modules for the agent runtime."""
from __future__ import annotations

from .._types import CompiledArtifacts, CompiledFile
from ..models.graph import Node, Project, TOOL_NODE_TYPES


def generate_iac(project: Project, sorted_nodes: list[Node]) -> CompiledArtifacts:
    artifacts = CompiledArtifacts()
    agent_name = project.name.lower().replace(" ", "-")
    tool_nodes = [n for n in project.nodes if n.is_tool()]
    has_hitl = project.has_node_type("human_in_the_loop")
    has_mcp_server = project.has_node_type("mcp_server")
    has_code_interpreter = project.has_node_type("code_interpreter")
    has_browser_tool = project.has_node_type("browser_tool")
    has_memory = any(
        n.config.get("memory", {}).get("enabled", False)
        for n in project.nodes if n.type == "agent"
    )
    has_http_oauth2 = any(
        n.type == "tool_http"
        and n.config.get("auth", {}).get("type") == "oauth2_client_credentials"
        for n in project.nodes
    )
    has_agentcore_features = (
        has_memory or has_code_interpreter or has_browser_tool or has_mcp_server
    )

    artifacts.add(_gen_main_tf(agent_name))
    artifacts.add(_gen_variables_tf(agent_name))
    artifacts.add(_gen_outputs_tf(has_memory, has_mcp_server))
    artifacts.add(_gen_ecr_tf(agent_name))
    artifacts.add(_gen_iam_tf(agent_name, tool_nodes, has_agentcore_features, has_memory))
    artifacts.add(_gen_vpc_tf(agent_name))
    artifacts.add(_gen_lambda_tf(agent_name, tool_nodes))
    artifacts.add(_gen_agentcore_tf(agent_name))
    artifacts.add(_gen_api_gateway_tf(agent_name))
    if has_hitl or has_memory:
        artifacts.add(_gen_dynamodb_tf(agent_name, has_hitl, has_memory))
    if has_memory:
        artifacts.add(_gen_agentcore_memory_tf(agent_name))
    if has_mcp_server:
        artifacts.add(_gen_agentcore_gateway_tf(agent_name))
    if has_http_oauth2:
        identity_tf = _gen_agentcore_identity_tf(agent_name, project.nodes)
        if identity_tf is not None:
            artifacts.add(identity_tf)
    artifacts.add(_gen_dev_tfvars(agent_name, has_memory, has_mcp_server))

    return artifacts


def _gen_ecr_tf(agent_name: str) -> CompiledFile:
    content = f'''\
resource "aws_ecr_repository" "agent" {{
  name                 = var.agent_name
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {{
    scan_on_push = true
  }}

  tags = {{
    AgentName   = var.agent_name
    Environment = var.environment
  }}
}}

resource "aws_ecr_lifecycle_policy" "agent" {{
  repository = aws_ecr_repository.agent.name

  policy = jsonencode({{
    rules = [{{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {{
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }}
      action = {{ type = "expire" }}
    }}]
  }})
}}
'''
    return CompiledFile(path="infra/ecr.tf", content=content)


def _tool_policy_statements(n: Node) -> str:
    """Returns Terraform IAM policy statement blocks for a tool node."""
    node_type = n.type
    # Base statements every tool Lambda needs: CloudWatch Logs plus the ENI
    # permissions required to attach the Lambda to the private VPC (see vpc.tf).
    logs_statement = '''\
  statement {
    sid       = "CloudWatchLogs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }

  statement {
    sid       = "VPCNetworking"
    actions   = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DeleteNetworkInterface"]
    resources = ["*"]
  }'''

    if node_type == "tool_athena":
        output_loc: str = n.config.get("output_location", "s3://placeholder-bucket/")
        bucket = output_loc.replace("s3://", "").split("/")[0]
        return f'''\
{logs_statement}

  statement {{
    sid     = "Athena"
    actions = [
      "athena:StartQueryExecution",
      "athena:GetQueryExecution",
      "athena:GetQueryResults",
      "athena:GetWorkGroup",
    ]
    resources = ["*"]
  }}

  statement {{
    sid     = "AthenaOutputBucket"
    actions = ["s3:GetBucketLocation", "s3:GetObject", "s3:ListBucket", "s3:PutObject"]
    resources = [
      "arn:aws:s3:::{bucket}",
      "arn:aws:s3:::{bucket}/*",
    ]
  }}'''

    if node_type == "tool_s3":
        bucket = n.config.get("bucket", "")
        operation = n.config.get("operation", "read")
        if operation == "write":
            actions = '["s3:PutObject", "s3:PutObjectAcl"]'
        elif operation == "list":
            actions = '["s3:ListBucket", "s3:GetObject"]'
        else:
            actions = '["s3:GetObject"]'
        return f'''\
{logs_statement}

  statement {{
    sid     = "S3Access"
    actions = {actions}
    resources = [
      "arn:aws:s3:::{bucket}",
      "arn:aws:s3:::{bucket}/*",
    ]
  }}'''

    if node_type == "tool_bedrock":
        operation = n.config.get("operation", "invoke_model")
        model_id = n.config.get("model_id", "")
        profile_arn = n.config.get("inference_profile_arn", "")
        agent_id = n.config.get("agent_id", "")
        effective = profile_arn if profile_arn else model_id
        if operation == "invoke_agent":
            return f'''\
{logs_statement}

  statement {{
    sid     = "BedrockAgent"
    actions = ["bedrock:InvokeAgent"]
    resources = ["arn:aws:bedrock:${{var.aws_region}}:*:agent/{agent_id}/*"]
  }}'''
        resource = effective if effective.startswith("arn:") else \
            f"arn:aws:bedrock:${{var.aws_region}}::foundation-model/{effective}"
        return f'''\
{logs_statement}

  statement {{
    sid     = "BedrockModel"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    resources = ["{resource}"]
  }}'''

    if node_type == "tool_http":
        auth = n.config.get("auth", {})
        secret_ref: str = auth.get("secret_ref", "")
        if secret_ref:
            secret_name = secret_ref.replace("secret://", "")
            return f'''\
{logs_statement}

  statement {{
    sid     = "SecretsManager"
    actions = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${{var.aws_region}}:*:secret:{secret_name}*"]
  }}'''

    if node_type == "tool_sagemaker_endpoint":
        endpoint_name = n.config.get("endpoint_name", "")
        return f'''\
{logs_statement}

  statement {{
    sid     = "SageMakerInvokeEndpoint"
    actions = ["sagemaker:InvokeEndpoint", "sagemaker:InvokeEndpointAsync"]
    resources = ["arn:aws:sagemaker:${{var.aws_region}}:*:endpoint/{endpoint_name}"]
  }}'''

    # tool_custom and fallback — logs only
    return logs_statement


def _gen_main_tf(agent_name: str) -> CompiledFile:
    content = f'''\
terraform {{
  required_version = ">= 1.9"

  backend "s3" {{
    # Configure via: terraform init -backend-config="bucket=<state-bucket>" \\
    #                              -backend-config="key={agent_name}/terraform.tfstate"
    dynamodb_table = "{agent_name}-tf-lock"
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


def _gen_variables_tf(agent_name: str) -> CompiledFile:
    content = f'''\
variable "agent_name" {{
  description = "Name of the agent (used as resource prefix)"
  type        = string
  default     = "{agent_name}"
}}

variable "environment" {{
  description = "Deployment environment"
  type        = string
  default     = "dev"
}}

variable "aws_region" {{
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}}

variable "ecr_image_uri" {{
  description = "ECR image URI for the AgentCore Runtime container"
  type        = string
}}

variable "agentcore_model_id" {{
  description = "Bedrock model ID for the agent"
  type        = string
  default     = "anthropic.claude-3-5-sonnet-20241022-v2:0"
}}

variable "agentcore_inference_profile_arn" {{
  description = "Cross-region inference profile ARN (takes precedence over model_id when set)"
  type        = string
  default     = ""
}}

variable "enable_memory" {{
  type    = bool
  default = false
}}

variable "memory_ttl_seconds" {{
  description = "AgentCore Memory event expiry duration in seconds"
  type        = number
  default     = 3600
}}

variable "latency_alarm_threshold_ms" {{
  type    = number
  default = 5000
}}

variable "cloudwatch_log_retention_days" {{
  type    = number
  default = 30
}}

# --- Network isolation -------------------------------------------------------
# Agents always run in a private VPC with no internet gateway and no NAT.

variable "create_vpc" {{
  description = "Generate an isolated VPC. Set false to use an existing VPC (then set existing_subnet_ids and existing_security_group_ids)."
  type        = bool
  default     = true
}}

variable "vpc_cidr" {{
  description = "CIDR for the generated VPC (used only when create_vpc = true)."
  type        = string
  default     = "10.0.0.0/16"
}}

variable "existing_vpc_id" {{
  description = "Existing VPC ID — used only when create_vpc = false."
  type        = string
  default     = ""
}}

variable "existing_subnet_ids" {{
  description = "Existing private subnet IDs for the agent — used only when create_vpc = false."
  type        = list(string)
  default     = []
}}

variable "existing_security_group_ids" {{
  description = "Existing security group IDs for the agent — used only when create_vpc = false."
  type        = list(string)
  default     = []
}}

variable "egress_allowlist_cidrs" {{
  description = "External CIDRs the agent security group may reach over HTTPS 443. Unreachable in the generated VPC (no NAT/IGW); effective only with an override VPC that provides an egress path."
  type        = list(string)
  default     = []
}}
'''
    return CompiledFile(path="infra/variables.tf", content=content)


def _gen_outputs_tf(has_memory: bool, has_mcp_server: bool) -> CompiledFile:
    memory_output = '''
output "memory_id" {
  description = "AgentCore Memory ID — set as MEMORY_ID env var on the Lambda"
  value       = try(aws_bedrockagentcore_memory.agent.memory_id, "")
}
''' if has_memory else ""

    gateway_output = '''
output "gateway_endpoint" {
  description = "AgentCore Gateway endpoint for MCP clients"
  value       = try(aws_bedrockagentcore_gateway.agent.gateway_endpoint, "")
}
''' if has_mcp_server else ""

    content = f'''\
output "api_gateway_url" {{
  description = "Public HTTP URL — POSTs to /invoke route the request to AgentCore Runtime."
  value       = aws_apigatewayv2_api.agent.api_endpoint
}}

output "ecr_repository_url" {{
  description = "ECR repository URL — push the agent container image here before deploy."
  value       = aws_ecr_repository.agent.repository_url
}}

output "agentcore_runtime_arn" {{
  description = "Bedrock AgentCore Runtime ARN — invoke directly via bedrock-agentcore:InvokeAgentRuntime (SigV4)."
  value       = aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn
}}

output "agentcore_runtime_endpoint" {{
  description = "AgentCore Runtime invoke endpoint — bypass API Gateway when using A2A or SigV4 clients."
  value       = try(aws_bedrockagentcore_agent_runtime.agent.agent_runtime_endpoint, "")
}}

output "vpc_id" {{
  description = "VPC hosting the agent (generated VPC, or the existing one when create_vpc = false)."
  value       = var.create_vpc ? try(aws_vpc.agent[0].id, "") : var.existing_vpc_id
}}

output "agent_subnet_ids" {{
  description = "Private subnet IDs the agent runtime and Lambdas are placed in."
  value       = local.agent_subnet_ids
}}
{memory_output}{gateway_output}'''
    return CompiledFile(path="infra/outputs.tf", content=content)


def _gen_iam_tf(
    agent_name: str,
    tool_nodes: list[Node],
    has_agentcore_features: bool,
    has_memory: bool,
) -> CompiledFile:
    tool_role_blocks = ""
    for n in tool_nodes:
        tool_name = n.config.get("name", n.id).lower().replace(" ", "-")
        policy_statements = _tool_policy_statements(n)
        tool_role_blocks += f'''
resource "aws_iam_role" "tool_{n.id}" {{
  name               = "${{var.agent_name}}-tool-{tool_name}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}}

resource "aws_iam_role_policy" "tool_{n.id}" {{
  role   = aws_iam_role.tool_{n.id}.id
  policy = data.aws_iam_policy_document.tool_{n.id}_policy.json
}}

data "aws_iam_policy_document" "tool_{n.id}_policy" {{
{policy_statements}
}}
'''

    agentcore_statement = '''
  statement {
    sid     = "AgentCore"
    actions = [
      "bedrock-agentcore:InvokeCodeInterpreter",
      "bedrock-agentcore:InvokeBrowser",
      "bedrock-agentcore:RetrieveMemories",
      "bedrock-agentcore:StoreMemories",
    ]
    resources = ["*"]
  }
''' if has_agentcore_features else ""

    memory_statement = '''
  statement {
    sid     = "AgentCoreMemory"
    actions = [
      "bedrock-agentcore:RetrieveMemories",
      "bedrock-agentcore:StoreMemories",
    ]
    resources = ["*"]
  }
''' if has_memory and not has_agentcore_features else ""

    content = f'''\
data "aws_iam_policy_document" "lambda_assume" {{
  statement {{
    actions = ["sts:AssumeRole"]
    principals {{
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }}
  }}
}}

# AgentCore Runtime execution role — assumed by the bedrock-agentcore service
# to run the agent container. This is the ONLY runtime role for the agent;
# there is no separate Lambda execution role for the agent itself.
data "aws_iam_policy_document" "agentcore_assume" {{
  statement {{
    actions = ["sts:AssumeRole"]
    principals {{
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }}
  }}
}}

resource "aws_iam_role" "agentcore_execution" {{
  name               = "${{var.agent_name}}-agentcore"
  assume_role_policy = data.aws_iam_policy_document.agentcore_assume.json
}}

resource "aws_iam_role_policy" "agentcore_execution" {{
  role   = aws_iam_role.agentcore_execution.id
  policy = data.aws_iam_policy_document.agent_policy.json
}}

data "aws_iam_policy_document" "agent_policy" {{
  statement {{
    sid     = "Bedrock"
    actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
    # Scoped to configured model — replace * with specific model ARNs before production
    resources = ["arn:aws:bedrock:${{var.aws_region}}::foundation-model/*"]
  }}

  statement {{
    sid       = "SecretsManager"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${{var.aws_region}}:*:secret:${{var.agent_name}}/*"]
  }}

  statement {{
    sid       = "CloudWatch"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }}

  # ENI management for VPC placement of the AgentCore Runtime (see vpc.tf).
  statement {{
    sid       = "VPCNetworking"
    actions   = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DeleteNetworkInterface"]
    resources = ["*"]
  }}
{agentcore_statement}{memory_statement}}}
{tool_role_blocks}'''
    return CompiledFile(path="infra/iam.tf", content=content)


def _gen_lambda_tf(agent_name: str, tool_nodes: list[Node]) -> CompiledFile:
    """Generates per-tool Lambda functions only.

    The agent itself runs on AgentCore Runtime (see agentcore.tf), not Lambda.
    Tool Lambdas remain because AgentCore has no generic 'custom function' primitive
    — each tool node still gets its own least-privilege Lambda.
    """
    tool_lambda_blocks = ""
    for n in tool_nodes:
        tool_name = n.config.get("name", n.id).lower().replace(" ", "-")
        mem = n.config.get("memory_mb", 256)
        timeout = n.config.get("timeout_seconds", 30)
        tool_lambda_blocks += f'''
resource "aws_lambda_function" "tool_{n.id}" {{
  function_name = "${{var.agent_name}}-tool-{tool_name}"
  role          = aws_iam_role.tool_{n.id}.arn
  image_uri     = var.ecr_image_uri
  package_type  = "Image"
  memory_size   = {mem}
  timeout       = {timeout}
  environment {{
    variables = {{
      AWS_REGION = var.aws_region
      AGENT_NAME = var.agent_name
    }}
  }}

  # Private VPC placement — no internet egress (see vpc.tf).
  vpc_config {{
    subnet_ids         = local.agent_subnet_ids
    security_group_ids = local.agent_security_group_ids
  }}
}}

resource "aws_cloudwatch_log_group" "tool_{n.id}" {{
  name              = "/aws/lambda/${{var.agent_name}}-tool-{tool_name}"
  retention_in_days = var.cloudwatch_log_retention_days
}}
'''

    content = f'''\
# Tool Lambdas — one per tool node, each with its own least-privilege IAM role.
# The agent itself does NOT run on Lambda; see agentcore.tf for the
# aws_bedrockagentcore_agent_runtime that hosts the agent container.
{tool_lambda_blocks if tool_lambda_blocks else "# No tool nodes in this graph — no tool Lambdas generated.\\n"}'''
    return CompiledFile(path="infra/lambda.tf", content=content)


def _gen_vpc_tf(agent_name: str) -> CompiledFile:
    """Private VPC with no internet egress for the agent runtime + tool Lambdas.

    Default (create_vpc=true): generates an isolated VPC with two private
    subnets, NO internet gateway and NO NAT gateway. AWS services are reached
    only through PrivateLink endpoints. Egress is default-deny; the agent
    security group permits HTTPS (443) to in-VPC endpoints and to any CIDRs
    in var.egress_allowlist_cidrs.

    Override (create_vpc=false): the customer supplies existing_subnet_ids and
    existing_security_group_ids; this file creates no networking. The customer
    is responsible for endpoints/routing in that VPC.

    The locals agent_subnet_ids / agent_security_group_ids are the single
    source of truth consumed by agentcore.tf and every Lambda's vpc_config.
    """
    content = '''\
# Private network for the agent. No internet gateway, no NAT — agents have
# no direct route to the internet. AWS services via PrivateLink endpoints.

data "aws_availability_zones" "available" {
  count = var.create_vpc ? 1 : 0
  state = "available"
}

resource "aws_vpc" "agent" {
  count                = var.create_vpc ? 1 : 0
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name        = "${var.agent_name}-vpc"
    AgentName   = var.agent_name
    Environment = var.environment
  }
}

resource "aws_subnet" "agent_private" {
  count             = var.create_vpc ? 2 : 0
  vpc_id            = aws_vpc.agent[0].id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone = data.aws_availability_zones.available[0].names[count.index]

  tags = {
    Name = "${var.agent_name}-private-${count.index}"
  }
}

# Route table with NO 0.0.0.0/0 route — confirms zero internet egress.
resource "aws_route_table" "agent_private" {
  count  = var.create_vpc ? 1 : 0
  vpc_id = aws_vpc.agent[0].id

  tags = {
    Name = "${var.agent_name}-private-rt"
  }
}

resource "aws_route_table_association" "agent_private" {
  count          = var.create_vpc ? 2 : 0
  subnet_id      = aws_subnet.agent_private[count.index].id
  route_table_id = aws_route_table.agent_private[0].id
}

# Agent security group — egress default-deny (no egress rules = deny all).
resource "aws_security_group" "agent" {
  count       = var.create_vpc ? 1 : 0
  name        = "${var.agent_name}-agent"
  description = "Agent runtime + tool Lambdas. Egress default-deny."
  vpc_id      = aws_vpc.agent[0].id

  tags = {
    Name = "${var.agent_name}-agent"
  }
}

# Egress: HTTPS to in-VPC PrivateLink interface endpoints.
resource "aws_security_group_rule" "agent_egress_vpc_https" {
  count             = var.create_vpc ? 1 : 0
  type              = "egress"
  security_group_id = aws_security_group.agent[0].id
  protocol          = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_blocks       = [var.vpc_cidr]
  description       = "HTTPS to in-VPC PrivateLink endpoints"
}

# Egress: HTTPS to explicitly allowlisted external CIDRs only.
# NOTE: in the default VPC (no NAT/IGW) these CIDRs have no route and remain
# unreachable. The allowlist takes effect only when an override VPC
# (create_vpc=false) supplies an egress path.
resource "aws_security_group_rule" "agent_egress_allowlist_https" {
  count             = var.create_vpc && length(var.egress_allowlist_cidrs) > 0 ? 1 : 0
  type              = "egress"
  security_group_id = aws_security_group.agent[0].id
  protocol          = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_blocks       = var.egress_allowlist_cidrs
  description       = "HTTPS to allowlisted external destinations"
}

# Security group for the VPC interface endpoints — accepts HTTPS from the VPC.
resource "aws_security_group" "vpce" {
  count       = var.create_vpc ? 1 : 0
  name        = "${var.agent_name}-vpce"
  description = "VPC interface endpoints — ingress HTTPS from within the VPC."
  vpc_id      = aws_vpc.agent[0].id

  tags = {
    Name = "${var.agent_name}-vpce"
  }
}

resource "aws_security_group_rule" "vpce_ingress_https" {
  count             = var.create_vpc ? 1 : 0
  type              = "ingress"
  security_group_id = aws_security_group.vpce[0].id
  protocol          = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_blocks       = [var.vpc_cidr]
  description       = "HTTPS from within the VPC"
}

locals {
  # Interface endpoints required so the agent reaches AWS APIs without internet:
  #   bedrock-runtime   — LLM invocation
  #   bedrock-agentcore — AgentCore Runtime/Memory/Gateway/Identity
  #   secretsmanager    — secret retrieval
  #   ecr.api / ecr.dkr — pull the agent container image
  #   logs              — CloudWatch Logs
  #   sts               — role assumption
  interface_endpoints = var.create_vpc ? toset([
    "bedrock-runtime",
    "bedrock-agentcore",
    "secretsmanager",
    "ecr.api",
    "ecr.dkr",
    "logs",
    "sts",
  ]) : toset([])
}

resource "aws_vpc_endpoint" "interface" {
  for_each            = local.interface_endpoints
  vpc_id              = aws_vpc.agent[0].id
  service_name        = "com.amazonaws.${var.aws_region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.agent_private[*].id
  security_group_ids  = [aws_security_group.vpce[0].id]
  private_dns_enabled = true

  tags = {
    Name = "${var.agent_name}-vpce-${each.value}"
  }
}

# Gateway endpoints — S3 (ECR image layers + artifacts) and DynamoDB.
resource "aws_vpc_endpoint" "s3" {
  count             = var.create_vpc ? 1 : 0
  vpc_id            = aws_vpc.agent[0].id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.agent_private[0].id]

  tags = {
    Name = "${var.agent_name}-vpce-s3"
  }
}

resource "aws_vpc_endpoint" "dynamodb" {
  count             = var.create_vpc ? 1 : 0
  vpc_id            = aws_vpc.agent[0].id
  service_name      = "com.amazonaws.${var.aws_region}.dynamodb"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.agent_private[0].id]

  tags = {
    Name = "${var.agent_name}-vpce-dynamodb"
  }
}

# Single source of truth for the network placement of the agent runtime and
# every Lambda. Generated VPC when create_vpc=true; customer-supplied IDs
# otherwise.
locals {
  agent_subnet_ids         = var.create_vpc ? aws_subnet.agent_private[*].id : var.existing_subnet_ids
  agent_security_group_ids = var.create_vpc ? [aws_security_group.agent[0].id] : var.existing_security_group_ids
}
'''
    return CompiledFile(path="infra/vpc.tf", content=content)


def _gen_agentcore_tf(agent_name: str) -> CompiledFile:
    content = f'''\
# Amazon Bedrock AgentCore Runtime — serverless managed agent execution.
# Hosts the agent container directly (no Lambda). Provides:
#   - A2A protocol invocation
#   - 8-hour managed sessions (replaces LangGraph DynamoDB checkpointer)
#   - Auto-scaling and request streaming
#   - Built-in CloudWatch GenAI Observability (replaces LangSmith)
# Requires aws provider >= 5.x with AgentCore feature flag enabled.

resource "aws_bedrockagentcore_agent_runtime" "agent" {{
  agent_runtime_name = var.agent_name

  agent_runtime_artifact {{
    container_configuration {{
      container_uri = var.ecr_image_uri
    }}
  }}

  # Private VPC placement — no internet egress. Subnets/SG resolved in vpc.tf
  # (generated VPC when create_vpc=true, else customer-supplied IDs).
  network_configuration {{
    network_mode = "VPC"

    vpc_config {{
      subnets         = local.agent_subnet_ids
      security_groups = local.agent_security_group_ids
    }}
  }}

  protocol_configuration {{
    server_protocol = "HTTP"
  }}

  environment_variables = {{
    AWS_REGION  = var.aws_region
    AGENT_NAME  = var.agent_name
    CACHE_TABLE = "${{var.agent_name}}-cache"
    MEMORY_ID   = try(aws_bedrockagentcore_memory.agent.memory_id, "")
    GATEWAY_ID  = try(aws_bedrockagentcore_gateway.agent.gateway_id, "")
  }}

  role_arn = aws_iam_role.agentcore_execution.arn
}}
'''
    return CompiledFile(path="infra/agentcore.tf", content=content)


def _gen_agentcore_gateway_tf(agent_name: str) -> CompiledFile:
    content = f'''\
# AgentCore Gateway — REST-to-MCP bridge for external tool consumers
resource "aws_bedrockagentcore_gateway" "agent" {{
  name     = "${{var.agent_name}}-gateway"
  role_arn = aws_iam_role.agentcore_execution.arn

  protocol_configuration {{
    server_protocol = "MCP"
  }}
}}

resource "aws_bedrockagentcore_gateway_target" "mcp_server" {{
  gateway_identifier = aws_bedrockagentcore_gateway.agent.gateway_id
  name               = "${{var.agent_name}}-mcp-server"

  endpoint_configuration {{
    lambda {{
      lambda_arn = aws_lambda_function.mcp_server.arn
    }}
  }}

  credential_provider_configurations = []
}}

resource "aws_iam_role" "mcp_server" {{
  name               = "${{var.agent_name}}-mcp-server"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}}

resource "aws_iam_role_policy" "mcp_server" {{
  role = aws_iam_role.mcp_server.id
  policy = jsonencode({{
    Version = "2012-10-17"
    Statement = [
      {{
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }},
      {{
        Effect   = "Allow"
        Action   = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DeleteNetworkInterface"]
        Resource = "*"
      }},
    ]
  }})
}}

resource "aws_lambda_function" "mcp_server" {{
  function_name = "${{var.agent_name}}-mcp-server"
  role          = aws_iam_role.mcp_server.arn
  image_uri     = var.ecr_image_uri
  package_type  = "Image"
  memory_size   = 256
  timeout       = 30

  environment {{
    variables = {{
      AWS_REGION = var.aws_region
      AGENT_NAME = var.agent_name
      MCP_SERVER = "true"
    }}
  }}

  # Private VPC placement — no internet egress (see vpc.tf).
  vpc_config {{
    subnet_ids         = local.agent_subnet_ids
    security_group_ids = local.agent_security_group_ids
  }}
}}

resource "aws_lambda_permission" "agentcore_gateway" {{
  statement_id  = "AllowAgentCoreGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mcp_server.function_name
  principal     = "bedrock-agentcore.amazonaws.com"
  source_arn    = aws_bedrockagentcore_gateway.agent.gateway_arn
}}
'''
    return CompiledFile(path="infra/agentcore_gateway.tf", content=content)


def _gen_agentcore_memory_tf(agent_name: str) -> CompiledFile:
    """AgentCore Memory resource with semantic + summarization + user-preference strategies.

    Strategies run async after each create_event:
      - SEMANTIC: extracts and embeds factual statements for vector retrieval
      - SUMMARIZATION: maintains rolling session summaries
      - USER_PREFERENCE: extracts stable preferences keyed on actor_id
    Memory ID is injected into the AgentCore Runtime container env (see agentcore.tf).
    """
    content = f'''\
resource "aws_bedrockagentcore_memory" "agent" {{
  name = "${{var.agent_name}}-memory"

  event_expiry_duration     = var.memory_ttl_seconds
  memory_execution_role_arn = aws_iam_role.agentcore_execution.arn

  # Long-term extraction strategies — run async on create_event.
  memory_strategies {{
    semantic_memory_strategy {{
      name        = "facts"
      description = "Extracts factual statements for semantic retrieval."
      namespaces  = ["default", "/actor/{{actorId}}"]
    }}
  }}

  memory_strategies {{
    summary_memory_strategy {{
      name        = "session_summary"
      description = "Rolling session summary."
      namespaces  = ["/session/{{sessionId}}"]
    }}
  }}

  memory_strategies {{
    user_preference_memory_strategy {{
      name        = "preferences"
      description = "Stable user preferences keyed on actor."
      namespaces  = ["/actor/{{actorId}}/preferences"]
    }}
  }}
}}
'''
    return CompiledFile(path="infra/agentcore_memory.tf", content=content)


def _gen_agentcore_identity_tf(agent_name: str, all_nodes: list[Node]) -> CompiledFile | None:
    """Generates OAuth2 credential providers for tool_http nodes using oauth2_client_credentials."""
    oauth2_nodes = [
        n for n in all_nodes
        if n.type == "tool_http"
        and n.config.get("auth", {}).get("type") == "oauth2_client_credentials"
    ]
    if not oauth2_nodes:
        return None

    blocks = ""
    for n in oauth2_nodes:
        tool_name = n.config.get("name", n.id).lower().replace(" ", "-")
        auth = n.config.get("auth", {})
        secret_ref = auth.get("secret_ref", "")
        secret_name = secret_ref.replace("secret://", "") if secret_ref else f"{agent_name}/{n.id}-oauth2"
        token_url = auth.get("oauth2", {}).get("token_url", "https://oauth.example.com/token")
        scope_str = auth.get("oauth2", {}).get("scope", "")
        scopes = ", ".join(f'"{s}"' for s in scope_str.split()) if scope_str else ""

        blocks += f'''
resource "aws_secretsmanager_secret" "oauth2_{n.id}" {{
  name = "{secret_name}"
  description = "OAuth2 client credentials for tool {tool_name}"
}}

resource "aws_bedrockagentcore_oauth2_credential_provider" "tool_{n.id}" {{
  name                    = "${{var.agent_name}}-{tool_name}-oauth2"
  credential_parameter_arn = aws_secretsmanager_secret.oauth2_{n.id}.arn

  oauth2_provider_config {{
    token_endpoint = "{token_url}"
    scopes         = [{scopes}]
  }}
}}
'''

    content = f'''\
# AgentCore Identity — OAuth2 credential providers for tool authentication
# Enables M2M token vending without storing long-lived credentials
{blocks}'''
    return CompiledFile(path="infra/agentcore_identity.tf", content=content)


def _gen_api_gateway_tf(agent_name: str) -> CompiledFile:
    """API Gateway HTTP API → AgentCore Runtime InvokeAgentRuntime.

    A thin invoker Lambda is created solely to translate API GW requests
    into bedrock-agentcore InvokeAgentRuntime calls. The agent itself
    runs on AgentCore Runtime, not Lambda. Direct callers can also invoke
    the AgentCore Runtime endpoint via SigV4 without going through API GW.
    """
    content = f'''\
resource "aws_apigatewayv2_api" "agent" {{
  name          = var.agent_name
  protocol_type = "HTTP"
}}

# Thin invoker Lambda — bridges API Gateway HTTP requests to
# bedrock-agentcore InvokeAgentRuntime. Stateless. Sub-100ms overhead.
resource "aws_lambda_function" "agentcore_invoker" {{
  function_name = "${{var.agent_name}}-invoker"
  role          = aws_iam_role.agentcore_invoker.arn
  runtime       = "python3.12"
  handler       = "invoker.handler"
  filename      = "${{path.module}}/invoker.zip"
  timeout       = 60
  memory_size   = 256

  environment {{
    variables = {{
      AGENT_RUNTIME_ARN = aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn
      AWS_REGION_NAME   = var.aws_region
    }}
  }}

  # Private VPC placement — no internet egress (see vpc.tf).
  vpc_config {{
    subnet_ids         = local.agent_subnet_ids
    security_group_ids = local.agent_security_group_ids
  }}
}}

resource "aws_iam_role" "agentcore_invoker" {{
  name               = "${{var.agent_name}}-invoker"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}}

resource "aws_iam_role_policy" "agentcore_invoker" {{
  role = aws_iam_role.agentcore_invoker.id
  policy = jsonencode({{
    Version = "2012-10-17"
    Statement = [
      {{
        Effect   = "Allow"
        Action   = ["bedrock-agentcore:InvokeAgentRuntime"]
        Resource = aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn
      }},
      {{
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }},
      {{
        Effect   = "Allow"
        Action   = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DeleteNetworkInterface"]
        Resource = "*"
      }},
    ]
  }})
}}

resource "aws_apigatewayv2_integration" "agent" {{
  api_id                 = aws_apigatewayv2_api.agent.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.agentcore_invoker.invoke_arn
  payload_format_version = "2.0"
}}

resource "aws_apigatewayv2_route" "invoke" {{
  api_id    = aws_apigatewayv2_api.agent.id
  route_key = "POST /invoke"
  target    = "integrations/${{aws_apigatewayv2_integration.agent.id}}"
}}

resource "aws_apigatewayv2_stage" "default" {{
  api_id      = aws_apigatewayv2_api.agent.id
  name        = "$default"
  auto_deploy = true
}}

resource "aws_lambda_permission" "api_gateway" {{
  statement_id  = "AllowAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.agentcore_invoker.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${{aws_apigatewayv2_api.agent.execution_arn}}/*/*"
}}
'''
    return CompiledFile(path="infra/api_gateway.tf", content=content)


def _gen_dynamodb_tf(agent_name: str, has_hitl: bool, has_memory: bool) -> CompiledFile:
    content = f'''\
resource "aws_dynamodb_table" "sessions" {{
  name         = "${{var.agent_name}}-sessions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {{
    name = "pk"
    type = "S"
  }}

  attribute {{
    name = "sk"
    type = "S"
  }}

  ttl {{
    attribute_name = "expires_at"
    enabled        = true
  }}
}}

resource "aws_dynamodb_table" "cache" {{
  name         = "${{var.agent_name}}-cache"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {{
    name = "pk"
    type = "S"
  }}

  ttl {{
    attribute_name = "expires_at"
    enabled        = true
  }}
}}
'''
    return CompiledFile(path="infra/dynamodb.tf", content=content)


def _gen_dev_tfvars(agent_name: str, has_memory: bool, has_mcp_server: bool) -> CompiledFile:
    memory_note = (
        "# After first apply: copy memory_id output → set as MEMORY_ID in Lambda env\n"
        if has_memory else ""
    )
    gateway_note = (
        "# After gateway deploy: copy gateway_endpoint output for MCP clients\n"
        if has_mcp_server else ""
    )

    content = f'''\
agent_name                      = "{agent_name}"
environment                     = "dev"
aws_region                      = "us-east-1"
ecr_image_uri                   = "<run 'terraform output ecr_repository_url' after first apply, then push image>"
agentcore_model_id              = "anthropic.claude-3-5-sonnet-20241022-v2:0"
agentcore_inference_profile_arn = ""
enable_memory                   = {"true" if has_memory else "false"}
memory_ttl_seconds              = 3600
latency_alarm_threshold_ms      = 5000
cloudwatch_log_retention_days   = 30
{memory_note}{gateway_note}# AgentCore Runtime hosts the agent container directly (no Lambda for the agent).
# Tool nodes (if any) and the API GW invoker are the only Lambdas in this stack.

# --- Network isolation -------------------------------------------------------
# The agent always runs in a private VPC with no internet gateway and no NAT.
# Default: Terraform generates an isolated VPC + PrivateLink endpoints.
create_vpc                      = true
vpc_cidr                        = "10.0.0.0/16"

# Override: use an existing VPC instead of generating one. Set create_vpc=false
# and provide the IDs below; the customer VPC must reach AWS APIs (endpoints/NAT).
# existing_vpc_id               = ""
# existing_subnet_ids           = []
# existing_security_group_ids   = []

# HTTPS 443 egress allowlist. NOTE: in the generated VPC there is no NAT/IGW, so
# external CIDRs are unreachable regardless. Tools needing the public internet
# (tool_http to external APIs, browser_tool, OAuth2 token_url) do NOT work in
# the generated VPC — use an override VPC with an egress path for those.
egress_allowlist_cidrs          = []
'''
    return CompiledFile(path="infra/dev.tfvars", content=content)
