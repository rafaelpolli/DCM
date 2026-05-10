"""JaguarData Platform — FastAPI application.

Serves:
  - /api/auth/*    — JWT authentication
  - /api/dcm/*     — Data Contract Manager REST API
  - /api/agents/*  — Generative Agents Platform Engine (code generation)
  - /health         — Health probe
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import router as auth_router
from app.dcm.mock_data import SEED_CONTRACTS, SEED_REQUESTS
from app.dcm.router import init_state, router as dcm_router
from app.dcm.storage import init_database
from app.engine.main import app as engine_app
from app.engine.mocks import is_mock_mode


def _cors_origins() -> list[str]:
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if not raw:
        return ["http://localhost:5173", "http://localhost:4173"]
    if raw == "*":
        return ["*"]
    return [o.strip() for o in raw.split(",") if o.strip()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize DCM state from SQLite (or seed data) on startup."""
    contracts, requests = init_database(SEED_CONTRACTS, SEED_REQUESTS)
    init_state(contracts, requests)
    yield


app = FastAPI(
    title="JaguarData Platform",
    version="0.1.0",
    description="Data Contract Manager + Generative Agents Platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Mount routers
app.include_router(auth_router, prefix="/api/auth", tags=["Auth"])
app.include_router(dcm_router, prefix="/api/dcm", tags=["DCM"])
app.mount("/api/agents", engine_app)


@app.get("/health")
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "mock_mode": is_mock_mode(),
    }
