"""DCM REST API router — contracts, change requests, dashboard."""
from __future__ import annotations

import json
from datetime import date
from typing import Annotated

import yaml
from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.dcm.mock_data import (
    SEED_CONTRACTS,
    SEED_REQUESTS,
    USERS,
    compute_stats,
    next_contract_id,
    next_request_id,
    recent_requests,
)
from app.dcm.models import (
    ApprovalResponse,
    ChangeRequestCreate,
    ChangeRequestListResponse,
    CommentCreate,
    ContractCreate,
    ContractListResponse,
    ExportResponse,
    MLMetadata,
    PromoteFeatureGroupRequest,
    PromoteFeatureGroupResponse,
)

router = APIRouter()

# ── In-memory state (loaded from SQLite or seed on startup) ──────────────────
_contracts: dict[str, dict] = {}
_requests: dict[str, dict] = {}


def init_state(contracts: dict, requests: dict) -> None:
    global _contracts, _requests
    _contracts = contracts
    _requests = requests


# ── Dashboard ────────────────────────────────────────────────────────────────

@router.get("/dashboard", dependencies=[Depends(get_current_user)])
def dashboard() -> dict:
    stats = compute_stats(_contracts)
    recent = recent_requests(_requests, 5)
    return {"stats": stats, "recent": recent}


# ── Contracts ────────────────────────────────────────────────────────────────

@router.get("/contracts", dependencies=[Depends(get_current_user)])
def contracts_list(
    status: str = "",
    layer: str = "",
    q: str = "",
) -> dict:
    items = list(_contracts.values())
    if status:
        items = [c for c in items if c["status"] == status]
    if layer:
        items = [c for c in items if c["location"]["layer"] == layer]
    if q:
        items = [c for c in items if q.lower() in c["name"].lower()]
    return {"contracts": items, "total": len(items)}


@router.get("/contracts/{cid}", dependencies=[Depends(get_current_user)])
def contract_detail(cid: str) -> dict:
    contract = _contracts.get(cid)
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")
    related = [r for r in _requests.values() if r["contract_id"] == cid]
    return {"contract": contract, "related_requests": related}


@router.post("/contracts")
def contract_create(
    body: ContractCreate,
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    role = user.get("role", "viewer")
    if role not in ("creator", "admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    cid = next_contract_id()
    today = str(date.today())

    contract: dict = {
        "id": cid,
        "name": body.name,
        "description": body.description,
        "status": "DRAFT",
        "version": "0.1.0",
        "environment": "DEV",
        "domain": body.domain,
        "team": body.team,
        "owner": body.owner,
        "source_system": body.source_system,
        "data_classification": body.data_classification,
        "tags": [t.strip() for t in body.tags.split(",") if t.strip()],
        "created_at": today,
        "updated_at": today,
        "location": {
            "layer": body.layer,
            "bucket": body.bucket,
            "path": body.path,
            "format": body.fmt,
            "compression": body.compression,
        },
        "sla": {
            "freshness": body.freshness,
            "max_latency_minutes": body.max_latency_minutes,
            "availability_percent": body.availability_percent,
            "retention_days": body.retention_days,
            "alert_email": body.alert_email,
        },
        "partitioning": {
            "strategy": body.partition_strategy,
            "partition_column": body.partition_column,
            "partition_format": body.partition_format,
            "pruning_enabled": body.pruning_enabled,
        },
        "fields": [f.model_dump() for f in body.fields],
        "history": [
            {
                "version": "0.1.0",
                "date": today,
                "author": user.get("email", ""),
                "note": "Initial draft",
            }
        ],
    }
    _contracts[cid] = contract

    rid = next_request_id()
    _requests[rid] = {
        "id": rid,
        "title": f"Criar contrato {body.name}",
        "type": "CREATE",
        "contract_id": cid,
        "contract_name": body.name,
        "requester": user.get("email", ""),
        "requester_name": user.get("name", ""),
        "status": "OPEN",
        "created_at": today,
        "updated_at": today,
        "description": body.description,
        "diff": {"version_from": None, "version_to": "0.1.0", "changes": []},
        "comments": [],
    }

    from app.dcm.storage import save_change_request, save_contract
    save_contract(contract)
    save_change_request(_requests[rid])

    return {"ok": True, "id": cid}


@router.get("/contracts/{cid}/export", dependencies=[Depends(get_current_user)])
def contract_export(cid: str, format: str = "json") -> dict:
    contract = _contracts.get(cid)
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    if format == "json":
        content = json.dumps(contract, indent=2, ensure_ascii=False)
        lang = "json"
    elif format == "yaml":
        content = yaml.dump(contract, allow_unicode=True, default_flow_style=False)
        lang = "yaml"
    elif format == "ddl":
        loc = contract["location"]
        part = contract["partitioning"]
        lines = [
            f"-- DataContract: {contract['name']} v{contract['version']}",
            f"-- Layer: {loc['layer']} | Format: {loc['format']} | Partition: {part['partition_column']} ({part['strategy']})",
            f"CREATE TABLE {loc['layer'].lower()}.{contract['name']} (",
        ]
        field_lines = []
        for f in contract["fields"]:
            null_str = "" if f["nullable"] else " NOT NULL"
            comments = []
            if f.get("pii") and f["pii"] != "NONE":
                comments.append(f"PII: {f['pii']}")
            if f.get("partition_key"):
                comments.append("PARTITION KEY")
            comment = f"  -- {', '.join(comments)}" if comments else ""
            field_lines.append(
                f"  {f['name']:<20} {f['type']:<10}{null_str}{comment}"
            )
        lines.append(",\n".join(field_lines))
        lines.append(
            f")\nPARTITIONED BY ({part['partition_column']})\n"
            f"STORED AS {loc['format']};"
        )
        content = "\n".join(lines)
        lang = "sql"
    else:
        raise HTTPException(status_code=400, detail="Invalid format")

    return {
        "content": content,
        "lang": lang,
        "format": format,
        "contract_name": contract["name"],
    }


# ── Change Requests ──────────────────────────────────────────────────────────

@router.post("/requests")
def request_create(
    body: ChangeRequestCreate,
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    role = user.get("role", "viewer")
    if role not in ("creator", "admin"):
        raise HTTPException(status_code=403, detail="Creator or admin role required")

    contract = _contracts.get(body.contract_id)
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Title required")

    valid_types = {"AMEND", "SCHEMA_CHANGE", "SLA_CHANGE", "QUALITY_CHANGE", "UPDATE", "DEPRECATE", "DELETE"}
    if body.type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid type. Must be one of {sorted(valid_types)}")

    today = str(date.today())
    rid = next_request_id()
    version_from = contract.get("version", "")

    changes = []
    for c in body.changes:
        changes.append({
            "op": c.op,
            "field": c.field,
            "from": c.old,
            "to": c.new,
        })

    _requests[rid] = {
        "id": rid,
        "title": body.title.strip(),
        "type": body.type,
        "contract_id": body.contract_id,
        "contract_name": contract.get("name", ""),
        "requester": user.get("email", ""),
        "requester_name": user.get("name", ""),
        "status": "OPEN",
        "created_at": today,
        "updated_at": today,
        "description": body.description.strip(),
        "diff": {
            "version_from": version_from or None,
            "version_to": body.target_version.strip(),
            "changes": changes,
        },
        "comments": [],
    }

    from app.dcm.storage import save_change_request
    save_change_request(_requests[rid])

    return {"ok": True, "id": rid}


@router.get("/requests", dependencies=[Depends(get_current_user)])
def requests_list(
    user: Annotated[dict, Depends(get_current_user)],
    status: str = "",
) -> dict:
    role = user.get("role", "viewer")
    email = user.get("email", "")
    items = list(_requests.values())
    if role == "creator":
        items = [r for r in items if r["requester"] == email]
    if status:
        items = [r for r in items if r["status"] == status]
    return {"requests": items, "total": len(items)}


@router.get("/requests/{rid}", dependencies=[Depends(get_current_user)])
def request_detail(rid: str) -> dict:
    req = _requests.get(rid)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    contract = _contracts.get(req["contract_id"])
    return {"request": req, "contract": contract}


@router.post("/requests/{rid}/approve")
def request_approve(
    rid: str,
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    req = _requests.get(rid)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    req["status"] = "APPROVED"
    req["updated_at"] = str(date.today())
    contract = _contracts.get(req["contract_id"])
    if contract and contract["status"] == "PENDING":
        contract["status"] = "APPROVED"

    from app.dcm.storage import save_change_request, save_contract
    save_change_request(req)
    if contract:
        save_contract(contract)

    return {"ok": True, "message": "Request approved"}


@router.post("/requests/{rid}/reject")
def request_reject(
    rid: str,
    body: CommentCreate,
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    req = _requests.get(rid)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    req["status"] = "REJECTED"
    req["updated_at"] = str(date.today())
    if body.text.strip():
        req.setdefault("comments", []).append({
            "author": user.get("name", ""),
            "date": str(date.today()),
            "text": f"[Rejeicao] {body.text.strip()}",
        })

    from app.dcm.storage import save_change_request
    save_change_request(req)

    return {"ok": True, "message": "Request rejected"}


@router.post("/requests/{rid}/comment")
def add_comment(
    rid: str,
    body: CommentCreate,
    user: Annotated[dict, Depends(get_current_user)],
) -> dict:
    req = _requests.get(rid)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Comment text required")

    comment = {
        "author": user.get("name", ""),
        "date": str(date.today()),
        "text": body.text.strip(),
    }
    req.setdefault("comments", []).append(comment)

    from app.dcm.storage import save_change_request
    save_change_request(req)

    return {"ok": True, "comment": comment}


# ── Feature Store promotion ──────────────────────────────────────────────────

# Maps DCM contract field types to SageMaker Feature Store feature definitions.
_FEATURE_TYPE_MAP = {
    "STRING": "String",
    "VARCHAR": "String",
    "TEXT": "String",
    "TIMESTAMP": "String",   # event time stays String; Feature Store parses ISO
    "DATE": "String",
    "BOOLEAN": "String",     # Feature Store has no Bool type — store as String
    "INT": "Integral",
    "INTEGER": "Integral",
    "BIGINT": "Integral",
    "LONG": "Integral",
    "FLOAT": "Fractional",
    "DOUBLE": "Fractional",
    "DECIMAL": "Fractional",
    "NUMERIC": "Fractional",
}


def _contract_to_feature_definitions(contract: dict, event_time_name: str) -> list[dict]:
    defs = []
    seen = set()
    for f in contract.get("fields", []):
        name = f.get("name", "").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        sm_type = _FEATURE_TYPE_MAP.get(f.get("type", "STRING").upper(), "String")
        defs.append({"FeatureName": name, "FeatureType": sm_type})
    if event_time_name not in seen:
        defs.append({"FeatureName": event_time_name, "FeatureType": "Fractional"})
    return defs


def _terraform_for_feature_group(
    feature_group_name: str,
    record_identifier: str,
    event_time_feature_name: str,
    online_enabled: bool,
    feature_definitions: list[dict],
) -> str:
    feature_blocks = "\n".join(
        f'  feature_definition {{\n'
        f'    feature_name = "{d["FeatureName"]}"\n'
        f'    feature_type = "{d["FeatureType"]}"\n'
        f'  }}'
        for d in feature_definitions
    )

    return f'''\
# Promoted from DCM contract.
# Apply with: terraform apply -target=aws_sagemaker_feature_group.{feature_group_name.replace("-", "_")}

resource "aws_sagemaker_feature_group" "{feature_group_name.replace("-", "_")}" {{
  feature_group_name             = "{feature_group_name}"
  record_identifier_feature_name = "{record_identifier}"
  event_time_feature_name        = "{event_time_feature_name}"
  role_arn                       = var.feature_store_role_arn

  online_store_config {{
    enable_online_store = {str(online_enabled).lower()}
  }}

  offline_store_config {{
    s3_storage_config {{
      s3_uri = "s3://${{var.feature_store_bucket}}/${{var.environment}}/{feature_group_name}/"
    }}
    disable_glue_table_creation = false
  }}

{feature_blocks}
}}
'''


@router.post("/contracts/{cid}/promote-feature-group", response_model=PromoteFeatureGroupResponse)
def promote_feature_group(
    cid: str,
    body: PromoteFeatureGroupRequest,
    user: Annotated[dict, Depends(get_current_user)],
) -> PromoteFeatureGroupResponse:
    """Promote a DCM contract to a SageMaker Feature Group.

    Returns Terraform for `aws_sagemaker_feature_group` whose
    `feature_definition` blocks mirror the contract's fields, plus the
    record identifier (the contract's PK) and an event_time feature.
    Also stamps ml_metadata back on the contract.
    """
    contract = _contracts.get(cid)
    if not contract:
        raise HTTPException(status_code=404, detail="Contract not found")

    pk_fields = [f for f in contract.get("fields", []) if f.get("pk")]
    if not pk_fields:
        raise HTTPException(
            status_code=400,
            detail="Contract has no primary-key field. Mark one field as pk=true before promoting.",
        )
    if len(pk_fields) > 1:
        raise HTTPException(
            status_code=400,
            detail="SageMaker Feature Group requires exactly one record identifier; contract has multiple pk fields.",
        )
    record_identifier = pk_fields[0]["name"]

    feature_group_name = (body.feature_group_name or contract["name"]).strip()
    feature_definitions = _contract_to_feature_definitions(contract, body.event_time_feature_name)
    tf = _terraform_for_feature_group(
        feature_group_name=feature_group_name,
        record_identifier=record_identifier,
        event_time_feature_name=body.event_time_feature_name,
        online_enabled=body.online_enabled,
        feature_definitions=feature_definitions,
    )

    # Stamp back on the contract so the agents Studio can wire feature_lookup
    # against the same group without re-asking the user.
    contract["ml_metadata"] = MLMetadata(
        feature_group_name=feature_group_name,
        feature_group_arn="",   # filled in by terraform apply downstream
        record_identifier=record_identifier,
        event_time_feature_name=body.event_time_feature_name,
        online_enabled=body.online_enabled,
    ).model_dump()

    from app.dcm.storage import save_contract
    save_contract(contract)

    return PromoteFeatureGroupResponse(
        feature_group_name=feature_group_name,
        terraform=tf,
        feature_definitions=feature_definitions,
        record_identifier=record_identifier,
    )
