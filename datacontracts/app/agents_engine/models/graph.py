from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

DataType = Literal["any", "string", "json", "document", "vector", "control", "retriever"]

NodeType = Literal[
    "input", "output",
    "agent", "multi_agent_coordinator", "human_in_the_loop",
    "tool_custom", "tool_athena", "tool_s3", "tool_http", "tool_bedrock",
    "kb_s3_vector", "kb_bedrock", "chunking", "embedding", "retriever",
    "s3_source", "document_parser", "ingest_pipeline",
    "mcp_server", "mcp_client",
    "code_interpreter", "browser_tool",
    "condition", "loop", "cache", "logger",
]

TOOL_NODE_TYPES: frozenset[str] = frozenset({
    "tool_custom", "tool_athena", "tool_s3", "tool_http", "tool_bedrock",
})

KB_NODE_TYPES: frozenset[str] = frozenset({
    "kb_s3_vector", "kb_bedrock", "chunking", "embedding", "retriever",
    "s3_source", "document_parser", "ingest_pipeline",
})


class Port(BaseModel):
    id: str
    name: str
    data_type: DataType
    required: bool = False


class NodePorts(BaseModel):
    inputs: list[Port] = Field(default_factory=list)
    outputs: list[Port] = Field(default_factory=list)


class NodeMetadata(BaseModel):
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    notes: str | None = None


class Position(BaseModel):
    x: float = 0.0
    y: float = 0.0


class Node(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: NodeType
    label: str
    position: Position = Field(default_factory=Position)
    config: dict[str, Any] = Field(default_factory=dict)
    ports: NodePorts = Field(default_factory=NodePorts)
    metadata: NodeMetadata = Field(default_factory=NodeMetadata)

    def is_tool(self) -> bool:
        return self.type in TOOL_NODE_TYPES

    def is_kb(self) -> bool:
        return self.type in KB_NODE_TYPES


class Edge(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source_node_id: str
    source_port_id: str
    target_node_id: str
    target_port_id: str
    data_type: DataType
    transform: str | None = None


class Group(BaseModel):
    id: str
    label: str
    node_ids: list[str]


class CanvasViewport(BaseModel):
    x: float = 0.0
    y: float = 0.0
    zoom: float = 1.0


class Canvas(BaseModel):
    viewport: CanvasViewport = Field(default_factory=CanvasViewport)


class Project(BaseModel):
    schema_version: str = "1.0.0"
    platform_version: str = "0.1.0"
    name: str
    description: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    exported_at: datetime | None = None
    tags: list[str] = Field(default_factory=list)
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)
    groups: list[Group] = Field(default_factory=list)
    canvas: Canvas = Field(default_factory=Canvas)

    def node_map(self) -> dict[str, Node]:
        return {n.id: n for n in self.nodes}

    def edges_from(self, node_id: str) -> list[Edge]:
        return [e for e in self.edges if e.source_node_id == node_id]

    def edges_to(self, node_id: str) -> list[Edge]:
        return [e for e in self.edges if e.target_node_id == node_id]

    def has_node_type(self, node_type: str) -> bool:
        return any(n.type == node_type for n in self.nodes)
