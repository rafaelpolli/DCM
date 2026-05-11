"""SQLite persistence for security module: probe runs, baselines, conversations.

Same connect/dump pattern as app/dcm/storage.py. Falls back gracefully if
SQLite write is unavailable (HF free tier ephemeral fs is fine for demos).
"""
from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]  # backend/
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "security.sqlite3"
DB_PATH = Path(os.getenv("SECURITY_DATABASE_PATH", str(DEFAULT_DB_PATH)))


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_database() -> None:
    with _connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS probe_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_runtime_arn TEXT NOT NULL,
                suite TEXT NOT NULL,
                created_at TEXT NOT NULL,
                pass_rate REAL,
                results_json TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS eval_baselines (
                agent_runtime_arn TEXT NOT NULL,
                suite TEXT NOT NULL,
                saved_at TEXT NOT NULL,
                pass_rate REAL,
                results_json TEXT NOT NULL,
                PRIMARY KEY (agent_runtime_arn, suite)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS conversation_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                agent_runtime_arn TEXT NOT NULL,
                session_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                input_text TEXT NOT NULL,
                response_text TEXT NOT NULL,
                latency_ms INTEGER
            )
        """)
        conn.commit()


def save_probe_run(arn: str, suite: str, created_at: str, pass_rate: float | None, results: dict) -> int:
    with _connect() as conn:
        cur = conn.execute(
            "INSERT INTO probe_runs (agent_runtime_arn, suite, created_at, pass_rate, results_json) VALUES (?, ?, ?, ?, ?)",
            (arn, suite, created_at, pass_rate, json.dumps(results, default=str)),
        )
        conn.commit()
        return cur.lastrowid or 0


def list_probe_runs(arn: str, suite: str | None = None, limit: int = 20) -> list[dict]:
    with _connect() as conn:
        if suite:
            rows = conn.execute(
                "SELECT id, agent_runtime_arn, suite, created_at, pass_rate FROM probe_runs WHERE agent_runtime_arn = ? AND suite = ? ORDER BY id DESC LIMIT ?",
                (arn, suite, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, agent_runtime_arn, suite, created_at, pass_rate FROM probe_runs WHERE agent_runtime_arn = ? ORDER BY id DESC LIMIT ?",
                (arn, limit),
            ).fetchall()
        return [dict(r) for r in rows]


def save_baseline(arn: str, suite: str, saved_at: str, pass_rate: float | None, results: dict) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO eval_baselines (agent_runtime_arn, suite, saved_at, pass_rate, results_json) VALUES (?, ?, ?, ?, ?)",
            (arn, suite, saved_at, pass_rate, json.dumps(results, default=str)),
        )
        conn.commit()


def get_baseline(arn: str, suite: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT agent_runtime_arn, suite, saved_at, pass_rate, results_json FROM eval_baselines WHERE agent_runtime_arn = ? AND suite = ?",
            (arn, suite),
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["results"] = json.loads(d.pop("results_json"))
        return d


def log_conversation(arn: str, session_id: str, created_at: str, input_text: str, response_text: str, latency_ms: int | None) -> None:
    try:
        with _connect() as conn:
            conn.execute(
                "INSERT INTO conversation_logs (agent_runtime_arn, session_id, created_at, input_text, response_text, latency_ms) VALUES (?, ?, ?, ?, ?, ?)",
                (arn, session_id, created_at, input_text, response_text, latency_ms),
            )
            conn.commit()
    except sqlite3.Error:
        # Logging is best-effort; never block the user request.
        pass


def list_conversations(arn: str, limit: int = 20) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, session_id, created_at, input_text, response_text, latency_ms FROM conversation_logs WHERE agent_runtime_arn = ? ORDER BY id DESC LIMIT ?",
            (arn, limit),
        ).fetchall()
        return [dict(r) for r in rows]


# Initialize on import
try:
    init_database()
except Exception:  # noqa: BLE001
    pass
