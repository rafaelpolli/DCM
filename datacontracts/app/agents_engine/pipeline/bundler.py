"""Phase 7: ZIP Bundler — packages all artifacts + project.json into a deployable ZIP."""
from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone

from .._types import CompiledArtifacts
from ..models.graph import Project


def bundle(project: Project, artifacts: CompiledArtifacts) -> bytes:
    """
    Returns the ZIP file contents as bytes.

    ZIP layout:
      agent/            ← LangGraph Python package
      infra/            ← Terraform modules
      tests/            ← Generated pytest files
      local/            ← Local simulation scripts
      Dockerfile
      pyproject.toml
      .env.example
      project.json      ← Re-import schema
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path, content in artifacts.files.items():
            zf.writestr(path, content)
        zf.writestr("project.json", _project_json(project))

    return buf.getvalue()


def _project_json(project: Project) -> str:
    data = project.model_dump(mode="json")
    data["exported_at"] = datetime.now(timezone.utc).isoformat()
    return json.dumps(data, indent=2, default=str)
