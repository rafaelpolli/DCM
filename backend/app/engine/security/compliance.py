"""LGPD/GDPR compliance checklist evaluation per agent."""
from __future__ import annotations

from .. import storage


SECURITY_NODE_TYPES = {"pii_filter", "output_validator", "prompt_firewall"}


def latest_pass_rate(arn: str, suite: str) -> float | None:
    runs = storage.list_probe_runs(arn, suite, limit=1)
    if not runs:
        return None
    return runs[0].get("pass_rate")


def has_recent_conversations(arn: str) -> bool:
    return len(storage.list_conversations(arn, limit=1)) > 0


def check(
    agent_runtime_arn: str,
    project: dict | None = None,
    latest_injection_pass_rate: float | None = None,
    conversations_logged: bool = False,
) -> dict:
    """Returns checklist with per-item pass/fail."""
    nodes = []
    if project and isinstance(project, dict):
        nodes = project.get("nodes", []) or []
    node_types = {n.get("type") for n in nodes if isinstance(n, dict)}
    agent_node = next((n for n in nodes if n.get("type") == "agent"), None)
    guardrail_id = ""
    if agent_node:
        guardrail_id = (agent_node.get("config", {}).get("guardrails", {}) or {}).get("guardrail_id", "")

    items = [
        {
            "id": "pii_filter",
            "title": "PII filter node present in graph",
            "passed": "pii_filter" in node_types,
        },
        {
            "id": "guardrails",
            "title": "Bedrock Guardrails configured",
            "passed": bool(guardrail_id),
        },
        {
            "id": "output_validator",
            "title": "Output validator node present",
            "passed": "output_validator" in node_types,
        },
        {
            "id": "prompt_firewall",
            "title": "Prompt firewall node present",
            "passed": "prompt_firewall" in node_types,
        },
        {
            "id": "injection_resilience",
            "title": "Recent prompt-injection suite pass-rate > 80%",
            "passed": (latest_injection_pass_rate or 0.0) >= 0.80,
            "detail": f"latest pass_rate={latest_injection_pass_rate}" if latest_injection_pass_rate is not None else "no run yet",
        },
        {
            "id": "conversations_logged",
            "title": "Conversation logging active (audit trail)",
            "passed": conversations_logged,
        },
    ]

    score = sum(1 for i in items if i["passed"])
    return {
        "agent_runtime_arn": agent_runtime_arn,
        "items": items,
        "score": score,
        "total": len(items),
        "compliant": score == len(items),
    }
