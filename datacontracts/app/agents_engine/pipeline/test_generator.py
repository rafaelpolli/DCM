"""Phase 4: Test Generator — emits pytest files, one per tool node."""
from __future__ import annotations

from .._types import CompiledArtifacts, CompiledFile
from ..models.graph import Node, Project


def generate_tests(project: Project) -> CompiledArtifacts:
    artifacts = CompiledArtifacts()
    tool_nodes = [n for n in project.nodes if n.is_tool()]

    artifacts.add(_gen_conftest())
    for n in tool_nodes:
        artifacts.add(_gen_tool_test(n))

    return artifacts


def _gen_conftest() -> CompiledFile:
    content = '''\
import os
import pytest


@pytest.fixture(autouse=True)
def aws_credentials(monkeypatch):
    """Fake AWS credentials so moto can intercept boto3 calls."""
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.setenv("AGENT_NAME", "test-agent")
    monkeypatch.setenv("CHECKPOINTER_TABLE", "test-agent-sessions")
    monkeypatch.setenv("CACHE_TABLE", "test-agent-cache")
'''
    return CompiledFile(path="tests/conftest.py", content=content)


def _gen_tool_test(node: Node) -> CompiledFile:
    dispatch = {
        "tool_custom": _test_tool_custom,
        "tool_athena": _test_tool_athena,
        "tool_s3": _test_tool_s3,
        "tool_http": _test_tool_http,
        "tool_bedrock": _test_tool_bedrock,
    }
    generator = dispatch.get(node.type, _test_generic)
    return generator(node)


def _fn_name(node: Node) -> str:
    name = node.config.get("name", f"tool_{node.id}")
    return name.replace("-", "_").replace(" ", "_").lower()


def _test_tool_custom(node: Node) -> CompiledFile:
    fn = _fn_name(node)
    content = f'''\
import pytest
from agent.tools.{node.id} import {fn}


def test_{fn}_returns_dict():
    """Basic smoke test — {fn} should return a dict."""
    result = {fn}.invoke({{}})
    assert isinstance(result, dict)
'''
    return CompiledFile(path=f"tests/test_{fn}.py", content=content)


def _test_tool_athena(node: Node) -> CompiledFile:
    fn = _fn_name(node)
    content = f'''\
import pytest
from moto import mock_aws
import boto3

from agent.tools.{node.id} import {fn}


@mock_aws
def test_{fn}_query_executes():
    """Verifies Athena tool submits a query and handles SUCCEEDED state."""
    import boto3
    from unittest.mock import patch, MagicMock

    mock_client = MagicMock()
    mock_client.start_query_execution.return_value = {{"QueryExecutionId": "test-qid"}}
    mock_client.get_query_execution.return_value = {{
        "QueryExecution": {{"Status": {{"State": "SUCCEEDED"}}}}
    }}
    mock_client.get_query_results.return_value = {{
        "ResultSet": {{
            "Rows": [
                {{"Data": [{{"VarCharValue": "col1"}}, {{"VarCharValue": "col2"}}]}},
                {{"Data": [{{"VarCharValue": "val1"}}, {{"VarCharValue": "val2"}}]}},
            ]
        }}
    }}

    with patch("boto3.client", return_value=mock_client):
        result = {fn}.invoke({{"values": ["test"]}})

    assert isinstance(result, list)
    assert result[0]["col1"] == "val1"
'''
    return CompiledFile(path=f"tests/test_{fn}.py", content=content)


def _test_tool_s3(node: Node) -> CompiledFile:
    fn = _fn_name(node)
    operation = node.config.get("operation", "read")
    bucket = node.config.get("bucket", "test-bucket")
    content = f'''\
import json
import pytest
import boto3
from moto import mock_aws

from agent.tools.{node.id} import {fn}


@mock_aws
def test_{fn}_{operation}():
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket="{bucket}")
    s3.put_object(Bucket="{bucket}", Key="test/key", Body=json.dumps({{"value": 42}}))

    result = {fn}.invoke({{"key": "test/key"}})
    assert result is not None
'''
    return CompiledFile(path=f"tests/test_{fn}.py", content=content)


def _test_tool_http(node: Node) -> CompiledFile:
    fn = _fn_name(node)
    content = f'''\
import pytest
import responses as resp

from agent.tools.{node.id} import {fn}


@resp.activate
def test_{fn}_success():
    resp.add(
        resp.{node.config.get("method", "GET")},
        "{node.config.get("base_url", "https://example.com")}",
        json={{"ok": True}},
        status=200,
    )
    result = {fn}.invoke({{}})
    assert result["status_code"] == 200
    assert result["body"]["ok"] is True
'''
    return CompiledFile(path=f"tests/test_{fn}.py", content=content)


def _test_tool_bedrock(node: Node) -> CompiledFile:
    fn = _fn_name(node)
    content = f'''\
import json
import pytest
from unittest.mock import MagicMock, patch

from agent.tools.{node.id} import {fn}


def test_{fn}_invokes_bedrock():
    mock_response = {{
        "body": MagicMock(read=lambda: json.dumps({{"result": "ok"}}).encode())
    }}
    with patch("boto3.client") as mock_client:
        mock_client.return_value.invoke_model.return_value = mock_response
        result = {fn}.invoke({{"prompt": "hello"}})
    assert isinstance(result, dict)
'''
    return CompiledFile(path=f"tests/test_{fn}.py", content=content)


def _test_generic(node: Node) -> CompiledFile:
    fn = _fn_name(node)
    content = f'''\
import pytest


def test_{fn}_placeholder():
    """Placeholder test for {node.type} node '{node.id}'."""
    pass
'''
    return CompiledFile(path=f"tests/test_{fn}.py", content=content)
