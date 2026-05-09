"""Generates agent/nodes/{node_id}.py for non-tool, non-KB nodes."""
from __future__ import annotations

from ..._types import CompiledFile
from ...models.graph import Edge, Node, Project
from .state_gen import _state_key


def generate_node(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile | None:
    """Returns a CompiledFile for this node, or None if no node function needed."""
    dispatch = {
        "agent": _gen_agent,
        "multi_agent_coordinator": _gen_coordinator,
        "human_in_the_loop": _gen_hitl,
        "condition": _gen_condition,
        "loop": _gen_loop,
        "cache": _gen_cache,
        "logger": _gen_logger,
        "input": None,    # entry point — no node function; handled by graph entry
        "output": _gen_output,
        "kb_s3_vector": _gen_kb_s3_vector,
        "kb_bedrock": _gen_kb_bedrock,
        "retriever": _gen_retriever,
        "chunking": _gen_passthrough,
        "embedding": _gen_passthrough,
        "document_parser": _gen_passthrough,
        "s3_source": _gen_passthrough,
        "ingest_pipeline": _gen_passthrough,
        "mcp_client": _gen_mcp_client,
        "mcp_server": _gen_mcp_server,   # generates mcp_server/server.py
        "code_interpreter": _gen_code_interpreter,
        "browser_tool": _gen_browser_tool,
    }
    generator = dispatch.get(node.type)
    if generator is None:
        return None
    return generator(node, project, node_map)


def _first_input_key(node: Node, edges: list[Edge]) -> str:
    """State key for this node's first input edge."""
    incoming = [e for e in edges if e.target_node_id == node.id]
    if incoming:
        e = incoming[0]
        return _state_key(e.source_node_id, e.source_port_id)
    return "messages"


def _gen_agent(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    model_id = node.config.get("model_id", "")
    profile_arn = node.config.get("inference_profile_arn", "")
    effective_model = profile_arn if profile_arn else model_id

    system_prompt = node.config.get("system_prompt", "You are a helpful assistant.").replace('"', '\\"')
    temperature = node.config.get("temperature", 0.7)
    max_tokens = node.config.get("max_tokens", 4096)
    streaming = node.config.get("streaming", False)
    nid = node.id
    memory_enabled = node.config.get("memory", {}).get("enabled", False)

    guardrails = node.config.get("guardrails", {})
    guardrail_config = ""
    if guardrails.get("guardrail_id"):
        gid = guardrails["guardrail_id"]
        gver = guardrails.get("guardrail_version", "DRAFT")
        guardrail_config = f', guardrails={{"guardrailIdentifier": "{gid}", "guardrailVersion": "{gver}"}}'

    response_key = _state_key(nid, "response")
    tool_calls_key = _state_key(nid, "tool_calls")

    if memory_enabled:
        memory_cfg = node.config.get("memory", {})
        namespace = memory_cfg.get("namespace", "default")
        top_k = memory_cfg.get("top_k", 5)
        content = f'''\
import logging

from langchain_aws import ChatBedrock
from langgraph.prebuilt import create_react_agent
from bedrock_agentcore.memory import MemoryClient

from ..config import AWS_REGION, MEMORY_ID
from ..state import AgentState
from ..tools import get_tools_for_agent

_log = logging.getLogger(__name__)

_model = ChatBedrock(
    model_id="{effective_model}",
    model_kwargs={{"temperature": {temperature}, "max_tokens": {max_tokens}}}{guardrail_config},
    streaming={streaming},
)
_memory = MemoryClient(region_name=AWS_REGION) if MEMORY_ID else None
_base_prompt = "{system_prompt}"
_NAMESPACE = "{namespace}"
_TOP_K = {top_k}


def _format_memories(records: list[dict]) -> str:
    """Flattens AgentCore retrieve_memories records into prompt-friendly bullets."""
    lines = []
    for r in records:
        content = r.get("content") or {{}}
        text = content.get("text") if isinstance(content, dict) else str(content)
        if text:
            lines.append(f"- {{text}}")
    return "\\n".join(lines)


async def node_{nid}(state: AgentState) -> dict:
    query_msgs = state.get("messages", [])
    query_text = query_msgs[-1].content if query_msgs else ""

    # AgentCore Runtime injects these into state via the runner.
    actor_id = state.get("actor_id", "anonymous")
    session_id = state.get("session_id", "default-session")

    prompt = _base_prompt
    if _memory and query_text:
        try:
            records = _memory.retrieve_memories(
                memory_id=MEMORY_ID,
                namespace=_NAMESPACE,
                query=query_text,
                top_k=_TOP_K,
            )
            mem_context = _format_memories(records or [])
            if mem_context:
                prompt = f"{{_base_prompt}}\\n\\n[Relevant memories]:\\n{{mem_context}}"
        except Exception as e:
            _log.warning("AgentCore Memory retrieve failed: %s", e)

    agent = create_react_agent(_model, get_tools_for_agent("{nid}"), prompt=prompt)
    result = await agent.ainvoke({{"messages": state["messages"]}})
    messages = result["messages"]

    if _memory and query_text:
        try:
            response_text = messages[-1].content if messages else ""
            # create_event records the conversation turn into AgentCore Memory.
            # Configured strategies (SEMANTIC, SUMMARIZATION, USER_PREFERENCE)
            # automatically extract long-term facts asynchronously.
            _memory.create_event(
                memory_id=MEMORY_ID,
                actor_id=actor_id,
                session_id=session_id,
                messages=[
                    (query_text, "USER"),
                    (response_text, "ASSISTANT"),
                ],
            )
        except Exception as e:
            _log.warning("AgentCore Memory create_event failed: %s", e)

    return {{
        "messages": messages,
        "{response_key}": messages[-1].content if messages else "",
        "{tool_calls_key}": [
            {{"name": m.name, "args": m.additional_kwargs}}
            for m in messages if hasattr(m, "name") and m.name
        ],
    }}
'''
    else:
        content = f'''\
from langchain_aws import ChatBedrock
from langgraph.prebuilt import create_react_agent

from ..state import AgentState
from ..tools import get_tools_for_agent

_model = ChatBedrock(
    model_id="{effective_model}",
    model_kwargs={{"temperature": {temperature}, "max_tokens": {max_tokens}}}{guardrail_config},
    streaming={streaming},
)
_agent = create_react_agent(
    _model,
    get_tools_for_agent("{nid}"),
    prompt="{system_prompt}",
)


async def node_{nid}(state: AgentState) -> dict:
    result = await _agent.ainvoke({{"messages": state["messages"]}})
    messages = result["messages"]
    return {{
        "messages": messages,
        "{response_key}": messages[-1].content if messages else "",
        "{tool_calls_key}": [
            {{"name": m.name, "args": m.additional_kwargs}}
            for m in messages if hasattr(m, "name") and m.name
        ],
    }}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)


def _gen_coordinator(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    model_id = node.config.get("model_id", "")
    system_prompt = node.config.get("system_prompt", "").replace('"', '\\"')
    max_iter = node.config.get("max_iterations", 10)
    workers: list[str] = node.config.get("workers", [])
    nid = node.id

    worker_imports = "\n".join(
        f"from .{wid} import node_{wid} as worker_{wid}" for wid in workers
    )
    worker_list = ", ".join(f"worker_{wid}" for wid in workers)

    content = f'''\
from langchain_aws import ChatBedrock
from langgraph_supervisor import create_supervisor

from ..state import AgentState
{worker_imports}

_model = ChatBedrock(model_id="{model_id}")

_supervisor = create_supervisor(
    [{worker_list}],
    model=_model,
    prompt="{system_prompt}",
    max_iterations={max_iter},
).compile()


async def node_{nid}(state: AgentState) -> dict:
    result = await _supervisor.ainvoke({{"messages": state["messages"]}})
    return {{"messages": result["messages"]}}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)


def _gen_hitl(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    nid = node.id
    input_key = _first_input_key(node, project.edges)
    approved_key = _state_key(nid, "approved")
    rejected_key = _state_key(nid, "rejected")
    notification = node.config.get("notification", "email")
    target = node.config.get("notification_target", "")

    content = f'''\
from langgraph.types import interrupt

from ..state import AgentState


def node_{nid}(state: AgentState) -> dict:
    """Pauses execution and sends a notification to {target} via {notification}.

    Resumes when POST /callbacks/{{thread_id}} receives:
      {{"decision": "approve"|"reject", "reason": "string"}}
    """
    payload = state.get("{input_key}")
    decision: dict = interrupt(payload)

    if decision.get("decision") == "approve":
        return {{"{approved_key}": decision, "{rejected_key}": None}}
    return {{"{approved_key}": None, "{rejected_key}": decision.get("reason", "Rejected")}}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)


def _gen_condition(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    nid = node.id
    expression = node.config.get("expression", "")
    lang = node.config.get("expression_language", "jmespath")
    input_key = _first_input_key(node, project.edges)

    if lang == "jmespath":
        eval_block = f'''\
    result = jmespath.search("{expression}", payload if isinstance(payload, dict) else {{"value": payload}})
    return "true" if result else "false"'''
        import_line = "import jmespath"
    else:  # cel
        eval_block = f'''\
    prog = cel_env.compile("{expression}")
    result = prog.evaluate({{"payload": payload}})
    return "true" if result else "false"'''
        import_line = "import celpy\ncel_env = celpy.Environment()"

    content = f'''\
{import_line}

from ..state import AgentState


def node_{nid}(state: AgentState) -> str:
    """Routing function — returns branch name 'true' or 'false'."""
    payload = state.get("{input_key}")
{eval_block}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)


def _gen_loop(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    nid = node.id
    input_key = _first_input_key(node, project.edges)
    results_key = _state_key(nid, "results")

    content = f'''\
from typing import Annotated, List
import operator

from langgraph.types import Send

from ..state import AgentState


def node_{nid}_fanout(state: AgentState) -> list[Send]:
    """Fan-out: dispatches one Send per item in the input list."""
    items = state.get("{input_key}", [])
    return [Send("node_{nid}_process", {{"item": item}}) for item in items]


def node_{nid}_process(state: dict) -> dict:
    """Per-iteration processor — override with actual logic."""
    return {{"{results_key}": [state.get("item")]}}


def node_{nid}_fanin(state: AgentState) -> dict:
    """Fan-in: results are aggregated via Annotated[List, operator.add] in state."""
    return {{}}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)


def _gen_cache(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    nid = node.id
    key_expr = node.config.get("key_expression", "payload")
    ttl = node.config.get("ttl_seconds", 3600)
    input_key = _first_input_key(node, project.edges)
    hit_key = _state_key(nid, "hit")
    miss_key = _state_key(nid, "miss")

    content = f'''\
import json
import time

import boto3
import jmespath

from ..config import CACHE_TABLE, AWS_REGION
from ..state import AgentState

_ddb = boto3.resource("dynamodb", region_name=AWS_REGION)
_table = _ddb.Table(CACHE_TABLE)


def node_{nid}(state: AgentState) -> dict:
    payload = state.get("{input_key}")
    cache_key = str(jmespath.search("{key_expr}", payload if isinstance(payload, dict) else {{"value": payload}}))

    item = _table.get_item(Key={{"pk": cache_key}}).get("Item")
    if item and item.get("expires_at", 0) > time.time():
        return {{"{hit_key}": json.loads(item["value"]), "{miss_key}": None}}

    _table.put_item(Item={{
        "pk": cache_key,
        "value": json.dumps(payload),
        "expires_at": int(time.time()) + {ttl},
    }})
    return {{"{hit_key}": None, "{miss_key}": payload}}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)


def _gen_logger(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    nid = node.id
    level = node.config.get("level", "INFO").upper()
    msg_template = node.config.get("message_template", "").replace('"', '\\"')
    include_payload = node.config.get("include_payload", False)
    input_key = _first_input_key(node, project.edges)
    output_key = _state_key(nid, "payload")

    payload_log = f', "payload": payload' if include_payload else ""

    content = f'''\
import json
import logging

from ..state import AgentState

_log = logging.getLogger("{nid}")
logging.basicConfig(level=logging.{level})


def node_{nid}(state: AgentState) -> dict:
    payload = state.get("{input_key}")
    msg = "{msg_template}"
    if isinstance(payload, dict):
        try:
            msg = msg.format(**payload)
        except (KeyError, ValueError):
            pass
    _log.{level.lower()}(json.dumps({{
        "level": "{level}",
        "node_id": "{nid}",
        "message": msg{payload_log},
    }}))
    return {{"{output_key}": payload}}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)


def _gen_output(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    nid = node.id
    input_key = _first_input_key(node, project.edges)

    content = f'''\
from ..state import AgentState


def node_{nid}(state: AgentState) -> dict:
    """Terminal node — writes final payload to state for the runner to read."""
    return {{"final_output": state.get("{input_key}")}}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)


def _gen_kb_s3_vector(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    """Real S3 Vectors client — queries native AWS vector store via boto3."""
    nid = node.id
    bucket = node.config.get("bucket", "")
    index_name = node.config.get("index_name", "")
    embedding_model = node.config.get("embedding_model_id", "amazon.titan-embed-text-v2:0")
    retriever_key = _state_key(nid, "retriever")
    docs_key = _state_key(nid, "documents")

    content = f'''\
import boto3
from langchain_aws.embeddings import BedrockEmbeddings

from ..config import AWS_REGION
from ..state import AgentState

_embeddings = BedrockEmbeddings(model_id="{embedding_model}", region_name=AWS_REGION)
_s3v = boto3.client("s3vectors", region_name=AWS_REGION)


async def node_{nid}(state: AgentState) -> dict:
    """Queries S3 Vectors store (bucket: {bucket}, index: {index_name})."""
    query_msgs = state.get("messages", [])
    query_text = query_msgs[-1].content if query_msgs else ""

    query_vec = _embeddings.embed_query(query_text)

    response = _s3v.query_vectors(
        vectorBucketName="{bucket}",
        indexName="{index_name}",
        queryVector={{"float32": query_vec}},
        topK=5,
        returnMetadata=True,
    )

    docs = [
        {{
            "content": v.get("metadata", {{}}).get("text", ""),
            "metadata": v.get("metadata", {{}}),
        }}
        for v in response.get("vectors", [])
    ]
    return {{"{retriever_key}": docs, "{docs_key}": docs}}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)


def _gen_kb_bedrock(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    nid = node.id
    kb_id = node.config.get("knowledge_base_id", "")
    num_results = node.config.get("retrieval_config", {}).get("number_of_results", 5)
    search_type = node.config.get("retrieval_config", {}).get("search_type", "SEMANTIC")
    retriever_key = _state_key(nid, "retriever")

    content = f'''\
from langchain_aws import AmazonKnowledgeBasesRetriever

from ..state import AgentState


def node_{nid}(state: AgentState) -> dict:
    retriever = AmazonKnowledgeBasesRetriever(
        knowledge_base_id="{kb_id}",
        retrieval_config={{
            "vectorSearchConfiguration": {{
                "numberOfResults": {num_results},
                "searchType": "{search_type}",
            }}
        }},
    )
    return {{"{retriever_key}": retriever}}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)


def _gen_retriever(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    nid = node.id
    top_k = node.config.get("top_k", 5)
    score_threshold = node.config.get("score_threshold")
    input_key = _first_input_key(node, project.edges)
    docs_key = _state_key(nid, "documents")

    threshold_filter = (
        f"\n    docs = [d for d in docs if d.metadata.get('score', 1.0) >= {score_threshold}]"
        if score_threshold is not None else ""
    )

    content = f'''\
from ..state import AgentState


async def node_{nid}(state: AgentState) -> dict:
    retriever = state.get("{input_key}")
    query = state.get("messages", [])
    query_text = query[-1].content if query else ""

    docs = await retriever.ainvoke(
        query_text, config={{"configurable": {{"search_kwargs": {{"k": {top_k}}}}}}}
    ){threshold_filter}
    return {{"{docs_key}": [
        {{"content": d.page_content, "metadata": d.metadata}} for d in docs
    ]}}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)


def _gen_mcp_server(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    """Generates mcp_server/server.py — AgentCore MCP server exposing tool nodes."""
    name = node.config.get("name", node.id).replace('"', '\\"')
    transport = node.config.get("transport", "stdio")

    tool_nodes = [n for n in project.nodes if n.is_tool()]
    tool_imports = ""
    tool_registrations = ""
    for tn in tool_nodes:
        fn_name = tn.config.get("name", f"tool_{tn.id}").replace("-", "_").lower()
        desc = tn.config.get("description", f"Tool {tn.id}").replace('"', '\\"')
        tool_imports += f"from agent.tools.{tn.id} import {fn_name} as _impl_{fn_name}\n"
        tool_registrations += f'''

@server.tool(description="{desc}")
async def {fn_name}(input: dict) -> dict:
    return await _impl_{fn_name}(input)
'''

    content = f'''\
"""MCP Server for {name} — exposes agent tools via Model Context Protocol.

Deploy on AgentCore:
  bedrock-agentcore deploy mcp-server ./mcp_server/

Run locally (stdio transport):
  python -m mcp_server.server
"""
from bedrock_agentcore.mcp import MCPServer
{tool_imports}

server = MCPServer("{name}")
{tool_registrations}

if __name__ == "__main__":
    server.run(transport="{transport}")
'''
    return CompiledFile(path="mcp_server/server.py", content=content)


def _gen_mcp_client(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    """Real MCP client using langchain-mcp-adapters."""
    nid = node.id
    server_url = node.config.get("server_url", "")
    transport = node.config.get("transport", "sse")
    auth = node.config.get("auth", {})
    tools_key = _state_key(nid, "tools")

    auth_block = ""
    if auth.get("type") == "bearer" and auth.get("secret_ref"):
        secret_name = auth["secret_ref"].replace("secret://", "")
        auth_block = f'''
import functools
import boto3
from ..config import AWS_REGION


@functools.lru_cache(maxsize=1)
def _get_bearer_token() -> str:
    return boto3.client("secretsmanager", region_name=AWS_REGION).get_secret_value(
        SecretId="{secret_name}"
    )["SecretString"]
'''

    content = f'''\
from langchain_mcp_adapters.client import MultiServerMCPClient

from ..state import AgentState
{auth_block}

_mcp_client = MultiServerMCPClient(
    {{
        "{nid}": {{
            "url": "{server_url}",
            "transport": "{transport}",
        }}
    }}
)


async def node_{nid}(state: AgentState) -> dict:
    """Loads tools from MCP server at {server_url}."""
    tools = await _mcp_client.get_tools()
    return {{"{tools_key}": [t.name for t in tools]}}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)


def _gen_code_interpreter(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    """AgentCore managed Python sandbox — no infrastructure required."""
    nid = node.id
    timeout = node.config.get("timeout_seconds", 30)
    input_key = _first_input_key(node, project.edges)
    output_key = _state_key(nid, "result")
    error_key = _state_key(nid, "error")

    content = f'''\
from bedrock_agentcore.tools import CodeInterpreterClient

from ..state import AgentState

_code_interpreter = CodeInterpreterClient()


async def node_{nid}(state: AgentState) -> dict:
    """Executes Python code in AgentCore managed sandbox (timeout: {timeout}s)."""
    payload = state.get("{input_key}")
    code = payload.get("code", "") if isinstance(payload, dict) else str(payload or "")

    response = await _code_interpreter.invoke_async(
        code=code,
        timeout_seconds={timeout},
    )

    return {{
        "{output_key}": response.get("output"),
        "{error_key}": response.get("error"),
    }}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)


def _gen_browser_tool(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    """AgentCore managed headless browser — no Playwright/Puppeteer infra required."""
    nid = node.id
    input_key = _first_input_key(node, project.edges)
    output_key = _state_key(nid, "result")

    content = f'''\
from bedrock_agentcore.tools import BrowserClient

from ..state import AgentState

_browser = BrowserClient()


async def node_{nid}(state: AgentState) -> dict:
    """Navigates and extracts content via AgentCore managed browser."""
    payload = state.get("{input_key}")
    if isinstance(payload, dict):
        url = payload.get("url", "")
        action = payload.get("action", "navigate")
        extra = {{k: v for k, v in payload.items() if k not in ("url", "action")}}
    else:
        url = str(payload or "")
        action = "navigate"
        extra = {{}}

    response = await _browser.invoke_async(action=action, url=url, **extra)
    return {{"{output_key}": response.get("result", {{}})}}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)


def _gen_passthrough(node: Node, project: Project, node_map: dict[str, Node]) -> CompiledFile:
    """Stub for nodes not yet fully implemented."""
    nid = node.id
    input_key = _first_input_key(node, project.edges)
    content = f'''\
from ..state import AgentState


def node_{nid}(state: AgentState) -> dict:
    """Passthrough stub for node type '{node.type}'."""
    return {{"{_state_key(nid, "output")}": state.get("{input_key}")}}
'''
    return CompiledFile(path=f"agent/nodes/{nid}.py", content=content)
