# JaguarData Platform — User Guide

## What Is This

Self-hosted, low-code platform with two products:

- **Data Contract Manager (DCM)** — catalog, manage, and govern data contracts with change-request workflows
- **Agents Studio** — drag-and-drop designer for generative AI agents that compile to a deployable ZIP (Python + Terraform + Docker) running on **Amazon Bedrock AgentCore**

```
Browser ──► Cloudflare Workers (SPA) ──► HF Space (FastAPI)
                                              │
                         ┌────────────────────┴────────────────────┐
                         │  /api/auth  │  /api/dcm  │  /api/agents │
                         └─────────────────────────────────────────┘
```

No external SaaS runtime dependency. No LangSmith. You own the generated code.

---

## Quick Start (Local)

### 1. Run the Backend

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Backend at `http://localhost:8000`. Health check:
```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/health
```

### 2. Run the Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend at `http://localhost:5173`. Vite proxies `/api/*` → `localhost:8000`.

### 3. Login

Open `http://localhost:5173`. Demo users:

| Username | Password | Role |
|----------|----------|------|
| `ana` | `ana` | creator |
| `carlos` | `carlos` | admin |
| `beatriz` | `beatriz` | viewer |

---

## Hosting the Platform (free)

Two-tier free deploy:
- **Backend**: HuggingFace Spaces (Docker SDK)
- **Frontend**: Cloudflare Workers (Assets)

Generated agents target the customer's own AWS account — billing for Bedrock/AgentCore is the customer's, not the platform host's.

### Backend → HuggingFace Spaces

The backend repo ships [backend/Dockerfile](../backend/Dockerfile) and [backend/README.md](../backend/README.md) with HF Spaces YAML frontmatter (`sdk: docker`, `app_port: 7860`).

**First-time setup:**

1. Create a Space at https://huggingface.co/new-space:
   - SDK: **Docker → Blank**
   - Space name: `jaguardata`

2. Generate a write token at https://huggingface.co/settings/tokens.

3. Add the HF remote and push the backend subtree:

```bash
cd Plataforma-Agentica
git remote add hf https://USER:TOKEN@huggingface.co/spaces/USER/jaguardata
git push hf $(git subtree split --prefix=backend HEAD):main --force
```

4. Set secrets on the Space at **Settings → Variables and secrets**:

| Name | Value |
|------|-------|
| `JWT_SECRET` | A strong random string |
| `CORS_ORIGINS` | Your Workers URL (e.g., `https://jaguardata.YOUR-ACCOUNT.workers.dev`) |

5. Wait for build. Space badge turns **Running**. Verify:
   ```bash
   curl https://USER-jaguardata.hf.space/health
   ```

**Updating:**

```bash
git add backend/
git commit -m "backend: describe changes"
git push hf $(git subtree split --prefix=backend HEAD):main --force
```

Space auto-rebuilds. ~2-3 min.

### Frontend → Cloudflare Workers

The frontend repo ships [frontend/wrangler.toml](../frontend/wrangler.toml) and [frontend/.env.production](../frontend/.env.production).

**First-time setup:**

1. Authenticate:
   ```bash
   cd frontend
   npx wrangler login
   ```

2. Edit `.env.production`:
   ```
   VITE_API_BASE=https://YOUR-USER-jaguardata.hf.space/api
   ```

3. Build and deploy:
   ```bash
   npm run build
   npx wrangler deploy
   ```

4. Frontend at `https://jaguardata.YOUR-ACCOUNT.workers.dev`.

**Updating:**

```bash
cd frontend
npm run build && npx wrangler deploy
```

~20-30s. Zero-downtime.

> **Why a committed `.env.production`?** Cloudflare Workers Assets blocks runtime variables on assets-only deploys. Vite reads `.env.production` during `vite build` and inlines `VITE_API_BASE` into the JS bundle. The engine URL is public — no secret to leak.

### Configuration Reference

Set on HF Space at **Settings → Variables and secrets**:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CORS_ORIGINS` | Yes | `http://localhost:5173,http://localhost:4173` | Comma-separated frontend origins |
| `JWT_SECRET` | Yes | `dev-secret` | Secret key for JWT signing |
| `DCM_DATABASE_PATH` | No | `data/dcm.sqlite3` | SQLite database path |
| `MOCK_MODE` | No | unset | Set to `true`/`1` to short-circuit AWS endpoints (Bedrock, AgentCore, CloudWatch) and return demo fixtures. Lets the platform run as self-contained demo with no AWS account or boto3 calls. Frontend shows a yellow "MODO DEMO" banner. Hides the AWS credentials form in the catalog. |

### Caveats

- HF free tier sleeps after ~48 h idle; first wake is slow (~10-30s).
- HF free tier storage is ephemeral — seed data reloads on restart.
- HF public Space = public source. Pro plan ($9/mo) for private Spaces.
- Cloudflare Workers free tier: 100k requests/day.
- Generated agents run on the **customer's** AWS account; that bill is separate.

---

## Data Contract Manager (DCM)

### Concepts

| Concept | Description |
|---------|-------------|
| **Contract** | A data contract defining schema, location, partitioning, SLAs for a dataset. Has a lifecycle: Draft → Active → Deprecated. |
| **Layer** | Data maturity level: Raw, Bronze, Silver, Gold. Each layer has specific quality and freshness expectations. |
| **Change Request** | A formal proposal to modify a contract. Requires admin approval. Status: Pending → Approved/Rejected. |
| **Domain** | Business area owning the contract (e.g., Finance, Marketing, Operations). |

### Workflow

```
Creator creates contract → auto-creates change request → Admin reviews → approves/rejects → Contract updated
```

### Pages

| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/` | 4 metric cards, layer distribution chart, recent activity |
| Contracts List | `/contracts` | Filterable table (status, layer, search) |
| Contract Detail | `/contracts/:id` | Tabs: Overview, Schema, Location, Partitioning, History, Requests |
| Create Contract | `/contracts/new` | 3-step wizard: Identification → Location/SLA → Schema |
| Requests List | `/requests` | Filterable by status |
| Request Detail | `/requests/:id` | Diff viewer, comment thread, approve/reject |

### Export Formats

Contracts export to three formats from the detail page:

| Format | Description |
|--------|-------------|
| JSON | Full contract as JSON |
| YAML | Full contract as YAML |
| DDL | SQL CREATE TABLE statement derived from schema |

---

## Agents Studio

### Studio Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Toolbar  [🤖 Agents Studio]  [project-name]  ●Engine  [⬆Import] [🔀Git] ... │
├────────────┬────────────────────────────────────────┬────────────────────────┤
│            │                                        │                        │
│   Node     │   Canvas (red banner: graph errors)    │   Config Panel         │
│   Panel    │   (drag-and-drop area)                 │   (selected node)      │
│            │                                        │                        │
└────────────┴────────────────────────────────────────┴────────────────────────┘
```

| Area | Purpose |
|------|---------|
| **Node Panel** (left) | Catalog of node types grouped by category. Drag onto canvas. |
| **Canvas** (center) | Compose the agent by connecting nodes with edges. |
| **Config Panel** (right) | Edit selected node's parameters. |
| **Toolbar** (top) | Project name, engine health dot, Import ZIP, Git, Validate, Generate ZIP, Help. |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `?` | Open Help (when not typing in a field) |
| `Esc` | Close any modal |
| `Delete` / `Backspace` | Remove selected node or edge |

### Build an Agent (5-min quickstart)

**Step 1 — Add nodes.** Drag Input, Agent, and Output from the left panel onto the canvas.

**Step 2 — Connect nodes.** Drag from a node's output port (right side) to another's input port (left side). Port colors must match (or one must be `any`).

| Color | Type |
|-------|------|
| Blue | `string` |
| Orange | `json` |
| Purple | `document` |
| Teal | `vector` |
| Pink | `retriever` |
| Green | `boolean` |
| Gray | `any` |

**Step 3 — Configure nodes.** Click a node to edit its fields in the right panel. Required fields are marked with a red asterisk.

**Step 4 — Validate.** Click ✓ Validate. The engine checks for cycles, missing fields, type mismatches, and security constraints.

**Step 5 — Generate.** Click ⬇ Generate ZIP. Downloads `agent-{name}-{timestamp}.zip`.

**Step 6 — Re-edit.** Click ⬆ Import ZIP to reload a previously generated bundle. Canvas is restored from `project.json`.

### Git Integration

Click 🔀 Git in the toolbar. Push the full generated repo (Python, Terraform, tests, Dockerfile, project.json) to GitHub or GitLab. Pull a `project.json` back into the canvas.

**Prerequisites:** Personal Access Token with repo write access.

| Provider | Token Type | Scopes |
|----------|-----------|--------|
| GitHub | Fine-grained | `Contents: read & write` |
| GitLab | Personal | `api` |

Tokens stored in browser `localStorage` only. Engine forwards them once per request — never persists them.

### Node Types (27 total)

- **Input / Output**: `input`, `output`
- **Agents & Orchestration**: `agent`, `multi_agent_coordinator`, `human_in_the_loop`, `code_interpreter`, `browser_tool`
- **Tools**: `tool_custom`, `tool_athena`, `tool_s3`, `tool_http`, `tool_bedrock`
- **MCP**: `mcp_server`, `mcp_client`
- **Knowledge Base / RAG**: `kb_s3_vector`, `kb_bedrock`, `chunking`, `embedding`, `retriever`
- **Ingestion Pipelines**: `s3_source`, `document_parser`, `ingest_pipeline`
- **Flow Control**: `condition`, `loop`, `cache`, `logger`

Full details in the Help panel (`?` key) inside the Studio.

### Generated ZIP Structure

```
agent-{name}-{timestamp}.zip
├── agent/              ← LangGraph package (state.py, graph.py, runner.py, nodes/, tools/)
├── mcp_server/         ← MCP server (only when mcp_server node is present)
├── infra/              ← Terraform: agentcore.tf, agentcore_memory.tf, api_gateway.tf, iam.tf, lambda.tf, ecr.tf
├── tests/              ← pytest files (one per tool node)
├── local/              ← run_agent.py, run_workflow.py, mock_tools.py
├── Dockerfile          ← python:3.12-slim → CMD ["python","-m","agent.runner"]
├── pyproject.toml      ← uv-managed deps; bedrock-agentcore included
├── .env.example        ← AgentCore env vars (no LangSmith)
└── project.json        ← Re-import schema
```

### Deploying a Generated Agent

```bash
unzip agent-my-agent-20260506120000.zip -d my-agent/
cd my-agent/

# Run tests
uv run pytest tests/ -v

# Local run with mocked AWS
uv run python local/run_agent.py --input '{"message": "Hello"}' --mock-tools

# Provision infrastructure
cd infra/
terraform init -backend-config=backend.hcl
terraform apply -var-file=dev.tfvars -target=aws_ecr_repository.agent

# Build & push container
ECR_URL=$(terraform output -raw ecr_repository_url)
cd ..
docker build -t agent .
docker tag agent:latest $ECR_URL:latest
docker push $ECR_URL:latest

# Apply remaining infra
cd infra/
terraform apply -var-file=dev.tfvars
```

### Invoking the Deployed Agent

```bash
# Via API Gateway
curl -X POST "$API_GATEWAY_URL/invoke" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "actor_id": "user-42"}'

# Direct AgentCore Runtime (SigV4)
aws bedrock-agentcore invoke-agent-runtime \
  --agent-runtime-arn "$AGENTCORE_RUNTIME_ARN" \
  --payload '{"message": "Hello"}'
```

### Code Generation Pipeline

Seven phases when you click Generate:

1. **Validator** — topological sort, type-check edges, required fields, security checks
2. **Graph Compiler** — emits Python: state schema, node functions, LangGraph assembly, AgentCore runner
3. **IaC Generator** — Terraform modules: AgentCore Runtime/Memory/Gateway/Identity, API GW, IAM, ECR, per-tool Lambdas
4. **Test Generator** — pytest files with moto mocks
5. **Local Runner Scaffold** — Dockerfile, pyproject.toml, local/ scripts
6. **Observability Injector** — AgentCore observability auto-instrumentation
7. **ZIP Bundler** — packages all artifacts + project.json

---

## Troubleshooting

### Local Development

| Symptom | Fix |
|---------|-----|
| Backend won't start | Check Python 3.12+, run `uv sync` |
| Frontend can't reach backend | Verify backend on port 8000; Vite proxy in `vite.config.ts` |
| Login fails | Confirm backend running; demo users are `ana`, `carlos`, `beatriz` with password same as username |
| Engine health dot red | Backend not running, or `/api/health` endpoint unreachable |

### Deployed

| Symptom | Fix |
|---------|-----|
| Frontend shows "Not Found" on API calls | Check `VITE_API_BASE` in `.env.production` ends with `/api` |
| Login fails on deployed frontend | Verify CORS_ORIGINS includes Workers URL exactly |
| Engine health dot red on deployed | Wake the Space: `curl https://USER-jaguardata.hf.space/health`. Check Space is Running. |
| Space build failed | Check HF Space build logs. Fix README frontmatter (valid colors: red/yellow/green/blue/indigo/purple/pink/gray). |
| HF push rejected (YAML validation) | Check `backend/README.md` frontmatter fields match HF requirements |
| HF push rejected (non-fast-forward) | Use `--force` flag (required because subtree split creates new commit hashes) |
| SQLite data lost on HF | Expected on free tier (ephemeral). Seed data reloads on restart. |
| Cloudflare deploy fails | Run `npx wrangler login` first. Check wrangler.toml exists in frontend/. |

### Agent Studio

| Symptom | Fix |
|---------|-----|
| `MISSING_REQUIRED_FIELD` | Open node, fill required fields |
| `TYPE_MISMATCH` | Route through `any`-typed port or change port type |
| `CYCLE_DETECTED` | Remove back-edge or use `loop` node |
| `UNSAFE_QUERY_TEMPLATE` | Replace `{var}` with `?` placeholders in Athena queries |
| Generate returns 422 | Click Validate first, fix all errors |
| Imported ZIP rejected | Must be a ZIP generated by this platform (contains `project.json`) |
| Canvas won't connect two ports | Source and target types don't match. Use `any` port or transform node. |

### Git Integration

| Symptom | Fix |
|---------|-----|
| HTTP 401 | PAT expired or wrong scope. GitHub: Contents read/write. GitLab: api. |
| HTTP 404 on first push | Expected — engine auto-creates branch off default |
| Pull: file not found | Path doesn't exist on that ref. Verify branch and path. |
| GitLab self-hosted error | Set the correct base URL in the Git modal |

---

## More Resources

- [Project README](../README.md) — overview, directory structure, local dev, deployment
- [CLAUDE.md](../CLAUDE.md) — guidance for AI assistants working in this repo
- [agentcore-gaps.md](agentcore-gaps.md) — AgentCore SDK implementation coverage
- [generative-agents-platform-spec.md](../generative-agents-platform-spec.md) — original platform specification
