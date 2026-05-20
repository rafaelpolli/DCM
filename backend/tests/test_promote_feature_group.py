"""Tests for the DCM → SageMaker Feature Store promotion endpoint."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Ensure backend/app is importable as the `app.*` package the router uses.
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# python-jose is a hard dep of app.auth (imported transitively by app.dcm.router).
# Skip gracefully when it's missing from the test runner's interpreter.
pytest.importorskip("jose")

from fastapi import HTTPException  # noqa: E402

from app.dcm import router as dcm_router  # noqa: E402
from app.dcm.models import PromoteFeatureGroupRequest  # noqa: E402


@pytest.fixture
def seeded_contract(monkeypatch):
    """Inject a single contract into the router's in-memory state."""
    contract = {
        "id": "c-001",
        "name": "customer-profile",
        "fields": [
            {"name": "customer_id", "type": "STRING", "pk": True},
            {"name": "credit_score", "type": "INTEGER"},
            {"name": "lifetime_value", "type": "DOUBLE"},
            {"name": "tier", "type": "STRING"},
        ],
    }
    monkeypatch.setattr(dcm_router, "_contracts", {"c-001": contract})
    monkeypatch.setattr(dcm_router, "_requests", {})

    # Avoid writing to the real SQLite during tests.
    import app.dcm.storage as storage
    monkeypatch.setattr(storage, "save_contract", lambda c: None)
    return contract


def test_promote_emits_terraform_with_feature_definitions(seeded_contract):
    response = dcm_router.promote_feature_group(
        cid="c-001",
        body=PromoteFeatureGroupRequest(),
        user={"name": "tester"},
    )

    assert response.feature_group_name == "customer-profile"
    assert response.record_identifier == "customer_id"
    names = {d["FeatureName"]: d["FeatureType"] for d in response.feature_definitions}
    assert names["customer_id"] == "String"
    assert names["credit_score"] == "Integral"
    assert names["lifetime_value"] == "Fractional"
    assert names["event_time"] == "Fractional"
    assert 'aws_sagemaker_feature_group' in response.terraform
    assert 'customer-profile' in response.terraform
    assert 'feature_name = "credit_score"' in response.terraform


def test_promote_stamps_ml_metadata_on_contract(seeded_contract):
    dcm_router.promote_feature_group(
        cid="c-001",
        body=PromoteFeatureGroupRequest(feature_group_name="profiles-v2"),
        user={"name": "tester"},
    )
    md = seeded_contract["ml_metadata"]
    assert md["feature_group_name"] == "profiles-v2"
    assert md["record_identifier"] == "customer_id"


def test_promote_rejects_contract_without_primary_key(monkeypatch):
    contract = {"id": "c-002", "name": "no-pk", "fields": [
        {"name": "x", "type": "STRING"},
    ]}
    monkeypatch.setattr(dcm_router, "_contracts", {"c-002": contract})
    monkeypatch.setattr(dcm_router, "_requests", {})

    with pytest.raises(HTTPException) as exc:
        dcm_router.promote_feature_group(
            cid="c-002",
            body=PromoteFeatureGroupRequest(),
            user={"name": "tester"},
        )
    assert exc.value.status_code == 400
    assert "primary-key" in exc.value.detail


def test_promote_rejects_unknown_contract(monkeypatch):
    monkeypatch.setattr(dcm_router, "_contracts", {})
    monkeypatch.setattr(dcm_router, "_requests", {})

    with pytest.raises(HTTPException) as exc:
        dcm_router.promote_feature_group(
            cid="missing",
            body=PromoteFeatureGroupRequest(),
            user={"name": "tester"},
        )
    assert exc.value.status_code == 404
