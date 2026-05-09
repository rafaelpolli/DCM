"""Phase 1: Validates the graph DAG before code generation."""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field

from ..models.graph import Node, Project

_REQUIRED_CONFIG: dict[str, list[str]] = {
    "agent": ["model_id", "system_prompt"],
    "multi_agent_coordinator": ["model_id", "system_prompt", "workers"],
    "human_in_the_loop": ["notification", "notification_target"],
    "tool_custom": ["name", "description"],
    "tool_athena": ["name", "description", "database", "query_template", "output_location"],
    "tool_s3": ["name", "description", "operation", "bucket"],
    "tool_http": ["name", "description", "base_url", "method"],
    "tool_bedrock": ["name", "description", "operation"],
    "condition": ["expression", "expression_language"],
    "cache": ["backend", "key_expression"],
    "logger": ["level", "message_template"],
    "kb_s3_vector": ["bucket", "index_name", "embedding_model_id"],
    "kb_bedrock": ["knowledge_base_id"],
    "chunking": ["strategy"],
    "embedding": ["model_id"],
    "retriever": ["top_k", "search_type"],
    "s3_source": ["bucket"],
    "ingest_pipeline": ["embedding_model_id"],
    "mcp_server": ["name", "transport"],
    "mcp_client": ["server_url", "transport"],
    "code_interpreter": [],
    "browser_tool": [],
    "input": ["trigger"],
    "output": ["mode"],
    "loop": [],
    "document_parser": [],
}

_VALID_EXPRESSION_LANGUAGES = frozenset({"jmespath", "cel"})
_VALID_CACHE_BACKENDS = frozenset({"dynamodb"})


@dataclass
class ValidationError:
    node_id: str | None
    field: str | None
    code: str
    message: str

    def to_dict(self) -> dict:
        return {
            "node_id": self.node_id,
            "field": self.field,
            "code": self.code,
            "message": self.message,
        }


@dataclass
class ValidationResult:
    valid: bool
    errors: list[ValidationError] = field(default_factory=list)
    sorted_nodes: list[Node] = field(default_factory=list)


def validate(project: Project) -> ValidationResult:
    errors: list[ValidationError] = []
    node_map = project.node_map()

    _check_entry_exit(project, errors)
    _check_required_config(project, errors)
    _check_security_constraints(project, errors)
    _check_edge_references(project, node_map, errors)
    _check_edge_types(project, node_map, errors)

    sorted_nodes = _topological_sort(project, node_map, errors)

    return ValidationResult(
        valid=len(errors) == 0,
        errors=errors,
        sorted_nodes=sorted_nodes,
    )


def _check_entry_exit(project: Project, errors: list[ValidationError]) -> None:
    if not any(n.type == "input" for n in project.nodes):
        errors.append(ValidationError(
            None, None, "MISSING_INPUT_NODE",
            "Graph must have at least one input node",
        ))
    if not any(n.type == "output" for n in project.nodes):
        errors.append(ValidationError(
            None, None, "MISSING_OUTPUT_NODE",
            "Graph must have at least one output node",
        ))


def _check_required_config(project: Project, errors: list[ValidationError]) -> None:
    for node in project.nodes:
        required = _REQUIRED_CONFIG.get(node.type, [])
        for f in required:
            if not node.config.get(f):
                errors.append(ValidationError(
                    node_id=node.id,
                    field=f"config.{f}",
                    code="MISSING_REQUIRED_FIELD",
                    message=f"'{f}' is required for {node.type} nodes",
                ))


def _check_security_constraints(project: Project, errors: list[ValidationError]) -> None:
    for node in project.nodes:
        if node.type == "tool_athena":
            qt: str = node.config.get("query_template", "")
            # Prohibit f-string-style placeholders without ? params
            if "{" in qt and "?" not in qt:
                errors.append(ValidationError(
                    node_id=node.id,
                    field="config.query_template",
                    code="UNSAFE_QUERY_TEMPLATE",
                    message=(
                        "query_template must use ? positional placeholders via "
                        "Athena ExecutionParameters — not string formatting"
                    ),
                ))

        if node.type == "condition":
            lang = node.config.get("expression_language", "")
            if lang not in _VALID_EXPRESSION_LANGUAGES:
                errors.append(ValidationError(
                    node_id=node.id,
                    field="config.expression_language",
                    code="INVALID_EXPRESSION_LANGUAGE",
                    message=f"expression_language must be one of {sorted(_VALID_EXPRESSION_LANGUAGES)}",
                ))

        if node.type == "cache":
            backend = node.config.get("backend", "")
            if backend not in _VALID_CACHE_BACKENDS:
                errors.append(ValidationError(
                    node_id=node.id,
                    field="config.backend",
                    code="UNSUPPORTED_CACHE_BACKEND",
                    message=f"cache backend must be one of {sorted(_VALID_CACHE_BACKENDS)} in v1",
                ))

        if node.type == "agent":
            model_id = node.config.get("model_id", "")
            profile_arn = node.config.get("inference_profile_arn", "")
            if not model_id and not profile_arn:
                errors.append(ValidationError(
                    node_id=node.id,
                    field="config.model_id",
                    code="MISSING_MODEL_CONFIG",
                    message="agent node requires model_id or inference_profile_arn",
                ))


def _check_edge_references(
    project: Project,
    node_map: dict[str, Node],
    errors: list[ValidationError],
) -> None:
    port_ids: dict[str, set[str]] = {}
    for node in project.nodes:
        port_ids[node.id] = (
            {p.id for p in node.ports.inputs} | {p.id for p in node.ports.outputs}
        )

    for edge in project.edges:
        if edge.source_node_id not in node_map:
            errors.append(ValidationError(
                node_id=edge.source_node_id, field=None,
                code="INVALID_EDGE_SOURCE",
                message=f"Edge '{edge.id}' source node '{edge.source_node_id}' does not exist",
            ))
        elif edge.source_port_id not in port_ids.get(edge.source_node_id, set()):
            errors.append(ValidationError(
                node_id=edge.source_node_id, field=None,
                code="INVALID_SOURCE_PORT",
                message=f"Edge '{edge.id}' source port '{edge.source_port_id}' not found on node '{edge.source_node_id}'",
            ))

        if edge.target_node_id not in node_map:
            errors.append(ValidationError(
                node_id=edge.target_node_id, field=None,
                code="INVALID_EDGE_TARGET",
                message=f"Edge '{edge.id}' target node '{edge.target_node_id}' does not exist",
            ))
        elif edge.target_port_id not in port_ids.get(edge.target_node_id, set()):
            errors.append(ValidationError(
                node_id=edge.target_node_id, field=None,
                code="INVALID_TARGET_PORT",
                message=f"Edge '{edge.id}' target port '{edge.target_port_id}' not found on node '{edge.target_node_id}'",
            ))


def _check_edge_types(
    project: Project,
    node_map: dict[str, Node],
    errors: list[ValidationError],
) -> None:
    port_type: dict[tuple[str, str], str] = {}
    for node in project.nodes:
        for p in node.ports.inputs:
            port_type[(node.id, p.id)] = p.data_type
        for p in node.ports.outputs:
            port_type[(node.id, p.id)] = p.data_type

    for edge in project.edges:
        src_type = port_type.get((edge.source_node_id, edge.source_port_id))
        tgt_type = port_type.get((edge.target_node_id, edge.target_port_id))
        if src_type and tgt_type and src_type != "any" and tgt_type != "any":
            if src_type != tgt_type:
                errors.append(ValidationError(
                    node_id=edge.source_node_id, field=None,
                    code="TYPE_MISMATCH",
                    message=(
                        f"Edge '{edge.id}': source port type '{src_type}' "
                        f"is incompatible with target port type '{tgt_type}'"
                    ),
                ))


def _topological_sort(
    project: Project,
    node_map: dict[str, Node],
    errors: list[ValidationError],
) -> list[Node]:
    adj: dict[str, list[str]] = defaultdict(list)
    in_degree: dict[str, int] = {n.id: 0 for n in project.nodes}

    for edge in project.edges:
        if edge.source_node_id in in_degree and edge.target_node_id in in_degree:
            adj[edge.source_node_id].append(edge.target_node_id)
            in_degree[edge.target_node_id] += 1

    queue: deque[str] = deque(nid for nid, deg in in_degree.items() if deg == 0)
    sorted_ids: list[str] = []

    while queue:
        nid = queue.popleft()
        sorted_ids.append(nid)
        for neighbor in adj[nid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if len(sorted_ids) != len(project.nodes):
        errors.append(ValidationError(
            None, None, "CYCLE_DETECTED",
            "Graph contains a cycle — DAGs must be acyclic",
        ))

    return [node_map[nid] for nid in sorted_ids if nid in node_map]
