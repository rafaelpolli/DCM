"""Generates agent/graph.py — StateGraph assembly."""
from __future__ import annotations

from collections import defaultdict

from ..._types import CompiledFile
from ...models.graph import TOOL_NODE_TYPES, Node, Project

# These node types are not added as graph.add_node() — they're handled differently
_EXCLUDED_GRAPH_NODES = frozenset({"input", "mcp_server"} | TOOL_NODE_TYPES)

# Condition nodes are used as routing fns in add_conditional_edges, not as graph nodes
_ROUTING_ONLY_TYPES = frozenset({"condition"})


def generate_graph(project: Project, sorted_nodes: list[Node], node_map: dict[str, Node]) -> CompiledFile:
    has_hitl = project.has_node_type("human_in_the_loop")
    has_streaming = any(
        n.config.get("streaming", False)
        for n in project.nodes if n.type == "agent"
    )

    graph_nodes = [
        n for n in sorted_nodes
        if n.type not in _EXCLUDED_GRAPH_NODES and n.type not in _ROUTING_ONLY_TYPES
    ]
    condition_map = {n.id: n for n in project.nodes if n.type == "condition"}

    # Outgoing edges per source node: source_id → list of (source_port_id, target_node_id)
    outgoing: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for edge in project.edges:
        outgoing[edge.source_node_id].append((edge.source_port_id, edge.target_node_id))

    # Condition branch maps: condition_node_id → {port_id: target_node_id}
    condition_branches: dict[str, dict[str, str]] = {}
    for edge in project.edges:
        if edge.source_node_id in condition_map:
            cid = edge.source_node_id
            condition_branches.setdefault(cid, {})[edge.source_port_id] = edge.target_node_id

    graph_node_ids = {n.id for n in graph_nodes}

    # -- Build import lines --
    node_imports: list[str] = []
    for n in graph_nodes:
        fn = f"node_{n.id}"
        if n.type == "loop":
            node_imports.append(f"from .nodes.{n.id} import node_{n.id}_fanout, node_{n.id}_process, node_{n.id}_fanin")
        else:
            node_imports.append(f"from .nodes.{n.id} import {fn}")

    # Condition nodes also need imports (used as routing fns)
    for cid in condition_map:
        node_imports.append(f"from .nodes.{cid} import node_{cid}")

    # -- Build graph body --
    lines: list[str] = []
    lines.append("    graph = StateGraph(AgentState)")
    lines.append("")

    # Add nodes
    for n in graph_nodes:
        if n.type == "loop":
            lines.append(f'    graph.add_node("node_{n.id}_fanout", node_{n.id}_fanout)')
            lines.append(f'    graph.add_node("node_{n.id}_process", node_{n.id}_process)')
            lines.append(f'    graph.add_node("node_{n.id}_fanin", node_{n.id}_fanin)')
        else:
            lines.append(f'    graph.add_node("node_{n.id}", node_{n.id})')

    lines.append("")

    # Entry point: first graph node in topological order
    if graph_nodes:
        first = graph_nodes[0]
        entry_id = f"node_{first.id}_fanout" if first.type == "loop" else f"node_{first.id}"
        lines.append(f'    graph.set_entry_point("{entry_id}")')
        lines.append("")

    # Add edges
    processed_sources: set[str] = set()

    for n in graph_nodes:
        node_key = f"node_{n.id}" if n.type != "loop" else f"node_{n.id}_fanin"
        targets = outgoing.get(n.id, [])

        if not targets:
            # Terminal node → END
            lines.append(f'    graph.add_edge("{node_key}", END)')
            continue

        # Group unique target node IDs
        unique_targets: list[str] = []
        seen: set[str] = set()
        for _, tgt_id in targets:
            if tgt_id not in seen:
                seen.add(tgt_id)
                unique_targets.append(tgt_id)

        # Check if any target is a condition node
        condition_target = next((t for t in unique_targets if t in condition_map), None)

        if condition_target and condition_target not in processed_sources:
            processed_sources.add(condition_target)
            branches = condition_branches.get(condition_target, {})
            branch_map_parts = []
            for branch_port, branch_tgt in branches.items():
                if branch_tgt in graph_node_ids:
                    branch_map_parts.append(f'"{branch_port}": "node_{branch_tgt}"')
                else:
                    branch_map_parts.append(f'"{branch_port}": END')
            branch_map = "{" + ", ".join(branch_map_parts) + "}"
            lines.append(
                f'    graph.add_conditional_edges("{node_key}", node_{condition_target}, {branch_map})'
            )
        else:
            for tgt_id in unique_targets:
                if tgt_id in condition_map:
                    continue  # already handled above
                if tgt_id in graph_node_ids:
                    tgt_key = f"node_{tgt_id}_fanout" if node_map[tgt_id].type == "loop" else f"node_{tgt_id}"
                    lines.append(f'    graph.add_edge("{node_key}", "{tgt_key}")')
                # If target is an input/tool node (shouldn't happen after validation), skip

        # Output nodes always end at END
        if n.type == "output":
            lines.append(f'    graph.add_edge("node_{n.id}", END)')

    # Loop nodes need additional internal edges
    for n in graph_nodes:
        if n.type == "loop":
            loop_targets = [tgt for _, tgt in outgoing.get(n.id, []) if tgt in graph_node_ids]
            lines.append(
                f'    graph.add_conditional_edges("node_{n.id}_fanout", node_{n.id}_fanout)'
            )
            lines.append(f'    graph.add_edge("node_{n.id}_process", "node_{n.id}_fanin")')
            for tgt in loop_targets:
                lines.append(f'    graph.add_edge("node_{n.id}_fanin", "node_{tgt}")')

    lines.append("")

    # Checkpointer injection for HITL
    if has_hitl:
        lines.append("    checkpointer = DynamoDBSaver.from_conn_info(")
        lines.append("        region=AWS_REGION,")
        lines.append("        table_name=CHECKPOINTER_TABLE,")
        lines.append("    )")
        lines.append("    return graph.compile(checkpointer=checkpointer)")
    else:
        lines.append("    return graph.compile()")

    # -- Assemble file --
    imports = [
        "from __future__ import annotations",
        "",
        "from langgraph.graph import END, StateGraph",
    ]
    if has_hitl:
        imports += [
            "from langgraph_checkpoint_aws import DynamoDBSaver",
            "",
            "from .config import AWS_REGION, CHECKPOINTER_TABLE",
        ]
    imports += [
        "from .state import AgentState",
        "",
        *node_imports,
        "",
    ]

    body = "\n".join(imports)
    body += "\n\ndef build_graph() -> StateGraph:\n"
    body += "\n".join(lines) + "\n"
    body += "\n\ngraph = build_graph()\n"

    return CompiledFile(path="agent/graph.py", content=body)
