"""Phase 5: Local Runner Scaffold — generates local/ scripts and Dockerfile."""
from __future__ import annotations

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
