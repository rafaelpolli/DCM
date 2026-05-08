"""FastAPI application — Code Generation Engine."""
from __future__ import annotations

import io
import json
import os
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .integrations.git import GitHubClient, GitLabClient, GitProviderError
from .models.graph import Project
from .pipeline import bundler, observability
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
    """Comma-separated list of allowed origins. Defaults to local Vite ports.

    Set CORS_ORIGINS at deploy time, e.g.:
        CORS_ORIGINS=https://agents-studio.pages.dev,https://studio.example.com
    Use '*' to allow any origin (do not combine with credentials).
    """
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


@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.post("/validate")
def validate_graph(project: Project) -> dict:
    """Validate a graph DAG without generating code.

    Returns validation errors as structured JSON suitable for Studio inline markers.
    """
    result = validate(project)
    return {
        "valid": result.valid,
        "errors": [e.to_dict() for e in result.errors],
    }


@app.post("/generate")
def generate(project: Project) -> StreamingResponse:
    """Validate the graph and generate a deployable ZIP bundle.

    Returns a ZIP file download containing Python agent code, Terraform IaC,
    pytest tests, local simulation scripts, and project.json for re-import.
    """
    # Phase 1 — Validate
    validation = validate(project)
    if not validation.valid:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Graph validation failed",
                "errors": [e.to_dict() for e in validation.errors],
            },
        )

    # Phase 2 — Compile graph → Python agent package
    artifacts = compile_graph(project, validation.sorted_nodes)

    # Phase 3 — IaC
    artifacts.merge(generate_iac(project, validation.sorted_nodes))

    # Phase 4 — Tests
    artifacts.merge(generate_tests(project))

    # Phase 5 — Local scaffold (Dockerfile, pyproject.toml, local/ scripts, .env.example)
    artifacts.merge(generate_local_scaffold(project))

    # Phase 6 — Observability injection
    observability.inject_observability(project, artifacts)

    # Phase 7 — ZIP bundle
    zip_bytes = bundler.bundle(project, artifacts)

    agent_name = project.name.lower().replace(" ", "-")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    filename = f"agent-{agent_name}-{timestamp}.zip"

    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─────────────────────────────────────────────────────────────────────────
# Git integration — push generated repos and pull project.json from
# GitHub/GitLab. Tokens (PATs) are passed per-request and never persisted.
# ─────────────────────────────────────────────────────────────────────────

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
    """Validate the project, run the full code-gen pipeline, and commit
    every generated file to the target repo branch in one atomic commit.
    """
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
    """Read project.json (or another file) from the repo at the given ref.

    Returns the parsed Project so the Studio can hydrate the canvas.
    """
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
    handler = None  # running locally via uvicorn
