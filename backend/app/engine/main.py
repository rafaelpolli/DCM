"""FastAPI application — Code Generation Engine."""
from __future__ import annotations

import io
import json
import os
import time
from datetime import datetime, timezone
from typing import Literal

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import mocks
from .eval import EvalRequest, EvalResult, run_eval
from .integrations.git import GitHubClient, GitLabClient, GitProviderError
from .models.graph import Project
from .pipeline import bundler, observability
from .pipeline.cicd_generator import generate_cicd
from .pipeline.compiler.compiler import compile_graph
from .pipeline.iac_generator import generate_iac
from .pipeline.local_scaffold import generate_local_scaffold
from .pipeline.test_generator import generate_tests
from .pipeline.validator import ValidationError, validate

app = FastAPI(
    title="Generative Agents Platform — Engine",
    version="0.1.0",
    description="Code generation engine that converts visual agent graphs into deployable ZIPs.",
)


def _cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if not raw:
        return ["http://localhost:5173", "http://localhost:4173"]
    return [o.strip() for o in raw.split(",") if o.strip()]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def _boto_client(service: str, req: BaseModel):
    """Build a boto3 client. Uses explicit creds from request if provided, else IAM role / env chain."""
    region = getattr(req, "aws_region", "us-east-1")
    kwargs: dict = {"region_name": region}
    access_key = getattr(req, "aws_access_key_id", None)
    if access_key:
        kwargs["aws_access_key_id"] = access_key
        kwargs["aws_secret_access_key"] = getattr(req, "aws_secret_access_key", None)
        token = getattr(req, "aws_session_token", None)
        if token:
            kwargs["aws_session_token"] = token
    return boto3.client(service, **kwargs)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "mock_mode": mocks.is_mock_mode(),
    }


@app.post("/validate")
def validate_graph(project: Project) -> dict:
    result = validate(project)
    return {
        "valid": result.valid,
        "errors": [e.to_dict() for e in result.errors],
    }


@app.post("/generate")
def generate(project: Project) -> StreamingResponse:
    validation = validate(project)
    if not validation.valid:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Graph validation failed",
                "errors": [e.to_dict() for e in validation.errors],
            },
        )

    artifacts = compile_graph(project, validation.sorted_nodes)
    artifacts.merge(generate_iac(project, validation.sorted_nodes))
    artifacts.merge(generate_tests(project))
    artifacts.merge(generate_local_scaffold(project))
    observability.inject_observability(project, artifacts)
    artifacts.merge(generate_cicd(project))  # Phase 8

    zip_bytes = bundler.bundle(project, artifacts)

    agent_name = project.name.lower().replace(" ", "-")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    filename = f"agent-{agent_name}-{timestamp}.zip"

    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─────────────────────────────────────────────────────────────────────────────
# Evaluation — text-overlap metrics (exact_match, token_f1, context_relevance,
# answer_faithfulness). No external ML deps required.
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/eval/run")
def eval_run(req: EvalRequest) -> EvalResult:
    """Evaluate a batch of question/answer/context rows against ground truth.

    Returns per-row metrics (exact_match, token_f1, context_relevance,
    answer_faithfulness) and aggregate averages.
    """
    if not req.rows:
        raise HTTPException(status_code=422, detail={"message": "rows must not be empty"})
    return run_eval(req)


# ─────────────────────────────────────────────────────────────────────────────
# Preview — run a single agent node against Bedrock without generating a ZIP.
# Requires AWS credentials configured on the engine host (env or IAM role).
# ─────────────────────────────────────────────────────────────────────────────

class PreviewRequest(BaseModel):
    model_id: str = Field("anthropic.claude-3-5-haiku-20241022-v1:0")
    system_prompt: str = Field("You are a helpful AI assistant.")
    temperature: float = Field(0.7, ge=0.0, le=1.0)
    max_tokens: int = Field(1024, ge=1, le=8192)
    input_text: str = Field(..., min_length=1)
    aws_region: str = Field("us-east-1")


class PreviewResult(BaseModel):
    response: str
    input_tokens: int
    output_tokens: int
    latency_ms: int


@app.post("/preview")
def preview_node(req: PreviewRequest) -> PreviewResult:
    """Invoke a Bedrock model with a system prompt and user input.

    Used by the Studio prompt-tester panel. Requires the engine to have
    AWS credentials with bedrock:InvokeModel permission.
    """
    if mocks.is_mock_mode():
        return PreviewResult(**mocks.preview_node(req.model_id, req.input_text))
    try:
        client = boto3.client("bedrock-runtime", region_name=req.aws_region)
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "system": req.system_prompt,
            "messages": [{"role": "user", "content": req.input_text}],
            "max_tokens": req.max_tokens,
            "temperature": req.temperature,
        }
        t0 = time.perf_counter()
        resp = client.invoke_model(
            modelId=req.model_id,
            body=json.dumps(body),
            contentType="application/json",
            accept="application/json",
        )
        latency_ms = int((time.perf_counter() - t0) * 1000)
        payload = json.loads(resp["body"].read())
        text = payload.get("content", [{}])[0].get("text", "")
        usage = payload.get("usage", {})
        return PreviewResult(
            response=text,
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            latency_ms=latency_ms,
        )
    except (BotoCoreError, ClientError) as e:
        raise HTTPException(status_code=502, detail={"message": str(e)}) from e


# ─────────────────────────────────────────────────────────────────────────────
# Test plan — compile graph and return generated test file contents without
# executing them. Execution happens locally via `uv run pytest tests/`.
# ─────────────────────────────────────────────────────────────────────────────

class TestPlanResult(BaseModel):
    files: dict[str, str]
    tool_count: int


@app.post("/test-plan")
def test_plan(project: Project) -> TestPlanResult:
    """Generate and return the pytest files for the project without executing them.

    The Studio shows these as a "test plan" preview. Actual execution:
        uv run pytest tests/ -v
    inside the extracted agent ZIP.
    """
    validation = validate(project)
    if not validation.valid:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Graph validation failed",
                "errors": [e.to_dict() for e in validation.errors],
            },
        )
    test_artifacts = generate_tests(project)
    tool_nodes = [n for n in project.nodes if n.is_tool()]
    return TestPlanResult(
        files=dict(test_artifacts.files),
        tool_count=len(tool_nodes),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Traces — query CloudWatch Logs Insights for AgentCore observability spans.
# Credentials are passed per-request and never persisted.
# ─────────────────────────────────────────────────────────────────────────────

class TracesRequest(BaseModel):
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_session_token: str | None = None
    aws_region: str = "us-east-1"
    agent_name: str
    minutes: int = Field(60, ge=1, le=1440)


class TraceSpan(BaseModel):
    timestamp: str
    span_type: str
    message: str
    duration_ms: int | None = None


class TracesResult(BaseModel):
    spans: list[TraceSpan]
    log_group: str
    query_window_minutes: int


@app.post("/traces/query")
def query_traces(req: TracesRequest) -> TracesResult:
    """Query CloudWatch Logs Insights for AgentCore genai observability spans."""
    if mocks.is_mock_mode():
        return TracesResult(**mocks.query_traces(req.agent_name, req.minutes))
    log_group = f"/aws/bedrock/agentcore/{req.agent_name}"
    try:
        logs = _boto_client("logs", req)
        end_time = int(time.time())
        start_time = end_time - req.minutes * 60

        resp = logs.start_query(
            logGroupName=log_group,
            startTime=start_time,
            endTime=end_time,
            queryString=(
                "fields @timestamp, @message, span_type, duration_ms "
                "| filter ispresent(span_type) "
                "| sort @timestamp desc "
                "| limit 200"
            ),
        )
        query_id = resp["queryId"]

        # Poll until complete (max 10s)
        for _ in range(20):
            time.sleep(0.5)
            status_resp = logs.get_query_results(queryId=query_id)
            if status_resp["status"] in ("Complete", "Failed", "Cancelled"):
                break

        spans: list[TraceSpan] = []
        for row in status_resp.get("results", []):
            fields = {f["field"]: f["value"] for f in row}
            spans.append(TraceSpan(
                timestamp=fields.get("@timestamp", ""),
                span_type=fields.get("span_type", "unknown"),
                message=fields.get("@message", ""),
                duration_ms=int(fields["duration_ms"]) if fields.get("duration_ms") else None,
            ))

        return TracesResult(
            spans=spans,
            log_group=log_group,
            query_window_minutes=req.minutes,
        )
    except (BotoCoreError, ClientError) as e:
        raise HTTPException(status_code=502, detail={"message": str(e)}) from e


# ─────────────────────────────────────────────────────────────────────────────
# Agents — list, status, invoke (Bedrock AgentCore Runtime).
# Credentials optional: when omitted, boto3 uses IAM role / env / instance profile.
# ─────────────────────────────────────────────────────────────────────────────

class _AwsCredsRequest(BaseModel):
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_session_token: str | None = None
    aws_region: str = "us-east-1"


class ListAgentsRequest(_AwsCredsRequest):
    pass


class AgentRuntimeSummary(BaseModel):
    agent_runtime_id: str
    agent_runtime_arn: str
    name: str
    status: str
    endpoint: str | None = None
    created_at: str | None = None
    last_updated_at: str | None = None


class ListAgentsResult(BaseModel):
    agents: list[AgentRuntimeSummary]
    using_iam_role: bool


@app.post("/runtimes/list")
def list_agents(req: ListAgentsRequest) -> ListAgentsResult:
    """List AgentCore Runtimes deployed in the AWS account."""
    if mocks.is_mock_mode():
        return ListAgentsResult(
            agents=[AgentRuntimeSummary(**a) for a in mocks.list_agents()],
            using_iam_role=True,
        )
    try:
        agentcore = _boto_client("bedrock-agentcore-control", req)
        resp = agentcore.list_agent_runtimes()
        items: list[AgentRuntimeSummary] = []
        for r in resp.get("agentRuntimes", []):
            items.append(AgentRuntimeSummary(
                agent_runtime_id=r.get("agentRuntimeId", ""),
                agent_runtime_arn=r.get("agentRuntimeArn", ""),
                name=r.get("agentRuntimeName", r.get("agentRuntimeId", "")),
                status=r.get("status", "UNKNOWN"),
                endpoint=r.get("agentRuntimeEndpoint"),
                created_at=str(r.get("createdAt", "")) or None,
                last_updated_at=str(r.get("lastUpdatedAt", "")) or None,
            ))
        return ListAgentsResult(
            agents=items,
            using_iam_role=req.aws_access_key_id is None,
        )
    except (BotoCoreError, ClientError) as e:
        raise HTTPException(status_code=502, detail={"message": str(e)}) from e


class AgentStatusRequest(_AwsCredsRequest):
    agent_runtime_id: str


class AgentStatusResult(BaseModel):
    agent_runtime_id: str
    status: str
    endpoint: str | None = None
    created_at: str | None = None
    last_updated_at: str | None = None
    raw: dict


@app.post("/runtimes/status")
def agent_status(req: AgentStatusRequest) -> AgentStatusResult:
    """Get AgentCore Runtime status for a specific deployed agent."""
    if mocks.is_mock_mode():
        data = mocks.get_agent_status(req.agent_runtime_id)
        if not data:
            raise HTTPException(status_code=404, detail={"message": "Mock agent not found"})
        return AgentStatusResult(**data)
    try:
        agentcore = _boto_client("bedrock-agentcore-control", req)
        resp = agentcore.get_agent_runtime(agentRuntimeId=req.agent_runtime_id)
        return AgentStatusResult(
            agent_runtime_id=req.agent_runtime_id,
            status=resp.get("status", "UNKNOWN"),
            endpoint=resp.get("agentRuntimeEndpoint"),
            created_at=str(resp.get("createdAt", "")),
            last_updated_at=str(resp.get("lastUpdatedAt", "")),
            raw={k: str(v) for k, v in resp.items() if k != "ResponseMetadata"},
        )
    except (BotoCoreError, ClientError) as e:
        raise HTTPException(status_code=502, detail={"message": str(e)}) from e


class InvokeAgentRequest(_AwsCredsRequest):
    agent_runtime_arn: str
    input_text: str = Field(..., min_length=1)
    session_id: str | None = None
    qualifier: str = "DEFAULT"


class InvokeAgentResult(BaseModel):
    response_text: str
    latency_ms: int
    session_id: str
    raw: dict


def _invoke_agent(req: InvokeAgentRequest) -> InvokeAgentResult:
    """Internal helper — invoke an AgentCore runtime, return response text + latency."""
    import uuid
    session_id = req.session_id or str(uuid.uuid4())
    if mocks.is_mock_mode():
        return InvokeAgentResult(**mocks.invoke_agent(req.agent_runtime_arn, req.input_text, session_id))
    runtime = _boto_client("bedrock-agentcore", req)
    payload = json.dumps({"prompt": req.input_text, "input": req.input_text}).encode("utf-8")
    t0 = time.perf_counter()
    resp = runtime.invoke_agent_runtime(
        agentRuntimeArn=req.agent_runtime_arn,
        runtimeSessionId=session_id,
        qualifier=req.qualifier,
        payload=payload,
    )
    latency_ms = int((time.perf_counter() - t0) * 1000)

    body = resp.get("response")
    if hasattr(body, "read"):
        raw_bytes = body.read()
    elif isinstance(body, (bytes, bytearray)):
        raw_bytes = bytes(body)
    else:
        raw_bytes = json.dumps(body).encode("utf-8") if body is not None else b""

    raw_str = raw_bytes.decode("utf-8", errors="replace")
    text = raw_str
    try:
        parsed = json.loads(raw_str)
        if isinstance(parsed, dict):
            text = (
                parsed.get("response")
                or parsed.get("output")
                or parsed.get("text")
                or parsed.get("message")
                or raw_str
            )
            if isinstance(text, dict):
                text = json.dumps(text)
        elif isinstance(parsed, str):
            text = parsed
    except (ValueError, TypeError):
        pass

    return InvokeAgentResult(
        response_text=str(text),
        latency_ms=latency_ms,
        session_id=session_id,
        raw={"content_type": resp.get("contentType", ""), "status_code": str(resp.get("statusCode", ""))},
    )


@app.post("/runtimes/invoke")
def invoke_agent(req: InvokeAgentRequest) -> InvokeAgentResult:
    """Invoke a deployed AgentCore Runtime synchronously."""
    try:
        return _invoke_agent(req)
    except (BotoCoreError, ClientError) as e:
        raise HTTPException(status_code=502, detail={"message": str(e)}) from e


class UsageStatsRequest(_AwsCredsRequest):
    minutes: int = Field(1440, ge=1, le=10080)


class UsageStats(BaseModel):
    total_agents: int
    by_status: dict[str, int]
    total_invocations_window: int
    avg_latency_ms: float | None = None
    window_minutes: int


@app.post("/runtimes/usage")
def runtimes_usage(req: UsageStatsRequest) -> UsageStats:
    """Aggregate stats across all deployed agents: status breakdown + invocations + avg latency.

    In real mode: lists agents, then queries CloudWatch traces per-agent (filtered to
    `span_type == "agent.invoke"`) and aggregates. In mock mode: returns fixture.
    """
    if mocks.is_mock_mode():
        return UsageStats(**mocks.usage_stats(req.minutes))
    try:
        agentcore = _boto_client("bedrock-agentcore-control", req)
        list_resp = agentcore.list_agent_runtimes()
        agents = list_resp.get("agentRuntimes", [])

        by_status: dict[str, int] = {}
        for a in agents:
            s = a.get("status", "UNKNOWN")
            by_status[s] = by_status.get(s, 0) + 1

        logs = _boto_client("logs", req)
        end_time = int(time.time())
        start_time = end_time - req.minutes * 60
        total_invocations = 0
        latencies: list[int] = []

        for a in agents:
            name = a.get("agentRuntimeName") or a.get("agentRuntimeId", "")
            if not name:
                continue
            log_group = f"/aws/bedrock/agentcore/{name}"
            try:
                start = logs.start_query(
                    logGroupName=log_group,
                    startTime=start_time,
                    endTime=end_time,
                    queryString=(
                        "fields duration_ms, span_type "
                        "| filter span_type = 'agent.invoke' "
                        "| limit 500"
                    ),
                )
                qid = start["queryId"]
                for _ in range(20):
                    time.sleep(0.5)
                    qresp = logs.get_query_results(queryId=qid)
                    if qresp["status"] in ("Complete", "Failed", "Cancelled"):
                        break
                for row in qresp.get("results", []):
                    fields = {f["field"]: f["value"] for f in row}
                    total_invocations += 1
                    dur = fields.get("duration_ms")
                    if dur:
                        try:
                            latencies.append(int(dur))
                        except (ValueError, TypeError):
                            pass
            except (BotoCoreError, ClientError):
                continue

        avg_latency = round(sum(latencies) / len(latencies), 1) if latencies else None
        return UsageStats(
            total_agents=len(agents),
            by_status=by_status,
            total_invocations_window=total_invocations,
            avg_latency_ms=avg_latency,
            window_minutes=req.minutes,
        )
    except (BotoCoreError, ClientError) as e:
        raise HTTPException(status_code=502, detail={"message": str(e)}) from e


# ─────────────────────────────────────────────────────────────────────────────
# Git integration
# ─────────────────────────────────────────────────────────────────────────────

GitProvider = Literal["github", "gitlab"]


class GitPushRequest(BaseModel):
    provider: GitProvider
    repo: str = Field(..., description="GitHub: 'owner/name'. GitLab: 'group/project' or nested path.")
    branch: str = Field("main", description="Target branch. Auto-created if missing.")
    token: str = Field(..., description="Personal Access Token. Never logged. Forwarded to provider.")
    commit_message: str = Field("Update generated agent from Studio", min_length=1, max_length=500)
    project: Project
    base_url: str | None = Field(None, description="Self-hosted GitLab base URL. Ignored for GitHub.")


class GitPullRequest(BaseModel):
    provider: GitProvider
    repo: str
    ref: str = Field("main", description="Branch, tag, or commit SHA to read from.")
    token: str = Field(..., description="Personal Access Token. Required for private repos.")
    path: str = Field("project.json", description="Path within the repo to read.")
    base_url: str | None = None


def _make_provider(req: GitPushRequest | GitPullRequest):
    if req.provider == "github":
        return GitHubClient.from_repo(req.repo, req.token)
    return GitLabClient.from_repo(req.repo, req.token, req.base_url)


@app.post("/git/push")
def git_push(req: GitPushRequest) -> dict:
    validation = validate(req.project)
    if not validation.valid:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Graph validation failed",
                "errors": [e.to_dict() for e in validation.errors],
            },
        )

    artifacts = compile_graph(req.project, validation.sorted_nodes)
    artifacts.merge(generate_iac(req.project, validation.sorted_nodes))
    artifacts.merge(generate_tests(req.project))
    artifacts.merge(generate_local_scaffold(req.project))
    observability.inject_observability(req.project, artifacts)
    artifacts.merge(generate_cicd(req.project))

    files = dict(artifacts.files)
    files["project.json"] = bundler._project_json(req.project)

    try:
        result = _make_provider(req).push_files(
            files=files,
            branch=req.branch,
            commit_message=req.commit_message,
        )
    except GitProviderError as e:
        raise HTTPException(status_code=502, detail={"message": str(e)}) from e

    return {
        "ok": True,
        "provider": req.provider,
        "repo": req.repo,
        "branch": req.branch,
        "files_committed": len(files),
        **result,
    }


@app.post("/git/pull")
def git_pull(req: GitPullRequest) -> dict:
    try:
        raw = _make_provider(req).get_file(req.path, req.ref)
    except GitProviderError as e:
        raise HTTPException(status_code=502, detail={"message": str(e)}) from e

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=422,
            detail={"message": f"file '{req.path}' is not valid JSON: {e}"},
        ) from e

    return {
        "ok": True,
        "provider": req.provider,
        "repo": req.repo,
        "ref": req.ref,
        "path": req.path,
        "project": parsed,
    }


# Lambda adapter for AWS deployment
try:
    from mangum import Mangum
    handler = Mangum(app, lifespan="off")
except ImportError:
    handler = None
