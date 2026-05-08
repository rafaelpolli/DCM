"""Phase 6: Observability Injector — AgentCore Observability + CloudWatch helpers.

AgentCore Runtime auto-emits OpenTelemetry traces, GenAI spans, and metrics
to CloudWatch GenAI Observability when the bedrock-agentcore SDK is imported
inside a Runtime container. No SDK keys required.
"""
from __future__ import annotations

from .._types import CompiledArtifacts, CompiledFile
from ..models.graph import Project

_AGENTCORE_OBS_BLOCK = '''\
"""AgentCore Observability bootstrap.

When this module is imported inside an AgentCore Runtime container, the SDK
auto-instruments LangGraph/LangChain calls and ships OTEL traces + GenAI
spans to Amazon CloudWatch GenAI Observability. No external SaaS required.
"""
import os

from bedrock_agentcore.observability import configure as _configure_observability

_AGENT_NAME = os.environ.get("AGENT_NAME", "agent")

_configure_observability(
    service_name=_AGENT_NAME,
    enable_genai_spans=True,
    enable_langchain_instrumentation=True,
)
'''

_CLOUDWATCH_BLOCK = '''\
import json
import logging

import boto3

_log = logging.getLogger(_AGENT_NAME)
_cw = boto3.client("cloudwatch", region_name=os.environ.get("AWS_REGION", "us-east-1"))


def emit_metric(name: str, value: float, unit: str = "Milliseconds") -> None:
    """Emit a custom CloudWatch metric. Never raises — observability must not break the agent."""
    try:
        _cw.put_metric_data(
            Namespace=f"AgentsPlatform/{_AGENT_NAME}",
            MetricData=[{
                "MetricName": name,
                "Value": value,
                "Unit": unit,
                "Dimensions": [{"Name": "AgentName", "Value": _AGENT_NAME}],
            }],
        )
    except Exception:
        pass


def log_event(level: str, event: str, **fields) -> None:
    """Emit a structured CloudWatch log line."""
    payload = {"event": event, "agent": _AGENT_NAME, **fields}
    getattr(_log, level.lower(), _log.info)(json.dumps(payload))
'''


def inject_observability(project: Project, artifacts: CompiledArtifacts) -> CompiledArtifacts:
    """Adds agent/observability.py and prepends side-effect import to runner.py."""
    content = _AGENTCORE_OBS_BLOCK + "\n" + _CLOUDWATCH_BLOCK
    artifacts.add(CompiledFile(path="agent/observability.py", content=content))

    runner_path = "agent/runner.py"
    if runner_path in artifacts.files:
        existing = artifacts.files[runner_path]
        injected = "import agent.observability  # noqa: F401 — side-effect import\n" + existing
        artifacts.files[runner_path] = injected

    return artifacts
