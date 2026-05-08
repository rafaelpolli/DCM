"""Generates agent/config.py — environment variables and lazy secret fetching."""
from __future__ import annotations

from ..._types import CompiledFile
from ...models.graph import Project


def generate_config(project: Project) -> CompiledFile:
    agent_name = project.name.lower().replace(" ", "-")

    has_memory = any(
        n.config.get("memory", {}).get("enabled", False)
        for n in project.nodes if n.type == "agent"
    )
    has_gateway = project.has_node_type("mcp_server")

    memory_var = (
        'MEMORY_ID: str = os.environ.get("MEMORY_ID", "")\n'
        if has_memory else ""
    )
    gateway_var = (
        'GATEWAY_ID: str = os.environ.get("GATEWAY_ID", "")\n'
        if has_gateway else ""
    )

    content = f'''\
from __future__ import annotations

import functools
import os

import boto3

AWS_REGION: str = os.environ.get("AWS_REGION", "us-east-1")
AGENT_NAME: str = os.environ.get("AGENT_NAME", "{agent_name}")
CHECKPOINTER_TABLE: str = os.environ.get("CHECKPOINTER_TABLE", "{agent_name}-sessions")
CACHE_TABLE: str = os.environ.get("CACHE_TABLE", "{agent_name}-cache")
{memory_var}{gateway_var}

@functools.lru_cache(maxsize=None)
def get_secret(secret_name: str) -> str:
    """Fetch secret from Secrets Manager. Cached in-process after first call."""
    client = boto3.client("secretsmanager", region_name=AWS_REGION)
    response = client.get_secret_value(SecretId=secret_name)
    return response["SecretString"]
'''

    return CompiledFile(path="agent/config.py", content=content)
