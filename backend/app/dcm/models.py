"""Pydantic models for the DCM (Data Contract Manager) domain."""
from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, Field


# ── Auth ──────────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class UserInfo(BaseModel):
    id: str
    name: str
    email: str
    role: str  # VIEWER | CREATOR | ADMIN


# ── Contract ─────────────────────────────────────────────────────────────────────

class Location(BaseModel):
    layer: str = "BRONZE"
    bucket: str = ""
    path: str = ""
    format: str = "PARQUET"
    compression: str = "SNAPPY"


class SLA(BaseModel):
    freshness: str = "daily"
    max_latency_minutes: int = 60
    availability_percent: float = 99.0
    retention_days: int = 365
    alert_email: str = ""


class Partitioning(BaseModel):
    strategy: str = "DATE"
    partition_column: str = ""
    partition_format: str = "yyyy/MM/dd"
    pruning_enabled: bool = False


class FieldSchema(BaseModel):
    name: str
    type: str = "STRING"
    nullable: bool = True
    pk: bool = False
    pii: str = "NONE"
    description: str = ""


class HistoryEntry(BaseModel):
    version: str
    date: str
    author: str
    note: str


class MLMetadata(BaseModel):
    """Reference to the SageMaker Feature Group this contract was promoted to.

    Populated by POST /api/dcm/contracts/{id}/promote-feature-group; consumed
    by the agents Studio (feature_lookup tool) so a single contract is the
    source of truth for both data governance and ML features.
    """
    feature_group_name: str = ""
    feature_group_arn: str = ""
    record_identifier: str = ""           # PK field of the contract
    event_time_feature_name: str = "event_time"
    online_enabled: bool = True


class Contract(BaseModel):
    id: str
    name: str
    description: str = ""
    status: str = "DRAFT"
    version: str = "0.1.0"
    environment: str = "DEV"
    domain: str = ""
    team: str = ""
    owner: str = ""
    source_system: str = ""
    data_classification: str = "INTERNAL"
    tags: list[str] = Field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""
    location: Location = Field(default_factory=Location)
    sla: SLA = Field(default_factory=SLA)
    partitioning: Partitioning = Field(default_factory=Partitioning)
    fields: list[FieldSchema] = Field(default_factory=list)
    history: list[HistoryEntry] = Field(default_factory=list)
    ml_metadata: MLMetadata | None = None


class ContractCreate(BaseModel):
    name: str
    description: str = ""
    domain: str = ""
    team: str = ""
    owner: str = ""
    source_system: str = ""
    data_classification: str = "INTERNAL"
    tags: str = ""
    layer: str = "BRONZE"
    bucket: str = ""
    path: str = ""
    fmt: str = "PARQUET"
    compression: str = "SNAPPY"
    freshness: str = "daily"
    max_latency_minutes: int = 60
    availability_percent: float = 99.0
    retention_days: int = 365
    alert_email: str = ""
    partition_strategy: str = "DATE"
    partition_column: str = ""
    partition_format: str = "yyyy/MM/dd"
    pruning_enabled: bool = False
    fields: list[FieldSchema] = Field(default_factory=list)


class ContractListResponse(BaseModel):
    contracts: list[Contract]
    total: int
    status: str = ""
    layer: str = ""
    q: str = ""


class ExportResponse(BaseModel):
    content: str
    lang: str
    format: str
    contract_name: str


# ── Change Request ────────────────────────────────────────────────────────────────

class DiffChange(BaseModel):
    op: str
    field: str
    old: Any = None
    new: Any = None


class Diff(BaseModel):
    version_from: str | None = None
    version_to: str = ""
    changes: list[DiffChange] = Field(default_factory=list)


class Comment(BaseModel):
    author: str
    date: str
    text: str


class ChangeRequest(BaseModel):
    id: str
    title: str
    type: str = "CREATE"
    contract_id: str = ""
    contract_name: str = ""
    requester: str = ""
    requester_name: str = ""
    status: str = "OPEN"
    created_at: str = ""
    updated_at: str = ""
    description: str = ""
    diff: Diff = Field(default_factory=Diff)
    comments: list[Comment] = Field(default_factory=list)


class ChangeRequestListResponse(BaseModel):
    requests: list[ChangeRequest]
    total: int
    status: str = ""


class CommentCreate(BaseModel):
    text: str


class ChangeRequestCreate(BaseModel):
    contract_id: str
    type: str = "AMEND"
    title: str
    description: str = ""
    target_version: str = ""
    changes: list[DiffChange] = Field(default_factory=list)


class ApprovalResponse(BaseModel):
    ok: bool
    message: str = ""


# ── Dashboard ─────────────────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total: int
    pending: int
    approved_this_month: int
    pii_fields: int
    by_layer: dict[str, int]


# ── Feature Store promotion ───────────────────────────────────────────────────────

class PromoteFeatureGroupRequest(BaseModel):
    feature_group_name: str = ""             # defaults to contract.name when empty
    online_enabled: bool = True
    event_time_feature_name: str = "event_time"


class PromoteFeatureGroupResponse(BaseModel):
    feature_group_name: str
    terraform: str                            # snippet a apply on the customer's AWS account
    feature_definitions: list[dict]           # nome + tipo (String / Integral / Fractional)
    record_identifier: str
