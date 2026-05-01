import json
import yaml
from datetime import date
from pathlib import Path
from fastapi import FastAPI, Request, Form, Query
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from typing import List

from .mock_data import (
    CONTRACTS, CHANGE_REQUESTS, USERS,
    get_stats, recent_requests,
    next_contract_id, next_request_id,
)
from .storage import init_database, load_change_requests, load_contracts, save_change_request, save_contract

BASE_DIR = Path(__file__).resolve().parent

app = FastAPI(title="DataContracts")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

init_database(CONTRACTS, CHANGE_REQUESTS)
CONTRACTS.clear()
CONTRACTS.update(load_contracts())
CHANGE_REQUESTS.clear()
CHANGE_REQUESTS.update(load_change_requests())

# ── auth ───────────────────────────────────────────────────────────────────────
LOGIN_MAP = {
    "ana.silva": "creator", "ana": "creator",
    "carlos.mendes": "admin", "carlos": "admin",
    "beatriz.lima": "viewer", "beatriz": "viewer",
}

def require_auth(request: Request):
    if not request.cookies.get("logged_in"):
        return RedirectResponse(url="/login", status_code=302)
    return None

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    if request.cookies.get("logged_in"):
        return RedirectResponse(url="/")
    return templates.TemplateResponse(request, "login.html", {})

@app.post("/login")
async def login_submit(request: Request, username: str = Form(...), password: str = Form(...)):
    role = LOGIN_MAP.get(username.lower().strip())
    if not role:
        return JSONResponse({"ok": False, "message": "Usuário não encontrado"}, status_code=401)
    resp = JSONResponse({"ok": True, "redirect": "/"})
    resp.set_cookie("role", role, max_age=86400 * 30)
    resp.set_cookie("logged_in", "1", max_age=86400 * 30)
    return resp

@app.get("/logout")
async def logout():
    resp = RedirectResponse(url="/login", status_code=302)
    resp.delete_cookie("role")
    resp.delete_cookie("logged_in")
    return resp

# ── helpers ────────────────────────────────────────────────────────────────────
def get_role(request: Request) -> str:
    return request.cookies.get("role", "viewer")

def get_user(request: Request) -> dict:
    role = get_role(request)
    return USERS.get(role, USERS["viewer"])

def tpl(request: Request, name: str, **kwargs):
    """Shorthand for TemplateResponse with common context injected."""
    role = get_role(request)
    context = {"current_user": get_user(request), "role": role, **kwargs}
    return templates.TemplateResponse(request, name, context)

# ── role switcher ──────────────────────────────────────────────────────────────
@app.get("/set-role", response_class=HTMLResponse)
async def set_role(request: Request, role: str = Query("viewer")):
    referer = request.headers.get("referer", "/")
    resp = RedirectResponse(url=referer, status_code=302)
    resp.set_cookie("role", role, max_age=86400)
    return resp

# ── dashboard ──────────────────────────────────────────────────────────────────
@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    auth = require_auth(request)
    if auth: return auth
    return tpl(request, "dashboard.html",
        stats=get_stats(), recent=recent_requests(5), page="dashboard")

# ── contracts list ─────────────────────────────────────────────────────────────
@app.get("/contracts", response_class=HTMLResponse)
async def contracts_list(request: Request, status: str = "", layer: str = "", q: str = ""):
    auth = require_auth(request)
    if auth: return auth
    items = list(CONTRACTS.values())
    if status:
        items = [c for c in items if c["status"] == status]
    if layer:
        items = [c for c in items if c["location"]["layer"] == layer]
    if q:
        items = [c for c in items if q.lower() in c["name"].lower()]

    if "HX-Request" in request.headers:
        return tpl(request, "contracts/_table.html", contracts=items, status=status, layer=layer, q=q)

    return tpl(request, "contracts/list.html", contracts=items, status=status, layer=layer, q=q, page="contracts")

# ── new contract form ──────────────────────────────────────────────────────────
@app.get("/contracts/new", response_class=HTMLResponse)
async def contract_new(request: Request, step: int = 1):
    return tpl(request, "contracts/form.html", step=step, page="contracts")

@app.post("/contracts/new", response_class=HTMLResponse)
async def contract_create(
    request: Request,
    name: str = Form(...),
    description: str = Form(""),
    domain: str = Form(""),
    team: str = Form(""),
    owner: str = Form(""),
    source_system: str = Form(""),
    data_classification: str = Form("INTERNAL"),
    tags: str = Form(""),
    layer: str = Form("BRONZE"),
    bucket: str = Form(""),
    path: str = Form(""),
    fmt: str = Form("PARQUET"),
    compression: str = Form("SNAPPY"),
    freshness: str = Form("daily"),
    max_latency_minutes: int = Form(60),
    availability_percent: float = Form(99.0),
    retention_days: int = Form(365),
    alert_email: str = Form(""),
    partition_strategy: str = Form("DATE"),
    partition_column: str = Form(""),
    partition_format: str = Form("yyyy/MM/dd"),
    pruning_enabled: str = Form("false"),
    field_names: List[str] = Form(default=[]),
    field_types: List[str] = Form(default=[]),
    field_nullables: List[str] = Form(default=[]),
    field_piis: List[str] = Form(default=[]),
    field_descs: List[str] = Form(default=[]),
):
    cid = next_contract_id()
    today = str(date.today())

    fields = []
    for i, fname in enumerate(field_names):
        if fname.strip():
            fields.append({
                "name": fname.strip(),
                "type": field_types[i] if i < len(field_types) else "STRING",
                "nullable": field_nullables[i].lower() == "true" if i < len(field_nullables) else True,
                "pk": False,
                "pii": field_piis[i] if i < len(field_piis) else "NONE",
                "description": field_descs[i] if i < len(field_descs) else "",
            })

    contract = {
        "id": cid,
        "name": name,
        "description": description,
        "status": "DRAFT",
        "version": "0.1.0",
        "environment": "DEV",
        "domain": domain,
        "team": team,
        "owner": owner,
        "source_system": source_system,
        "data_classification": data_classification,
        "tags": [t.strip() for t in tags.split(",") if t.strip()],
        "created_at": today,
        "updated_at": today,
        "location": {"layer": layer, "bucket": bucket, "path": path, "format": fmt, "compression": compression},
        "sla": {
            "freshness": freshness,
            "max_latency_minutes": max_latency_minutes,
            "availability_percent": availability_percent,
            "retention_days": retention_days,
            "alert_email": alert_email,
        },
        "partitioning": {
            "strategy": partition_strategy,
            "partition_column": partition_column,
            "partition_format": partition_format,
            "pruning_enabled": pruning_enabled.lower() == "true",
        },
        "fields": fields,
        "history": [{"version": "0.1.0", "date": today, "author": owner, "note": "Versão inicial (rascunho)"}],
    }
    CONTRACTS[cid] = contract
    save_contract(contract)

    rid = next_request_id()
    user = get_user(request)
    CHANGE_REQUESTS[rid] = {
        "id": rid,
        "title": f"Criar contrato {name}",
        "type": "CREATE",
        "contract_id": cid,
        "contract_name": name,
        "requester": user["email"],
        "requester_name": user["name"],
        "status": "OPEN",
        "created_at": today,
        "updated_at": today,
        "description": description,
        "diff": {"version_from": None, "version_to": "0.1.0", "changes": []},
        "comments": [],
    }
    save_change_request(CHANGE_REQUESTS[rid])
    return RedirectResponse(url=f"/contracts/{cid}?toast=criado", status_code=302)

# ── contract detail + tabs ─────────────────────────────────────────────────────
@app.get("/contracts/{cid}", response_class=HTMLResponse)
async def contract_detail(request: Request, cid: str, tab: str = "overview", toast: str = ""):
    contract = CONTRACTS.get(cid)
    if not contract:
        return HTMLResponse("<h1>Contrato não encontrado</h1>", status_code=404)
    related = [r for r in CHANGE_REQUESTS.values() if r["contract_id"] == cid]

    if "HX-Request" in request.headers:
        return tpl(request, f"contracts/_tab_{tab}.html", contract=contract, tab=tab, related_requests=related)

    return tpl(request, "contracts/detail.html",
        contract=contract, tab=tab, toast=toast, related_requests=related, page="contracts")

# ── export ─────────────────────────────────────────────────────────────────────
@app.get("/contracts/{cid}/export", response_class=HTMLResponse)
async def contract_export(request: Request, cid: str, format: str = "json"):
    contract = CONTRACTS.get(cid)
    if not contract:
        return HTMLResponse("Não encontrado", status_code=404)

    if format == "json":
        content = json.dumps(contract, indent=2, ensure_ascii=False)
        lang = "json"
    elif format == "yaml":
        content = yaml.dump(contract, allow_unicode=True, default_flow_style=False)
        lang = "yaml"
    elif format == "ddl":
        loc = contract["location"]
        part = contract["partitioning"]
        lines = [
            f"-- DataContract: {contract['name']} v{contract['version']}",
            f"-- Layer: {loc['layer']} | Format: {loc['format']} | Partition: {part['partition_column']} ({part['strategy']})",
            f"CREATE TABLE {loc['layer'].lower()}.{contract['name']} (",
        ]
        field_lines = []
        for f in contract["fields"]:
            null_str = "" if f["nullable"] else " NOT NULL"
            comments = []
            if f.get("pii") and f["pii"] != "NONE":
                comments.append(f"PII: {f['pii']}")
            if f.get("partition_key"):
                comments.append("PARTITION KEY")
            comment = f"  -- {', '.join(comments)}" if comments else ""
            field_lines.append(f"  {f['name']:<20} {f['type']:<10}{null_str}{comment}")
        lines.append(",\n".join(field_lines))
        lines.append(f")\nPARTITIONED BY ({part['partition_column']})\nSTORED AS {loc['format']};")
        content = "\n".join(lines)
        lang = "sql"
    else:
        content, lang = "Formato inválido", "text"

    return tpl(request, "contracts/export.html", contract=contract, content=content, lang=lang, format=format, page="contracts")

# ── requests list ──────────────────────────────────────────────────────────────
@app.get("/requests", response_class=HTMLResponse)
async def requests_list(request: Request, status: str = ""):
    auth = require_auth(request)
    if auth: return auth
    role = get_role(request)
    user = get_user(request)
    items = list(CHANGE_REQUESTS.values())
    if role == "creator":
        items = [r for r in items if r["requester"] == user["email"]]
    if status:
        items = [r for r in items if r["status"] == status]

    if "HX-Request" in request.headers:
        return tpl(request, "requests/_table.html", requests=items, status=status)

    return tpl(request, "requests/list.html", requests=items, status=status, page="requests")

# ── request detail ─────────────────────────────────────────────────────────────
@app.get("/requests/{rid}", response_class=HTMLResponse)
async def request_detail(request: Request, rid: str, toast: str = ""):
    req = CHANGE_REQUESTS.get(rid)
    if not req:
        return HTMLResponse("<h1>Solicitação não encontrada</h1>", status_code=404)
    contract = CONTRACTS.get(req["contract_id"])
    return tpl(request, "requests/detail.html", req=req, contract=contract, toast=toast, page="requests")

# ── approve / reject ───────────────────────────────────────────────────────────
@app.post("/requests/{rid}/approve", response_class=HTMLResponse)
async def request_approve(request: Request, rid: str):
    req = CHANGE_REQUESTS.get(rid)
    if req:
        req["status"] = "APPROVED"
        req["updated_at"] = str(date.today())
        contract = CONTRACTS.get(req["contract_id"])
        if contract and contract["status"] == "PENDING":
            contract["status"] = "APPROVED"
            contract["updated_at"] = str(date.today())
            save_contract(contract)
        save_change_request(req)
    return tpl(request, "requests/_status_badge.html", req=req, toast="Solicitação aprovada!")

@app.post("/requests/{rid}/reject", response_class=HTMLResponse)
async def request_reject(request: Request, rid: str, justification: str = Form("")):
    req = CHANGE_REQUESTS.get(rid)
    if req:
        req["status"] = "REJECTED"
        req["updated_at"] = str(date.today())
        if justification:
            user = get_user(request)
            req["comments"].append({"author": user["name"], "date": str(date.today()), "text": f"[Rejeição] {justification}"})
        save_change_request(req)
    return tpl(request, "requests/_status_badge.html", req=req, toast="Solicitação rejeitada.")

# ── add comment ────────────────────────────────────────────────────────────────
@app.post("/requests/{rid}/comment", response_class=HTMLResponse)
async def add_comment(request: Request, rid: str, text: str = Form(...)):
    req = CHANGE_REQUESTS.get(rid)
    user = get_user(request)
    if req and text.strip():
        req["comments"].append({"author": user["name"], "date": str(date.today()), "text": text.strip()})
        save_change_request(req)
    return tpl(request, "requests/_comments.html", req=req)
