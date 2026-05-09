"""Generates agent/tools/{node_id}.py for each tool node type."""
from __future__ import annotations

import textwrap

from ..._types import CompiledFile
from ...models.graph import Node


def generate_tool(node: Node) -> CompiledFile:
    dispatch = {
        "tool_custom": _gen_tool_custom,
        "tool_athena": _gen_tool_athena,
        "tool_s3": _gen_tool_s3,
        "tool_http": _gen_tool_http,
        "tool_bedrock": _gen_tool_bedrock,
    }
    generator = dispatch.get(node.type)
    if generator is None:
        raise ValueError(f"No tool generator for node type '{node.type}'")
    return generator(node)


def _fn_name(node: Node) -> str:
    name = node.config.get("name", f"tool_{node.id}")
    return name.replace("-", "_").replace(" ", "_").lower()


def _gen_tool_custom(node: Node) -> CompiledFile:
    fn = _fn_name(node)
    desc = node.config.get("description", "")
    runtime = node.config.get("runtime", "inline")
    input_schema: dict = node.config.get("input_schema", {})
    params = _schema_to_params(input_schema)

    if runtime == "inline":
        inline = node.config.get("inline_code", "    return {}")
        indented = textwrap.indent(textwrap.dedent(inline), "    ")
        content = f'''\
from langchain_core.tools import tool


@tool
def {fn}({params}) -> dict:
    """{desc}"""
    # --- BEGIN USER CODE ---
{indented}
    # --- END USER CODE ---
'''
    else:
        lambda_arn = node.config.get("lambda_arn", "")
        content = f'''\
import json

import boto3
from langchain_core.tools import tool

_lambda = boto3.client("lambda")


@tool
def {fn}({params}) -> dict:
    """{desc}"""
    response = _lambda.invoke(
        FunctionName="{lambda_arn}",
        Payload=json.dumps({{{_params_to_dict(input_schema)}}}),
    )
    return json.loads(response["Payload"].read())
'''
    return CompiledFile(path=f"agent/tools/{node.id}.py", content=content)


def _gen_tool_athena(node: Node) -> CompiledFile:
    fn = _fn_name(node)
    desc = node.config.get("description", "")
    database = node.config.get("database", "")
    workgroup = node.config.get("workgroup", "primary")
    query = node.config.get("query_template", "")
    output_loc = node.config.get("output_location", "")
    max_rows = node.config.get("max_rows", 100)

    content = f'''\
import time

import boto3
from langchain_core.tools import tool

_athena = boto3.client("athena")


@tool
def {fn}(params: dict) -> list:
    """{desc}

    params: dict with key "values" containing a list of positional parameter values
    matching the ? placeholders in the query template.
    """
    response = _athena.start_query_execution(
        QueryString="{query}",
        QueryExecutionContext={{"Database": "{database}"}},
        WorkGroup="{workgroup}",
        ResultConfiguration={{"OutputLocation": "{output_loc}"}},
        ExecutionParameters=[str(v) for v in params.get("values", [])],
    )
    execution_id = response["QueryExecutionId"]

    while True:
        status = _athena.get_query_execution(QueryExecutionId=execution_id)
        state = status["QueryExecution"]["Status"]["State"]
        if state in ("SUCCEEDED", "FAILED", "CANCELLED"):
            break
        time.sleep(0.5)

    if state != "SUCCEEDED":
        raise RuntimeError(f"Athena query {{execution_id}} {{state}}")

    result = _athena.get_query_results(QueryExecutionId=execution_id, MaxResults={max_rows})
    rows = result["ResultSet"]["Rows"]
    if not rows:
        return []
    headers = [c["VarCharValue"] for c in rows[0]["Data"]]
    return [
        dict(zip(headers, [c.get("VarCharValue", "") for c in row["Data"]]))
        for row in rows[1:]
    ]
'''
    return CompiledFile(path=f"agent/tools/{node.id}.py", content=content)


def _gen_tool_s3(node: Node) -> CompiledFile:
    fn = _fn_name(node)
    desc = node.config.get("description", "")
    operation = node.config.get("operation", "read")
    bucket = node.config.get("bucket", "")
    key_template = node.config.get("key_template", "{{key}}")

    content = f'''\
import boto3
from langchain_core.tools import tool

_s3 = boto3.client("s3")


@tool
def {fn}(input: dict) -> dict:
    """{desc}"""
    key = "{key_template}".format(**input)
'''
    if operation == "read":
        content += f'''\
    response = _s3.get_object(Bucket="{bucket}", Key=key)
    body = response["Body"].read()
    try:
        import json
        return {{"content": json.loads(body), "key": key}}
    except Exception:
        return {{"content": body.decode("utf-8", errors="replace"), "key": key}}
'''
    elif operation == "write":
        content += f'''\
    import json
    data = input.get("content", "")
    body = json.dumps(data) if isinstance(data, (dict, list)) else str(data)
    _s3.put_object(Bucket="{bucket}", Key=key, Body=body.encode())
    return {{"key": key, "bucket": "{bucket}"}}
'''
    else:  # list
        content += f'''\
    prefix = input.get("prefix", key)
    response = _s3.list_objects_v2(Bucket="{bucket}", Prefix=prefix)
    return {{"objects": [o["Key"] for o in response.get("Contents", [])]}}
'''
    return CompiledFile(path=f"agent/tools/{node.id}.py", content=content)


def _gen_tool_http(node: Node) -> CompiledFile:
    fn = _fn_name(node)
    desc = node.config.get("description", "")
    base_url = node.config.get("base_url", "")
    method = node.config.get("method", "GET").lower()
    headers: dict = node.config.get("headers", {})
    timeout = node.config.get("timeout_seconds", 30)
    auth: dict = node.config.get("auth", {})
    auth_type = auth.get("type", "none")
    secret_ref = auth.get("secret_ref", "")

    static_headers = repr(headers)

    auth_block = ""
    if auth_type == "api_key":
        auth_block = f'''\
    import json as _json
    _secret = _json.loads(get_secret("{secret_ref}"))
    headers["Authorization"] = f"ApiKey {{_secret['api_key']}}"
'''
    elif auth_type == "bearer":
        auth_block = f'''\
    headers["Authorization"] = f"Bearer {{get_secret('{secret_ref}')}}"
'''
    elif auth_type == "oauth2_client_credentials":
        # Token vending via AgentCore Identity — provider was created in
        # infra/agentcore_identity.tf. The SDK handles caching, refresh,
        # and short-lived credential rotation; no manual token cache here.
        provider_name = node.config.get("name", node.id).lower().replace(" ", "-")
        scope = auth.get("oauth2", {}).get("scope", "")
        scopes_arg = f', scopes="{scope}"' if scope else ""
        auth_block = f'''\
    headers["Authorization"] = f"Bearer {{_get_oauth2_token()}}"
'''
        oauth2_preamble = f'''\
import os
from bedrock_agentcore.identity import IdentityClient

_identity = IdentityClient(region_name=os.environ.get("AWS_REGION", "us-east-1"))


def _get_oauth2_token() -> str:
    """Fetch an OAuth2 access token via AgentCore Identity (M2M / client credentials).

    AgentCore Identity caches and rotates the token. The credential provider
    (token endpoint, client id/secret) is configured in Terraform; this code
    only references it by name.
    """
    return _identity.get_token(
        provider_name=f"${{os.environ.get('AGENT_NAME', 'agent')}}-{provider_name}-oauth2",
        grant_type="client_credentials"{scopes_arg},
    )

'''
    else:
        oauth2_preamble = ""

    if not oauth2_preamble:
        if auth_type in ("api_key", "bearer"):
            oauth2_preamble = "from ..config import get_secret\n\n"
        else:
            oauth2_preamble = ""

    use_json = method in ("post", "put", "patch")
    request_kwarg = "json=request" if use_json else "params=request"

    content = f'''\
import httpx
from langchain_core.tools import tool
{oauth2_preamble}

@tool
def {fn}(request: dict) -> dict:
    """{desc}"""
    headers = {static_headers}
{auth_block}
    with httpx.Client(timeout={timeout}) as client:
        response = client.{method}("{base_url}", {request_kwarg}, headers=headers)
    return {{"body": response.json(), "status_code": response.status_code}}
'''
    return CompiledFile(path=f"agent/tools/{node.id}.py", content=content)


def _gen_tool_bedrock(node: Node) -> CompiledFile:
    fn = _fn_name(node)
    desc = node.config.get("description", "")
    operation = node.config.get("operation", "invoke_model")
    model_id = node.config.get("model_id", "")
    profile_arn = node.config.get("inference_profile_arn", "")
    agent_id = node.config.get("agent_id", "")
    agent_alias = node.config.get("agent_alias_id", "")
    body_template = node.config.get("body_template", "")
    timeout = node.config.get("timeout_seconds", 30)

    # inference_profile_arn takes precedence over model_id
    effective_model = profile_arn if profile_arn else model_id

    if operation == "invoke_agent":
        content = f'''\
import json
import uuid

import boto3
from langchain_core.tools import tool

_bedrock = boto3.client("bedrock-agent-runtime")


@tool
def {fn}(input: dict) -> dict:
    """{desc}"""
    session_id = input.get("session_id", str(uuid.uuid4()))
    response = _bedrock.invoke_agent(
        agentId="{agent_id}",
        agentAliasId="{agent_alias}",
        sessionId=session_id,
        inputText=input.get("message", json.dumps(input)),
    )
    completion = ""
    for event in response["completion"]:
        if "chunk" in event:
            completion += event["chunk"]["bytes"].decode()
    return {{"response": completion, "session_id": session_id}}
'''
    else:
        template_code = (
            f'body = json.dumps({body_template}).encode()' if body_template
            else 'body = json.dumps({"prompt": str(input)}).encode()'
        )
        content = f'''\
import json

import boto3
from langchain_core.tools import tool

_bedrock = boto3.client("bedrock-runtime")


@tool
def {fn}(input: dict) -> dict:
    """{desc}"""
    {template_code}
    response = _bedrock.invoke_model(
        modelId="{effective_model}",
        body=body,
        contentType="application/json",
        accept="application/json",
    )
    return json.loads(response["body"].read())
'''
    return CompiledFile(path=f"agent/tools/{node.id}.py", content=content)


def generate_tools_init(
    project_nodes: list[Node],
    agent_tool_map: dict[str, list[str]],
) -> CompiledFile:
    """Generates agent/tools/__init__.py with get_tools_for_agent()."""
    tool_nodes = [n for n in project_nodes if n.is_tool()]

    imports = []
    for n in tool_nodes:
        fn = _fn_name(n)
        imports.append(f"from .{n.id} import {fn}")

    fn_name_by_id = {n.id: _fn_name(n) for n in tool_nodes}

    mapping_lines = []
    for agent_id, tool_ids in agent_tool_map.items():
        fns = [fn_name_by_id[tid] for tid in tool_ids if tid in fn_name_by_id]
        mapping_lines.append(f'    "{agent_id}": [{", ".join(fns)}],')

    content = "\n".join(imports)
    content += "\n\n_AGENT_TOOLS: dict = {\n"
    content += "\n".join(mapping_lines) + "\n}\n\n"
    content += "def get_tools_for_agent(agent_node_id: str) -> list:\n"
    content += "    return _AGENT_TOOLS.get(agent_node_id, [])\n"

    return CompiledFile(path="agent/tools/__init__.py", content=content)


def _schema_to_params(schema: dict) -> str:
    """Convert JSON Schema object properties to Python function parameters."""
    props: dict = schema.get("properties", {})
    required: list = schema.get("required", [])
    parts = []
    for name, prop in props.items():
        py_type = _json_type_to_python(prop.get("type", "any"))
        if name in required:
            parts.append(f"{name}: {py_type}")
        else:
            parts.append(f"{name}: {py_type} = None")
    return ", ".join(parts) if parts else "**kwargs"


def _params_to_dict(schema: dict) -> str:
    props = list(schema.get("properties", {}).keys())
    return ", ".join(f'"{p}": {p}' for p in props)


def _json_type_to_python(json_type: str) -> str:
    return {
        "string": "str",
        "integer": "int",
        "number": "float",
        "boolean": "bool",
        "object": "dict",
        "array": "list",
    }.get(json_type, "Any")
