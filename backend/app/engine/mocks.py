"""Mock data for demo / preview mode.

Activated via the MOCK_MODE env var (any truthy value: "1", "true", "yes").
When active, AWS-bound endpoints short-circuit to fixtures here instead of
calling boto3. Lets the platform run as a self-contained demo with no AWS
account, IAM role, or network calls to Bedrock/AgentCore.
"""
from __future__ import annotations

import os
import random
import time
from datetime import datetime, timedelta, timezone


def is_mock_mode() -> bool:
    return os.environ.get("MOCK_MODE", "").strip().lower() in {"1", "true", "yes", "on"}


# ── Agent catalog fixtures ───────────────────────────────────────────────────

_BASE_ARN = "arn:aws:bedrock-agentcore:us-east-1:123456789012:agent-runtime"

MOCK_AGENTS = [
    {
        "agent_runtime_id": "ar-mock-customer-support",
        "agent_runtime_arn": f"{_BASE_ARN}/ar-mock-customer-support",
        "name": "customer-support-agent",
        "status": "ACTIVE",
        "endpoint": "https://runtime.bedrock-agentcore.us-east-1.amazonaws.com/agent/ar-mock-customer-support",
        "created_at": "2026-04-12T10:23:00Z",
        "last_updated_at": "2026-05-08T14:11:00Z",
    },
    {
        "agent_runtime_id": "ar-mock-rag-docs",
        "agent_runtime_arn": f"{_BASE_ARN}/ar-mock-rag-docs",
        "name": "rag-docs-assistant",
        "status": "ACTIVE",
        "endpoint": "https://runtime.bedrock-agentcore.us-east-1.amazonaws.com/agent/ar-mock-rag-docs",
        "created_at": "2026-03-28T08:45:00Z",
        "last_updated_at": "2026-05-09T16:32:00Z",
    },
    {
        "agent_runtime_id": "ar-mock-sales-analyst",
        "agent_runtime_arn": f"{_BASE_ARN}/ar-mock-sales-analyst",
        "name": "sales-analyst",
        "status": "UPDATING",
        "endpoint": "https://runtime.bedrock-agentcore.us-east-1.amazonaws.com/agent/ar-mock-sales-analyst",
        "created_at": "2026-04-30T12:00:00Z",
        "last_updated_at": "2026-05-10T09:20:00Z",
    },
    {
        "agent_runtime_id": "ar-mock-hitl-approver",
        "agent_runtime_arn": f"{_BASE_ARN}/ar-mock-hitl-approver",
        "name": "hitl-approval-flow",
        "status": "ACTIVE",
        "endpoint": "https://runtime.bedrock-agentcore.us-east-1.amazonaws.com/agent/ar-mock-hitl-approver",
        "created_at": "2026-02-15T11:30:00Z",
        "last_updated_at": "2026-05-01T07:55:00Z",
    },
    {
        "agent_runtime_id": "ar-mock-multi-agent",
        "agent_runtime_arn": f"{_BASE_ARN}/ar-mock-multi-agent",
        "name": "multi-agent-coordinator",
        "status": "FAILED",
        "endpoint": None,
        "created_at": "2026-05-09T18:00:00Z",
        "last_updated_at": "2026-05-09T18:14:00Z",
    },
]


def list_agents() -> list[dict]:
    return [dict(a) for a in MOCK_AGENTS]


def get_agent_status(agent_runtime_id: str) -> dict | None:
    for a in MOCK_AGENTS:
        if a["agent_runtime_id"] == agent_runtime_id:
            raw = {
                "agentRuntimeId": a["agent_runtime_id"],
                "agentRuntimeArn": a["agent_runtime_arn"],
                "agentRuntimeName": a["name"],
                "status": a["status"],
                "agentRuntimeEndpoint": a["endpoint"] or "",
                "createdAt": a["created_at"],
                "lastUpdatedAt": a["last_updated_at"],
                "containerImage": "123456789012.dkr.ecr.us-east-1.amazonaws.com/" + a["name"] + ":latest",
                "memoryMb": "2048",
                "vCpu": "1.0",
            }
            return {
                "agent_runtime_id": a["agent_runtime_id"],
                "status": a["status"],
                "endpoint": a["endpoint"],
                "created_at": a["created_at"],
                "last_updated_at": a["last_updated_at"],
                "raw": {k: str(v) for k, v in raw.items()},
            }
    return None


# ── Invoke fixtures ──────────────────────────────────────────────────────────

_RESPONSE_TEMPLATES = {
    "ar-mock-customer-support": (
        "I checked our records for your query. Based on the order history available, "
        "your most recent shipment is currently in transit and scheduled to arrive within 2-3 business days. "
        "Let me know if you need the tracking number or have other questions."
    ),
    "ar-mock-rag-docs": (
        "According to the documentation, the answer to your question is: {q}. "
        "This is grounded in section 4.2 of the architecture guide and the API reference. "
        "If you need more depth on any specific area, ask a follow-up."
    ),
    "ar-mock-sales-analyst": (
        "Looking at the sales data, the trend you asked about shows a 12.4% quarter-over-quarter increase. "
        "Top contributing segments: enterprise (+18%), mid-market (+9%). "
        "Recommend doubling down on enterprise pipeline next quarter."
    ),
    "ar-mock-hitl-approver": (
        "Draft prepared for human review. Awaiting approval from the configured reviewer (24h timeout). "
        "On approval, the response will be: \"Yes, the requested change is within policy.\""
    ),
    "ar-mock-multi-agent": (
        "[Coordinator] routing to specialist... [Researcher] gathering data... [Writer] composing response. "
        "Final output: synthesized answer combining research and structured presentation."
    ),
}


def invoke_agent(agent_runtime_arn: str, input_text: str, session_id: str) -> dict:
    runtime_id = agent_runtime_arn.rsplit("/", 1)[-1]
    template = _RESPONSE_TEMPLATES.get(runtime_id)
    if template is None:
        # Fallback for unknown ARN
        text = (
            f"[Mock agent {runtime_id}] Echo response to your input: \"{input_text[:120]}\". "
            f"Replace MOCK_MODE=false to invoke the real deployed agent."
        )
    else:
        text = template.format(q=input_text[:80])

    # Simulate latency for realism
    base_latency = random.randint(180, 850)
    time.sleep(base_latency / 1000.0)
    return {
        "response_text": text,
        "latency_ms": base_latency + random.randint(0, 50),
        "session_id": session_id,
        "raw": {"content_type": "application/json", "status_code": "200", "mock": "true"},
    }


# ── Traces fixtures ──────────────────────────────────────────────────────────

_SPAN_TYPES = ["agent.invoke", "tool.call", "llm.completion", "memory.retrieve", "kb.search"]


def query_traces(agent_name: str, minutes: int) -> dict:
    now = datetime.now(timezone.utc)
    spans = []
    rng = random.Random(hash(agent_name) & 0xFFFF)
    n = rng.randint(8, 24)
    for i in range(n):
        ts = now - timedelta(minutes=rng.randint(0, max(1, minutes)))
        span_type = rng.choice(_SPAN_TYPES)
        duration = rng.randint(40, 1800)
        spans.append({
            "timestamp": ts.isoformat(timespec="seconds").replace("+00:00", "Z"),
            "span_type": span_type,
            "message": f'{{"span_type":"{span_type}","trace_id":"mock-{i:04x}","duration_ms":{duration}}}',
            "duration_ms": duration,
        })
    spans.sort(key=lambda s: s["timestamp"], reverse=True)
    return {
        "spans": spans,
        "log_group": f"/aws/bedrock/agentcore/{agent_name}",
        "query_window_minutes": minutes,
    }


# ── Preview (Bedrock InvokeModel) fixture ────────────────────────────────────

def preview_node(model_id: str, input_text: str) -> dict:
    base_latency = random.randint(220, 760)
    time.sleep(base_latency / 1000.0)
    text = (
        f"[Mock {model_id}] Reply to: \"{input_text[:120]}\".\n"
        "This is mock output for demo purposes. Configure real AWS credentials and "
        "unset MOCK_MODE to invoke Bedrock for real."
    )
    in_tokens = max(1, len(input_text.split()))
    out_tokens = max(1, len(text.split()))
    return {
        "response": text,
        "input_tokens": in_tokens,
        "output_tokens": out_tokens,
        "latency_ms": base_latency,
    }
