"""Phase 5: Local Runner Scaffold — generates local/ scripts and Dockerfile."""
from __future__ import annotations

import json

from .._types import CompiledArtifacts, CompiledFile
from ..models.graph import Node, Project


def generate_local_scaffold(project: Project) -> CompiledArtifacts:
    artifacts = CompiledArtifacts()
    agent_name = project.name.lower().replace(" ", "-")

    artifacts.add(_gen_run_agent(agent_name))
    artifacts.add(_gen_run_workflow(agent_name))
    artifacts.add(_gen_mock_tools(project))
    artifacts.add(_gen_dockerfile(agent_name))
    artifacts.add(_gen_pyproject(agent_name))
    artifacts.add(_gen_env_example(project))
    artifacts.add(_gen_deploy_notebook(agent_name))

    return artifacts


def _gen_run_agent(agent_name: str) -> CompiledFile:
    content = f'''\
#!/usr/bin/env python
"""Local agent runner for {agent_name}.

Usage:
  uv run python local/run_agent.py --input '{{"message": "Hello"}}' [--mock-tools]
  AWS_PROFILE=dev uv run python local/run_agent.py --input '{{"message": "Hello"}}'

This script invokes the AgentCore entrypoint in-process. To exercise the
full HTTP server locally, run `python -m agent.runner` and POST to it.
"""
import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


async def _invoke(payload: dict) -> dict:
    from agent.runner import invoke
    return await invoke(payload, {{"session_id": payload.get("thread_id", "local-session")}})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="JSON input payload")
    parser.add_argument("--mock-tools", action="store_true", help="Replace tool calls with mocks")
    args = parser.parse_args()

    payload = json.loads(args.input)

    if args.mock_tools:
        from local.mock_tools import patch_tools
        patch_tools()

    result = asyncio.run(_invoke(payload))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
'''
    return CompiledFile(path="local/run_agent.py", content=content)


def _gen_run_workflow(agent_name: str) -> CompiledFile:
    content = f'''\
#!/usr/bin/env python
"""Local workflow runner for {agent_name}.

Usage:
  uv run python local/run_workflow.py --input-file local/sample_input.json
"""
import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))


async def _invoke(payload: dict) -> dict:
    from agent.runner import invoke
    return await invoke(payload, {{"session_id": payload.get("thread_id", "local-session")}})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-file", required=True)
    args = parser.parse_args()

    with open(args.input_file) as f:
        payload = json.load(f)

    result = asyncio.run(_invoke(payload))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
'''
    return CompiledFile(path="local/run_workflow.py", content=content)


def _gen_mock_tools(project: Project) -> CompiledFile:
    tool_mocks = []
    for n in project.nodes:
        if n.is_tool():
            fn = n.config.get("name", f"tool_{n.id}").replace("-", "_").lower()
            tool_mocks.append(
                f'    monkeypatch_module("agent.tools.{n.id}", "{fn}", lambda **kw: {{"mocked": True}})'
            )

    mock_body = "\n".join(tool_mocks) if tool_mocks else "    pass"

    content = f'''\
"""Mock tool implementations for local testing without AWS."""
import importlib
from unittest.mock import MagicMock


def monkeypatch_module(module_path: str, fn_name: str, replacement):
    try:
        mod = importlib.import_module(module_path)
        mock = MagicMock(side_effect=replacement)
        mock.invoke = replacement
        setattr(mod, fn_name, mock)
    except ImportError:
        pass


def patch_tools():
{mock_body}
'''
    return CompiledFile(path="local/mock_tools.py", content=content)


def _gen_dockerfile(agent_name: str) -> CompiledFile:
    content = '''\
# Bedrock AgentCore Runtime container.
# Build: docker build -t <agent> .
# Push:  docker tag <agent>:latest <ecr-uri>:latest && docker push <ecr-uri>:latest
# AgentCore Runtime invokes the container's HTTP server on port 8080.
FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY pyproject.toml .
RUN uv pip install --system --no-cache .

COPY . .

ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

EXPOSE 8080

# AgentCore Runtime entrypoint — BedrockAgentCoreApp.run() listens on 0.0.0.0:8080
CMD ["python", "-m", "agent.runner"]
'''
    return CompiledFile(path="Dockerfile", content=content)


def _gen_pyproject(agent_name: str) -> CompiledFile:
    content = f'''\
[project]
name = "{agent_name}"
version = "0.1.0"
requires-python = ">=3.12"

dependencies = [
    "langgraph>=0.2",
    "langgraph-supervisor>=0.0.5",
    "langchain>=0.3",
    "langchain-aws>=0.2",
    "langchain-community>=0.3",
    "boto3>=1.35",
    "pydantic>=2.0",
    "jmespath>=1.0",
    "celpy>=0.1.5",
    "httpx>=0.27",
    "bedrock-agentcore>=0.1",
    "langchain-mcp-adapters>=0.1",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "moto[all]>=5.0",
    "responses>=0.25",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["agent", "tools"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
'''
    return CompiledFile(path="pyproject.toml", content=content)


def _gen_env_example(project: Project) -> CompiledFile:
    agent_name = project.name.lower().replace(" ", "-")
    has_memory = any(
        n.config.get("memory", {}).get("enabled", False)
        for n in project.nodes if n.type == "agent"
    )
    has_gateway = project.has_node_type("mcp_server")
    has_hitl = project.has_node_type("human_in_the_loop")
    has_cache = project.has_node_type("cache")

    optional_lines = []
    if has_memory:
        optional_lines.append("MEMORY_ID=  # populated from Terraform output 'memory_id'")
    if has_gateway:
        optional_lines.append("GATEWAY_ID=  # populated from Terraform output 'gateway_endpoint'")
    if has_hitl:
        optional_lines.append(f"CHECKPOINTER_TABLE={agent_name}-sessions")
    if has_cache:
        optional_lines.append(f"CACHE_TABLE={agent_name}-cache")

    optional = "\n".join(optional_lines)
    optional_block = f"\n# AgentCore Runtime injects these at deploy time; set manually for local runs.\n{optional}\n" if optional else ""

    content = f'''\
# Copy to .env and fill in real values before running locally.
# Never commit .env — this file contains only placeholder values.
#
# Observability is provided by AgentCore Observability when the agent runs
# inside an AgentCore Runtime container. No external SaaS keys required.

AWS_REGION=us-east-1
AWS_PROFILE=your-dev-profile
AGENT_NAME={agent_name}
{optional_block}'''
    return CompiledFile(path=".env.example", content=content)


def _gen_deploy_notebook(agent_name: str) -> CompiledFile:
    """Generates deploy-sagemaker.ipynb at the ZIP root.

    The notebook is runnable inside SageMaker Studio in the customer's AWS
    account. It installs Terraform, bootstraps remote state, builds the agent
    container image via CodeBuild (sm-docker), and applies the Terraform in
    infra/ to deploy the agent to AgentCore Runtime.
    """

    def code(src: str) -> dict:
        return {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {},
            "outputs": [],
            "source": src,
        }

    def md(src: str) -> dict:
        return {"cell_type": "markdown", "metadata": {}, "source": src}

    config_cell = '''\
# --- Configuracao -----------------------------------------------------------
import boto3, pathlib, subprocess, sys, os

REGION     = "us-east-1"          # ajuste se necessario (precisa ter Bedrock/AgentCore)
AGENT_NAME = "__AGENT_NAME__"
IMAGE_TAG  = "latest"

ACCOUNT_ID = boto3.client("sts", region_name=REGION).get_caller_identity()["Account"]

# Este notebook esta na raiz do projeto do agente; infra/ e um subdiretorio.
ROOT   = pathlib.Path.cwd()
TF_DIR = ROOT / "infra"

STATE_BUCKET = f"{AGENT_NAME}-tfstate-{ACCOUNT_ID}"
LOCK_TABLE   = f"{AGENT_NAME}-tf-lock"   # ja referenciado em infra/main.tf

def run(cmd, cwd=None):
    """Executa um comando de shell, faz stream da saida e falha em returncode != 0."""
    print(f"$ {cmd}")
    r = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    if r.stdout:
        print(r.stdout)
    if r.returncode != 0:
        print(r.stderr)
        raise RuntimeError(f"comando falhou (exit {r.returncode}): {cmd}")
    return r.stdout

print("account:", ACCOUNT_ID, "| region:", REGION, "| agent:", AGENT_NAME)
assert TF_DIR.exists(), f"infra/ nao encontrado em {TF_DIR}"
'''.replace("__AGENT_NAME__", agent_name)

    cells = [
        md(
            "# Deploy do agente `" + agent_name + "` na AWS\n"
            "\n"
            "Notebook executavel de dentro de um **SageMaker Studio** da conta AWS "
            "alvo. Deploya este agente ponta a ponta: builda a imagem do container, "
            "publica no ECR e aplica o Terraform de `infra/`, que cria o "
            "**Bedrock AgentCore Runtime**, as Lambdas de tool e o API Gateway.\n"
            "\n"
            "Rode as celulas em ordem, de cima para baixo."
        ),
        md(
            "## Pre-requisitos\n"
            "\n"
            "1. **Execution role do SageMaker** com permissao para criar a infra do "
            "agente (AgentCore, Lambda, IAM, API Gateway, ECR, VPC, DynamoDB).\n"
            "2. O build da imagem usa `sagemaker-studio-image-build`, que delega ao "
            "**AWS CodeBuild** (o Studio classico nao tem daemon Docker). O role "
            "precisa de permissoes de CodeBuild + ECR.\n"
            "3. **Bedrock e AgentCore habilitados** na regiao escolhida.\n"
            "4. Os arquivos deste ZIP de agente extraidos no Studio; este notebook "
            "esta na raiz, ao lado de `infra/` e do `Dockerfile`."
        ),
        code(config_cell),
        code(
            "# --- Instalar o binario do Terraform ---------------------------------------\n"
            "import urllib.request, zipfile\n"
            "\n"
            'TF_VERSION = "1.9.8"\n'
            'bindir = pathlib.Path.home() / "bin"\n'
            "bindir.mkdir(exist_ok=True)\n"
            "\n"
            'if not (bindir / "terraform").exists():\n'
            '    url = (f"https://releases.hashicorp.com/terraform/{TF_VERSION}/"\n'
            '           f"terraform_{TF_VERSION}_linux_amd64.zip")\n'
            '    urllib.request.urlretrieve(url, "/tmp/terraform.zip")\n'
            '    with zipfile.ZipFile("/tmp/terraform.zip") as z:\n'
            "        z.extractall(bindir)\n"
            '    os.chmod(bindir / "terraform", 0o755)\n'
            "\n"
            'os.environ["PATH"] = f"{bindir}:{os.environ[\'PATH\']}"\n'
            'run("terraform version")'
        ),
        code(
            "# --- Instalar tooling de build ---------------------------------------------\n"
            "# sagemaker-studio-image-build: builda a imagem do agente via CodeBuild.\n"
            'run(f"{sys.executable} -m pip install --quiet sagemaker-studio-image-build")'
        ),
        code(
            "# --- Bootstrap do state remoto do Terraform (S3 + DynamoDB) ----------------\n"
            's3  = boto3.client("s3", region_name=REGION)\n'
            'ddb = boto3.client("dynamodb", region_name=REGION)\n'
            "\n"
            "try:\n"
            '    if REGION == "us-east-1":\n'
            "        s3.create_bucket(Bucket=STATE_BUCKET)\n"
            "    else:\n"
            "        s3.create_bucket(Bucket=STATE_BUCKET,\n"
            '                         CreateBucketConfiguration={"LocationConstraint": REGION})\n'
            '    print("bucket de state criado:", STATE_BUCKET)\n'
            "except s3.exceptions.BucketAlreadyOwnedByYou:\n"
            '    print("bucket de state ja existe:", STATE_BUCKET)\n'
            "\n"
            "s3.put_bucket_versioning(Bucket=STATE_BUCKET,\n"
            '                         VersioningConfiguration={"Status": "Enabled"})\n'
            "\n"
            "try:\n"
            "    ddb.create_table(TableName=LOCK_TABLE,\n"
            '                     AttributeDefinitions=[{"AttributeName": "LockID", "AttributeType": "S"}],\n'
            '                     KeySchema=[{"AttributeName": "LockID", "KeyType": "HASH"}],\n'
            '                     BillingMode="PAY_PER_REQUEST")\n'
            '    ddb.get_waiter("table_exists").wait(TableName=LOCK_TABLE)\n'
            '    print("tabela de lock criada:", LOCK_TABLE)\n'
            "except ddb.exceptions.ResourceInUseException:\n"
            '    print("tabela de lock ja existe:", LOCK_TABLE)'
        ),
        code(
            "# --- terraform init --------------------------------------------------------\n"
            "# A infra/main.tf do agente declara backend \"s3\"; bucket/key/region vem aqui.\n"
            "run(f'terraform init -reconfigure '\n"
            "    f'-backend-config=\"bucket={STATE_BUCKET}\" '\n"
            "    f'-backend-config=\"key={AGENT_NAME}/terraform.tfstate\" '\n"
            "    f'-backend-config=\"region={REGION}\"', cwd=TF_DIR)\n"
            'run("terraform validate", cwd=TF_DIR)'
        ),
        code(
            "# --- Fase A: criar so o ECR (a imagem precisa de um destino antes do build) -\n"
            'run("terraform apply -auto-approve -var-file=dev.tfvars "\n'
            '    "-target=aws_ecr_repository.agent "\n'
            '    "-target=aws_ecr_lifecycle_policy.agent", cwd=TF_DIR)\n'
            "\n"
            'ECR_URL = run("terraform output -raw ecr_repository_url", cwd=TF_DIR).strip()\n'
            'print("ECR repo:", ECR_URL)'
        ),
        code(
            "# --- Build da imagem do agente (CodeBuild via sm-docker) -------------------\n"
            "# Contexto = raiz do projeto; o Dockerfile ja esta presente.\n"
            'run(f"sm-docker build . --repository {AGENT_NAME}:{IMAGE_TAG} "\n'
            '    f"--region {REGION}", cwd=ROOT)\n'
            "\n"
            'IMAGE_URI = f"{ECR_URL}:{IMAGE_TAG}"\n'
            'print("imagem do agente:", IMAGE_URI)'
        ),
        code(
            "# --- Fase B: apply completo (AgentCore Runtime, Lambdas, API Gateway) ------\n"
            'run(f"terraform apply -auto-approve -var-file=dev.tfvars "\n'
            '    f\'-var ecr_image_uri={IMAGE_URI}\', cwd=TF_DIR)'
        ),
        code(
            "# --- Coletar outputs -------------------------------------------------------\n"
            "import json\n"
            'out = json.loads(run("terraform output -json", cwd=TF_DIR))\n'
            'API_URL = out["api_gateway_url"]["value"]\n'
            'RUNTIME_ARN = out["agentcore_runtime_arn"]["value"]\n'
            'print("API Gateway   :", API_URL)\n'
            'print("AgentCore ARN :", RUNTIME_ARN)'
        ),
        code(
            "# --- Smoke test ------------------------------------------------------------\n"
            "# POST /invoke no API Gateway. Ajuste o payload ao input esperado pelo agente.\n"
            "import urllib.request, json, time\n"
            "\n"
            'payload = json.dumps({"message": "ping"}).encode()\n'
            'req = urllib.request.Request(f"{API_URL}/invoke", data=payload,\n'
            '                             headers={"Content-Type": "application/json"},\n'
            '                             method="POST")\n'
            "for attempt in range(6):\n"
            "    try:\n"
            "        body = urllib.request.urlopen(req, timeout=30).read().decode()\n"
            '        print("OK:", body)\n'
            "        break\n"
            "    except Exception as e:\n"
            '        print(f"[{attempt + 1}/6] aguardando o runtime subir... ({e})")\n'
            "        time.sleep(30)\n"
            "\n"
            'print("\\nAgente publicado:", API_URL)'
        ),
        md(
            "## Teardown\n"
            "\n"
            "A celula abaixo **destroi toda a infra deste agente**. Esta comentada de "
            "proposito — descomente e execute apenas quando quiser remover tudo.\n"
            "\n"
            "O bucket de state do Terraform e a tabela de lock **nao** sao removidos "
            "por `terraform destroy`; apague-os manualmente depois, se desejar."
        ),
        code(
            "# CUIDADO: remove AgentCore Runtime, Lambdas, API Gateway, IAM e ECR.\n"
            '# run("terraform destroy -auto-approve -var-file=dev.tfvars", cwd=TF_DIR)'
        ),
    ]

    notebook = {
        "cells": cells,
        "metadata": {
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3",
            },
            "language_info": {"name": "python", "version": "3.12"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }

    return CompiledFile(
        path="deploy-sagemaker.ipynb",
        content=json.dumps(notebook, indent=1, ensure_ascii=False),
    )
