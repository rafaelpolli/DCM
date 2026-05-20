"""Phase 1 (ML): validate an ML pipeline DAG before compilation."""
from __future__ import annotations

from collections import defaultdict, deque

from ...models.graph import ML_PIPELINE_NODE_TYPES, Node, Project
from ..validator import ValidationError, ValidationResult

_REQUIRED_CONFIG_ML: dict[str, list[str]] = {
    "data_source_s3":    ["name", "s3_uri", "format"],
    "processing_job":    ["name", "image_uri", "instance_type", "script_uri"],
    "training_job":      ["name", "image_uri", "instance_type", "output_s3_uri"],
    "model_register":    ["model_package_group_name"],
    "endpoint_realtime": ["instance_type"],
    "condition":         ["expression", "expression_language"],
    "human_in_the_loop": ["notification", "notification_target"],
    "input":  [],
    "output": [],
}

# Topology constraints — which downstream types are allowed for each upstream.
# Any downstream type not in the set produces an INVALID_ML_TOPOLOGY error.
# Reused agent node types (input, output, condition, human_in_the_loop) are
# accepted everywhere.
_ALLOWED_DOWNSTREAM: dict[str, set[str]] = {
    "data_source_s3":    {"processing_job", "training_job"},
    "processing_job":    {"processing_job", "training_job", "output"},
    "training_job":      {"model_register"},
    "model_register":    {"endpoint_realtime", "human_in_the_loop", "condition", "output"},
    "endpoint_realtime": {"output"},
}

_ML_GENERIC_TYPES = frozenset({"input", "output", "condition", "human_in_the_loop"})
_ALLOWED_NODE_TYPES = ML_PIPELINE_NODE_TYPES | _ML_GENERIC_TYPES


def validate_ml(project: Project) -> ValidationResult:
    errors: list[ValidationError] = []
    node_map = {n.id: n for n in project.nodes}

    _check_node_types_allowed(project, errors)
    _check_required_config(project, errors)
    _check_pipeline_shape(project, errors)
    _check_topology(project, node_map, errors)
    _check_edges_reference_known_nodes(project, node_map, errors)

    sorted_nodes = _topological_sort(project, node_map, errors)
    return ValidationResult(valid=not errors, errors=errors, sorted_nodes=sorted_nodes)


def _check_node_types_allowed(project: Project, errors: list[ValidationError]) -> None:
    for n in project.nodes:
        if n.type not in _ALLOWED_NODE_TYPES:
            errors.append(ValidationError(
                node_id=n.id,
                field="type",
                code="ML_NODE_NOT_ALLOWED",
                message=f"Node type '{n.type}' is not allowed in an ml_pipeline project.",
            ))


def _check_required_config(project: Project, errors: list[ValidationError]) -> None:
    for n in project.nodes:
        for field_name in _REQUIRED_CONFIG_ML.get(n.type, []):
            if not n.config.get(field_name):
                errors.append(ValidationError(
                    node_id=n.id,
                    field=field_name,
                    code="MISSING_REQUIRED_FIELD",
                    message=f"Node '{n.id}' ({n.type}) requires config field '{field_name}'.",
                ))


def _check_pipeline_shape(project: Project, errors: list[ValidationError]) -> None:
    # At least one training_job (otherwise nothing to deploy).
    if not project.has_node_type("training_job"):
        errors.append(ValidationError(
            node_id=None, field=None, code="ML_NO_TRAINING_JOB",
            message="An ml_pipeline project must contain at least one training_job node.",
        ))

    # endpoint_realtime requires an upstream model_register (enforced by reachability).
    has_endpoint = project.has_node_type("endpoint_realtime")
    has_register = project.has_node_type("model_register")
    if has_endpoint and not has_register:
        errors.append(ValidationError(
            node_id=None, field=None, code="ML_ENDPOINT_WITHOUT_REGISTRY",
            message="endpoint_realtime requires a model_register node upstream.",
        ))


def _check_topology(
    project: Project,
    node_map: dict[str, Node],
    errors: list[ValidationError],
) -> None:
    for e in project.edges:
        up = node_map.get(e.source_node_id)
        down = node_map.get(e.target_node_id)
        if up is None or down is None:
            continue  # reported by edge-reference check
        allowed = _ALLOWED_DOWNSTREAM.get(up.type)
        if allowed is None:
            continue  # generic upstream (input/condition) — accept any downstream
        if down.type in _ML_GENERIC_TYPES:
            continue  # generic downstream always allowed
        if down.type not in allowed:
            errors.append(ValidationError(
                node_id=e.target_node_id,
                field=None,
                code="INVALID_ML_TOPOLOGY",
                message=(
                    f"Edge {e.source_node_id} -> {e.target_node_id}: "
                    f"'{down.type}' is not a valid downstream of '{up.type}'."
                ),
            ))


def _check_edges_reference_known_nodes(
    project: Project,
    node_map: dict[str, Node],
    errors: list[ValidationError],
) -> None:
    for e in project.edges:
        if e.source_node_id not in node_map:
            errors.append(ValidationError(
                node_id=e.source_node_id, field=None, code="UNKNOWN_EDGE_SOURCE",
                message=f"Edge references unknown source node '{e.source_node_id}'.",
            ))
        if e.target_node_id not in node_map:
            errors.append(ValidationError(
                node_id=e.target_node_id, field=None, code="UNKNOWN_EDGE_TARGET",
                message=f"Edge references unknown target node '{e.target_node_id}'.",
            ))


def _topological_sort(
    project: Project,
    node_map: dict[str, Node],
    errors: list[ValidationError],
) -> list[Node]:
    indegree: dict[str, int] = defaultdict(int)
    successors: dict[str, list[str]] = defaultdict(list)
    for n in project.nodes:
        indegree[n.id] = 0
    for e in project.edges:
        if e.source_node_id in node_map and e.target_node_id in node_map:
            successors[e.source_node_id].append(e.target_node_id)
            indegree[e.target_node_id] += 1

    queue = deque([nid for nid, deg in indegree.items() if deg == 0])
    ordered: list[Node] = []
    while queue:
        nid = queue.popleft()
        ordered.append(node_map[nid])
        for succ in successors[nid]:
            indegree[succ] -= 1
            if indegree[succ] == 0:
                queue.append(succ)

    if len(ordered) != len(project.nodes):
        errors.append(ValidationError(
            node_id=None, field=None, code="CYCLE_DETECTED",
            message="ML pipeline graph has a cycle — SageMaker Pipelines must be a DAG.",
        ))
    return ordered
