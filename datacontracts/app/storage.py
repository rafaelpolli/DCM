import json
import os
import sqlite3
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "dcm.sqlite3"
DB_PATH = Path(os.getenv("DCM_DATABASE_PATH", DEFAULT_DB_PATH))


def get_database_path() -> Path:
    return DB_PATH


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _dump(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def _load(payload: str) -> dict[str, Any]:
    return json.loads(payload)


def init_database(seed_contracts: dict[str, dict], seed_requests: dict[str, dict]) -> None:
    with _connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS contracts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                domain TEXT,
                layer TEXT,
                updated_at TEXT,
                payload TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS change_requests (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                status TEXT NOT NULL,
                type TEXT,
                contract_id TEXT,
                requester TEXT,
                updated_at TEXT,
                payload TEXT NOT NULL
            )
            """
        )

        has_contracts = conn.execute("SELECT 1 FROM contracts LIMIT 1").fetchone()
        if not has_contracts:
            for contract in seed_contracts.values():
                _upsert_contract(conn, contract)
            for request in seed_requests.values():
                _upsert_change_request(conn, request)


def load_contracts() -> dict[str, dict]:
    with _connect() as conn:
        rows = conn.execute("SELECT payload FROM contracts ORDER BY id").fetchall()
    return {item["id"]: item for item in (_load(row["payload"]) for row in rows)}


def load_change_requests() -> dict[str, dict]:
    with _connect() as conn:
        rows = conn.execute("SELECT payload FROM change_requests ORDER BY id").fetchall()
    return {item["id"]: item for item in (_load(row["payload"]) for row in rows)}


def save_contract(contract: dict) -> None:
    with _connect() as conn:
        _upsert_contract(conn, contract)


def save_change_request(request: dict) -> None:
    with _connect() as conn:
        _upsert_change_request(conn, request)


def _upsert_contract(conn: sqlite3.Connection, contract: dict) -> None:
    conn.execute(
        """
        INSERT INTO contracts (id, name, status, domain, layer, updated_at, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            status = excluded.status,
            domain = excluded.domain,
            layer = excluded.layer,
            updated_at = excluded.updated_at,
            payload = excluded.payload
        """,
        (
            contract["id"],
            contract.get("name", ""),
            contract.get("status", ""),
            contract.get("domain", ""),
            contract.get("location", {}).get("layer", ""),
            contract.get("updated_at", ""),
            _dump(contract),
        ),
    )


def _upsert_change_request(conn: sqlite3.Connection, request: dict) -> None:
    conn.execute(
        """
        INSERT INTO change_requests (id, title, status, type, contract_id, requester, updated_at, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            status = excluded.status,
            type = excluded.type,
            contract_id = excluded.contract_id,
            requester = excluded.requester,
            updated_at = excluded.updated_at,
            payload = excluded.payload
        """,
        (
            request["id"],
            request.get("title", ""),
            request.get("status", ""),
            request.get("type", ""),
            request.get("contract_id", ""),
            request.get("requester", ""),
            request.get("updated_at", ""),
            _dump(request),
        ),
    )
