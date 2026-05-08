"""Generates agent/runner.py — Bedrock AgentCore Runtime entrypoint.

Hosting model: the agent runs inside an AgentCore Runtime container
(aws_bedrockagentcore_agent_runtime). The container's process is
`python -m agent.runner`, which starts the BedrockAgentCoreApp HTTP
server. There is no Lambda handler — AgentCore manages 8-hour sessions,
auto-scaling, response streaming, A2A protocol, and observability.
"""
from __future__ import annotations

from ..._types import CompiledFile
from ...models.graph import Project


def generate_runner(project: Project) -> CompiledFile:
    has_streaming = any(
        n.config.get("streaming", False)
        for n in project.nodes if n.type == "agent"
    )

    streaming_entrypoint = ""
    if has_streaming:
        streaming_entrypoint = '''

@app.streaming_entrypoint
async def invoke_stream(payload: dict, session_context: dict):
    """AgentCore Runtime streaming handler — yields tokens via SSE.

    AgentCore Runtime handles transport, backpressure, and reconnection.
    """
    body = payload if isinstance(payload, dict) else {}
    session_id = session_context.get("session_id") or body.get("thread_id") or str(uuid.uuid4())
    actor_id = (
        session_context.get("actor_id")
        or session_context.get("user_id")
        or body.get("actor_id")
        or "anonymous"
    )
    thread_id = session_id
    config = {"configurable": {"thread_id": thread_id}}
    state = _build_initial_state(body, actor_id=actor_id, session_id=session_id)

    async for chunk in graph.astream(state, config=config, stream_mode="messages"):
        message, _ = chunk
        if hasattr(message, "content") and message.content:
            yield {"token": message.content, "thread_id": thread_id}
'''

    content = f'''\
"""AgentCore Runtime entrypoint for the generated agent.

Run locally:    python -m agent.runner
Run in Docker:  docker run -p 8080:8080 <image>
Deploy:         terraform apply (creates aws_bedrockagentcore_agent_runtime)
Invoke:         POST {{agentcore_runtime_url}}/invocations
"""
from __future__ import annotations

import json
import uuid

from langchain_core.messages import HumanMessage
from bedrock_agentcore.runtime import BedrockAgentCoreApp

from .graph import graph
from .state import AgentState

# AgentCore Runtime application — the only runtime entrypoint.
# Provides built-in HTTP server, session management, streaming, OTEL
# observability, and A2A protocol support.
app = BedrockAgentCoreApp()


def _build_initial_state(body: dict, actor_id: str, session_id: str) -> AgentState:
    """Builds initial AgentState. actor_id/session_id are surfaced for AgentCore Memory."""
    message = body.get("message", "")
    return AgentState(
        messages=[HumanMessage(content=message)] if message else [],
        actor_id=actor_id,
        session_id=session_id,
        **{{k: v for k, v in body.items() if k not in ("message", "thread_id", "actor_id", "session_id")}},
    )


@app.entrypoint
async def invoke(payload: dict, session_context: dict) -> dict:
    """AgentCore Runtime sync handler — invoked via A2A or AgentCore InvokeAgentRuntime."""
    body = payload if isinstance(payload, dict) else {{}}
    session_id = session_context.get("session_id") or body.get("thread_id") or str(uuid.uuid4())
    actor_id = (
        session_context.get("actor_id")
        or session_context.get("user_id")
        or body.get("actor_id")
        or "anonymous"
    )
    thread_id = session_id
    config = {{"configurable": {{"thread_id": thread_id}}}}
    state = _build_initial_state(body, actor_id=actor_id, session_id=session_id)

    result = await graph.ainvoke(state, config=config)

    final_output = result.get("final_output")
    if final_output is None:
        msgs = result.get("messages", [])
        final_output = msgs[-1].content if msgs else ""

    return {{"response": final_output, "thread_id": thread_id}}
{streaming_entrypoint}

if __name__ == "__main__":
    # AgentCore Runtime container entrypoint.
    # `app.run()` starts the HTTP server on 0.0.0.0:8080 by default.
    app.run()
'''
    return CompiledFile(path="agent/runner.py", content=content)
