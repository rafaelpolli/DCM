"""GitHub + GitLab REST clients for push/pull of generated agent repos.

Auth tokens (PATs) are passed per-request and never stored. Providers are
instantiated fresh per request. All HTTP calls use stdlib urllib to avoid
introducing new dependencies.
"""
from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass
from typing import Any
from urllib import error, parse, request

_log = logging.getLogger(__name__)

# Files that should never be pushed even if present in the artifact dict.
_SKIP_PATHS: frozenset[str] = frozenset({})


class GitProviderError(Exception):
    """Raised on any provider HTTP failure. Message is safe to surface."""


# ─────────────────────────────────────────────────────────────────────────
# HTTP helper
# ─────────────────────────────────────────────────────────────────────────

def _http(
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    body: dict | None = None,
) -> Any:
    payload = json.dumps(body).encode() if body is not None else None
    req = request.Request(url, data=payload, method=method, headers=headers)
    try:
        with request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            if not raw:
                return None
            return json.loads(raw)
    except error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", errors="replace")[:400]
        except Exception:
            pass
        raise GitProviderError(
            f"{method} {parse.urlsplit(url).path} → HTTP {e.code}: {detail}"
        ) from e
    except error.URLError as e:
        raise GitProviderError(f"network error: {e.reason}") from e


# ─────────────────────────────────────────────────────────────────────────
# GitHub
# ─────────────────────────────────────────────────────────────────────────

@dataclass
class GitHubClient:
    token: str
    owner: str
    repo: str

    @classmethod
    def from_repo(cls, full_name: str, token: str) -> "GitHubClient":
        if "/" not in full_name:
            raise GitProviderError("GitHub repo must be 'owner/name'")
        owner, repo = full_name.split("/", 1)
        return cls(token=token, owner=owner, repo=repo)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "agents-platform-engine",
            "Content-Type": "application/json",
        }

    def _api(self, path: str) -> str:
        return f"https://api.github.com/repos/{self.owner}/{self.repo}{path}"

    # --- pull -----------------------------------------------------------

    def get_file(self, path: str, ref: str) -> str:
        """Returns file content as UTF-8 text. Raises if file does not exist."""
        url = self._api(f"/contents/{parse.quote(path)}?ref={parse.quote(ref)}")
        data = _http("GET", url, headers=self._headers())
        if not isinstance(data, dict) or "content" not in data:
            raise GitProviderError(f"file '{path}' not found at ref '{ref}'")
        encoding = data.get("encoding", "base64")
        if encoding != "base64":
            raise GitProviderError(f"unsupported file encoding: {encoding}")
        return base64.b64decode(data["content"]).decode("utf-8")

    # --- push -----------------------------------------------------------

    def push_files(
        self,
        files: dict[str, str],
        branch: str,
        commit_message: str,
    ) -> dict[str, str]:
        """Atomically commits all files to branch via the Trees API.

        Returns {"commit_url": ..., "commit_sha": ...}.
        Creates the branch if it doesn't exist (off the default branch).
        """
        # Resolve the target ref. If missing, fall back to default branch.
        try:
            ref = _http("GET", self._api(f"/git/ref/heads/{branch}"), headers=self._headers())
            base_sha = ref["object"]["sha"]
            branch_exists = True
        except GitProviderError:
            branch_exists = False
            repo = _http("GET", self._api(""), headers=self._headers())
            default_branch = repo.get("default_branch", "main")
            ref = _http(
                "GET",
                self._api(f"/git/ref/heads/{default_branch}"),
                headers=self._headers(),
            )
            base_sha = ref["object"]["sha"]

        base_commit = _http("GET", self._api(f"/git/commits/{base_sha}"), headers=self._headers())
        base_tree_sha = base_commit["tree"]["sha"]

        # Upload each file as a blob.
        tree_entries = []
        for path, content in files.items():
            if path in _SKIP_PATHS:
                continue
            blob = _http(
                "POST",
                self._api("/git/blobs"),
                headers=self._headers(),
                body={"content": content, "encoding": "utf-8"},
            )
            tree_entries.append({
                "path": path,
                "mode": "100644",
                "type": "blob",
                "sha": blob["sha"],
            })

        new_tree = _http(
            "POST",
            self._api("/git/trees"),
            headers=self._headers(),
            body={"base_tree": base_tree_sha, "tree": tree_entries},
        )
        new_commit = _http(
            "POST",
            self._api("/git/commits"),
            headers=self._headers(),
            body={
                "message": commit_message,
                "tree": new_tree["sha"],
                "parents": [base_sha],
            },
        )
        if branch_exists:
            _http(
                "PATCH",
                self._api(f"/git/refs/heads/{branch}"),
                headers=self._headers(),
                body={"sha": new_commit["sha"], "force": False},
            )
        else:
            _http(
                "POST",
                self._api("/git/refs"),
                headers=self._headers(),
                body={"ref": f"refs/heads/{branch}", "sha": new_commit["sha"]},
            )

        return {
            "commit_sha": new_commit["sha"],
            "commit_url": new_commit.get("html_url")
                or f"https://github.com/{self.owner}/{self.repo}/commit/{new_commit['sha']}",
        }


# ─────────────────────────────────────────────────────────────────────────
# GitLab
# ─────────────────────────────────────────────────────────────────────────

@dataclass
class GitLabClient:
    token: str
    project_path: str
    base_url: str = "https://gitlab.com"

    @classmethod
    def from_repo(cls, full_name: str, token: str, base_url: str | None = None) -> "GitLabClient":
        if "/" not in full_name:
            raise GitProviderError("GitLab repo must be 'group/project' (or nested groups)")
        return cls(token=token, project_path=full_name, base_url=base_url or "https://gitlab.com")

    def _headers(self) -> dict[str, str]:
        return {
            "PRIVATE-TOKEN": self.token,
            "Content-Type": "application/json",
            "User-Agent": "agents-platform-engine",
        }

    def _api(self, path: str) -> str:
        encoded = parse.quote(self.project_path, safe="")
        return f"{self.base_url}/api/v4/projects/{encoded}{path}"

    # --- pull -----------------------------------------------------------

    def get_file(self, path: str, ref: str) -> str:
        url = self._api(
            f"/repository/files/{parse.quote(path, safe='')}?ref={parse.quote(ref)}"
        )
        data = _http("GET", url, headers=self._headers())
        if not isinstance(data, dict) or "content" not in data:
            raise GitProviderError(f"file '{path}' not found at ref '{ref}'")
        return base64.b64decode(data["content"]).decode("utf-8")

    # --- push -----------------------------------------------------------

    def push_files(
        self,
        files: dict[str, str],
        branch: str,
        commit_message: str,
    ) -> dict[str, str]:
        """Single-call atomic commit via the Commits API.

        Files are sent as 'create' or 'update' actions. Detects existence
        per-file by issuing HEAD on the contents endpoint.
        """
        # Probe each path to choose 'create' vs 'update'.
        actions = []
        for path, content in files.items():
            if path in _SKIP_PATHS:
                continue
            exists = self._file_exists(path, branch)
            actions.append({
                "action": "update" if exists else "create",
                "file_path": path,
                "content": content,
            })

        body = {
            "branch": branch,
            "commit_message": commit_message,
            "actions": actions,
        }
        # Auto-create branch if missing (set start_branch to repo default).
        if not self._branch_exists(branch):
            default_branch = self._default_branch()
            body["start_branch"] = default_branch

        commit = _http(
            "POST",
            self._api("/repository/commits"),
            headers=self._headers(),
            body=body,
        )
        return {
            "commit_sha": commit["id"],
            "commit_url": commit.get("web_url")
                or f"{self.base_url}/{self.project_path}/-/commit/{commit['id']}",
        }

    # --- helpers --------------------------------------------------------

    def _file_exists(self, path: str, ref: str) -> bool:
        try:
            self.get_file(path, ref)
            return True
        except GitProviderError:
            return False

    def _branch_exists(self, branch: str) -> bool:
        try:
            _http(
                "GET",
                self._api(f"/repository/branches/{parse.quote(branch, safe='')}"),
                headers=self._headers(),
            )
            return True
        except GitProviderError:
            return False

    def _default_branch(self) -> str:
        try:
            project = _http("GET", self._api(""), headers=self._headers())
            return project.get("default_branch", "main")
        except GitProviderError:
            return "main"
