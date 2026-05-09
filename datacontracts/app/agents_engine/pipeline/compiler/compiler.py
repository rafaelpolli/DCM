"""Phase 2: Graph Compiler — orchestrates all code generation sub-phases."""
from __future__ import annotations

from ..._types import CompiledArtifacts, CompiledFile
from ...models.graph import Node, Project
from .config_gen import generate_config
from .graph_gen import generate_graph
from .node_gen import generate_node
from .runner_gen import generate_runner
from .state_gen import generate_state
from .tool_gen import generate_tool, generate_tools_init


def compile_graph(project: Project, sorted_nodes: list[Node]) -> CompiledArtifacts:
    """
    Translates the validated DAG into a full Python agent package under agent/.

    Returns a CompiledArtifacts with all generated files. Tools go in agent/tools/,
    node functions in agent/nodes/, and the graph/state/config/runner at agent/*.
    """
    node_map = project.node_map()
    artifacts = CompiledArtifacts()

    # Package init files
    for init_path in (
        "agent/__init__.py",
        "agent/nodes/__init__.py",
        "agent/tools/__init__.py",
        "mcp_server/__init__.py",
    ):
        artifacts.add(CompiledFile(path=init_path, content=""))

    # state.py
    artifacts.add(generate_state(project, node_map))

    # config.py
    artifacts.add(generate_config(project))

    # Tool files (agent/tools/{node_id}.py)
    tool_nodes = [n for n in project.nodes if n.is_tool()]
    for tool_node in tool_nodes:
        artifacts.add(generate_tool(tool_node))

    # Build agent → tool IDs mapping from node configs
    agent_tool_map: dict[str, list[str]] = {}
    for node in project.nodes:
        if node.type in ("agent", "multi_agent_coordinator"):
            tool_ids: list[str] = node.config.get("tools", [])
            agent_tool_map[node.id] = tool_ids

    # agent/tools/__init__.py — provides get_tools_for_agent()
    artifacts.add(generate_tools_init(project.nodes, agent_tool_map))

    # Node files (agent/nodes/{node_id}.py)
    for node in sorted_nodes:
        if node.is_tool():
            continue  # tools already handled
        compiled = generate_node(node, project, node_map)
        if compiled is not None:
            artifacts.add(compiled)

    # graph.py
    artifacts.add(generate_graph(project, sorted_nodes, node_map))

    # runner.py
    artifacts.add(generate_runner(project))

    return artifacts
