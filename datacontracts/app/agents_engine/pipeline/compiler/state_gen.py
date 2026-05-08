"""Generates agent/state.py from the DAG's edge graph."""
from __future__ import annotations

from ..._types import CompiledFile
from ...models.graph import Edge, Node, Project

_DATA_TYPE_TO_PYTHON = {
    "string": "str",
    "json": "dict",
    "document": "List[dict]",
    "vector": "List[float]",
    "any": "Any",
    "control": "Any",
    "retriever": "Any",
}

_MESSAGE_PORT_IDS = frozenset({"message", "messages", "task"})


def _state_key(node_id: str, port_id: str) -> str:
    """Deterministic state key: {node_id}_{port_id}, safe as Python identifier."""
    return f"{node_id}_{port_id}".replace("-", "_")


def _is_message_edge(edge: Edge, node_map: dict[str, Node]) -> bool:
    """True when this edge carries agent messages (uses Annotated accumulator)."""
    target_node = node_map.get(edge.target_node_id)
    if target_node and target_node.type in {"agent", "multi_agent_coordinator"}:
        if edge.target_port_id in _MESSAGE_PORT_IDS:
            return True
    return False


def collect_state_fields(project: Project, node_map: dict[str, Node]) -> dict[str, str]:
    """
    Returns an ordered mapping of {state_key: python_type_annotation} covering
    all data flowing through the graph.
    """
    fields: dict[str, str] = {}

    # Standard LangGraph messages field — always present for agent graphs
    if project.has_node_type("agent") or project.has_node_type("multi_agent_coordinator"):
        fields["messages"] = "Annotated[List[BaseMessage], operator.add]"

    # AgentCore Runtime session identity — populated by the runner from
    # session_context. Used by AgentCore Memory to scope events per user/session.
    has_memory = any(
        n.config.get("memory", {}).get("enabled", False)
        for n in project.nodes if n.type == "agent"
    )
    if has_memory:
        fields["actor_id"] = "str"
        fields["session_id"] = "str"

    for edge in project.edges:
        if _is_message_edge(edge, node_map):
            continue  # handled by the `messages` field above

        key = _state_key(edge.source_node_id, edge.source_port_id)
        py_type = _DATA_TYPE_TO_PYTHON.get(edge.data_type, "Any")
        fields.setdefault(key, py_type)

    # Ensure output fields for every node's output ports are in state
    for node in project.nodes:
        for port in node.ports.outputs:
            key = _state_key(node.id, port.id)
            py_type = _DATA_TYPE_TO_PYTHON.get(port.data_type, "Any")
            fields.setdefault(key, py_type)

    return fields


def generate_state(project: Project, node_map: dict[str, Node]) -> CompiledFile:
    fields = collect_state_fields(project, node_map)

    needs_annotated = any("Annotated" in t for t in fields.values())
    needs_list = any("List" in t for t in fields.values())

    imports = ["from __future__ import annotations", ""]
    imports.append("import operator")
    imports.append("from typing import Any")
    if needs_list:
        imports.append("from typing import List")
    if needs_annotated:
        imports.append("from typing import Annotated")
    imports.append("from langchain_core.messages import BaseMessage")
    imports.append("from langgraph.graph import MessagesState")
    imports.append("")

    field_lines = []
    for key, py_type in fields.items():
        field_lines.append(f"    {key}: {py_type}")

    body = "\n".join(imports)
    body += "\n\nclass AgentState(MessagesState):\n"
    if field_lines:
        body += "\n".join(field_lines) + "\n"
    else:
        body += "    pass\n"

    return CompiledFile(path="agent/state.py", content=body)
