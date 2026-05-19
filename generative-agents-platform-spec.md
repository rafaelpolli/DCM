# Generative Agents Platform — Technical Specification

**Version:** 1.0.0
**Status:** Draft (original intent)
**Last updated:** 2026-05-04
**Implementation status:** As of 2026-05-06 (commit `0f44844`) the codebase
diverges from this spec on several runtime and observability decisions.
The spec is preserved as the original design intent; the **source of truth
for current behavior is the code + `CLAUDE.md` + `docs/agentcore-gaps.md`**.

Key divergences:
- **Hosting:** Agent runs on **AgentCore Runtime** (container, not Lambda).
  Generated `runner.py` uses `BedrockAgentCoreApp` with `@app.entrypoint`
  (and `@app.streaming_entrypoint` when streaming). No `lambda_handler` is
  emitted for the agent. Per-tool Lambdas are still generated.
- **Observability:** **AgentCore Observability** (auto-instrumentation →
  CloudWatch GenAI) replaces LangSmith entirely. No `LANGCHAIN_*` env
  vars, no `langsmith` dependency.
- **Memory:** AgentCore Memory uses real SDK API
  (`MemoryClient.create_event` + `retrieve_memories`) with semantic +
  summary + user_preference strategies. DynamoDB checkpointer is reserved
  for HITL `interrupt()` resume only.
- **OAuth2 token vending:** AgentCore Identity (`IdentityClient.get_token`)
  replaces manual httpx token caching in `tool_http`.
- **Public HTTP:** API Gateway → thin `agentcore_invoker` Lambda →
  `bedrock-agentcore:InvokeAgentRuntime`. Direct callers can bypass via
  SigV4 / A2A.
- **Container base:** `python:3.12-slim` running `python -m agent.runner`
  on `:8080`, replacing the Lambda base image.
- **Git integration:** engine exposes `POST /git/push` and `POST /git/pull`
  (GitHub REST v3 Trees API + GitLab REST v4 Commits API) so the Studio
  can push generated repos and round-trip-edit `project.json` straight
  out of GitHub/GitLab.
- **Platform hosting (free):** Studio on Cloudflare Workers Assets, engine
  on Hugging Face Spaces (Docker SDK on :7860). See
  [docs/user-guide.md](docs/user-guide.md) for the deploy procedure.
- **Studio UX:** Help modal (`?` shortcut), Import ZIP (client-side via
  JSZip), Git modal w/ provider switcher, engine health indicator
  polling `/health` every 15 s, global errors banner over the canvas for
  graph-level validation errors not anchored to a node.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture Overview](#2-architecture-overview)
3. [Authentication & Access](#3-authentication--access)
4. [Layer 1 — Studio (Frontend)](#4-layer-1--studio-frontend)
5. [Node Catalog & Schema](#5-node-catalog--schema)
6. [Layer 2 — Code Generation Engine](#6-layer-2--code-generation-engine)
7. [Graph Compiler — Design](#7-graph-compiler--design)
8. [Layer 3 — Generated Artifacts](#8-layer-3--generated-artifacts)
9. [Layer 4 — AWS Runtime](#9-layer-4--aws-runtime)
10. [MCP Server Execution Model](#10-mcp-server-execution-model)
11. [Observability](#11-observability)
12. [Testing & Local Simulation](#12-testing--local-simulation)
13. [Project Import & Export](#13-project-import--export)
14. [project.json Schema & Versioning](#14-projectjson-schema--versioning)
15. [Deploy Flow](#15-deploy-flow)
16. [Security](#16-security)
17. [Technology Stack Reference](#17-technology-stack-reference)
18. [Open Decisions & Future Work](#18-open-decisions--future-work)

---

## 1. Overview

A **self-hosted** platform installed in the customer's AWS account that enables visual creation of generative AI agents and workflows through a low-code drag-and-drop interface. When the design is complete, the platform generates a full ZIP package ready for deployment — Python code, Terraform infrastructure, and Docker containers — running entirely within the customer's AWS account.

### Key principles

- **Self-hosted:** No external SaaS dependency. Installed via Terraform into the customer's AWS account.
- **Single-tenant:** One installation per customer. Multi-workspace and RBAC are out of scope.
- **Code ownership:** Generated ZIP has no license restrictions. All code is the customer's property.
- **AWS-first:** All runtime resources deploy to the customer's AWS account. No shared infrastructure.
- **Bedrock-first:** Amazon Bedrock is the sole LLM provider in the initial release. Architecture is extensible for future providers.

### Deployment model

```
┌─────────────────────────────────────────────────────────┐
│                  Customer AWS Account                   │
│                                                         │
│  ┌─────────────────────┐   ┌───────────────────────┐   │
│  │  Platform (Studio + │   │  Generated Agent       │   │
│  │  Engine)            │   │  Runtime               │   │
│  │                     │   │                        │   │
│  │  CloudFront + S3    │   │  AgentCore + Lambda    │   │
│  │  API Gateway        │   │  Bedrock + S3 Vectors  │   │
│  │  DynamoDB           │   │  Athena + API Gateway  │   │
│  └─────────────────────┘   └───────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Architecture Overview

The platform is organized into four layers, each with a distinct responsibility:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 1 — Studio (Frontend)                                         │
│  Canvas · Node Panel · Config Panel · Preview · Local Simulation     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  Graph JSON (DAG)
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 2 — Code Generation Engine                                    │
│  Graph Compiler · IaC Generator · Test Generator · ZIP Bundler       │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  agent-{name}-{ts}.zip
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 3 — Generated Artifacts (ZIP)                                 │
│  Python Agent · MCP Server · Terraform · Dockerfile · Tests · Docs  │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  terraform apply
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Layer 4 — AWS Runtime (Customer Account)                            │
│  AgentCore · Lambda · Bedrock · S3 Vectors · Athena · API Gateway   │
└──────────────────────────────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | Owner | Primary Output |
|---|---|---|
| Studio | Platform team | Visual graph (DAG JSON) |
| Code Generation Engine | Platform team | ZIP with all artifacts |
| Generated Artifacts | Customer | Deployable Python + IaC |
| AWS Runtime | Customer | Running agent/workflow |

---

## 3. Authentication & Access

The platform does not implement its own authentication system. The mechanism is chosen by the developer at installation time from two supported options:

### Option A — Amazon Cognito

User pools with MFA, groups, and JWT tokens. Recommended for installations without an existing corporate IdP. Token validation is handled natively by API Gateway via a Cognito authorizer.

```
User → Studio (CloudFront) → API Gateway → Cognito Authorizer → Platform API
```

### Option B — Corporate SSO (SAML 2.0 / OIDC)

Integration with Okta, Azure AD, or Google Workspace via:
- **Cognito Identity Federation** (federates the external IdP into a Cognito user pool), or
- **ALB with OIDC authentication** (Application Load Balancer handles the OIDC flow before forwarding to the backend)

The specific mechanism is left to the developer's discretion based on existing infrastructure.

### Common guarantees (both options)

- The platform receives a validated JWT and does not store user credentials.
- User identity is propagated via the JWT `sub` claim for audit logging.
- Session expiry and token refresh follow the chosen provider's configuration.

---

## 4. Layer 1 — Studio (Frontend)

A single-page application (SPA) built with **React + TypeScript**, served via **CloudFront + S3**.

### 4.1 Canvas

The main composition area where agents and workflows are assembled visually.

**Interactions:**
- Drag nodes from the Node Panel onto the canvas
- Connect nodes by drawing edges between typed ports
- Select nodes to open the Config Panel
- Select edges to inspect payload type and add transformations
- Group nodes into named subgraphs (collapsed/expanded)
- Keyboard shortcuts: undo/redo, delete, duplicate, group, zoom-to-fit

**Visual feedback:**
- Real-time compatibility validation on port connection attempts (type mismatch shown as red edge)
- Node status badges: unconfigured (gray), valid (green), warning (amber), error (red)
- Execution overlay: when running in Preview mode, each node shows its current state (idle, running, done, failed) and the last payload on each edge

**Technical implementation:**
- Graph rendering via **React Flow** (or equivalent)
- Internal graph state managed as a normalized DAG: `{ nodes: Node[], edges: Edge[] }`
- Autosave to platform backend (DynamoDB) every 10 seconds with optimistic updates

### 4.2 Node Panel

Categorized library of available components with search and type filter.

**Categories:**
- Input / Output
- Agents & Orchestration
- Tools
- MCP
- Knowledge Base / RAG
- Ingestion Pipelines
- Flow Control

Each node card shows: icon, name, short description, and a tooltip with port types.

### 4.3 Config Panel

Contextual form for the selected node. Fields are defined by the node's JSON schema. Supports:
- Static values (strings, numbers, booleans, enums)
- Dynamic expressions referencing upstream node outputs using a simple expression language: `{{node_id.output.field}}`
- Secret references: `secret://secret-name` resolved at runtime via AWS Secrets Manager
- Multi-line code editors (Monaco) for custom Python tool bodies and system prompts

### 4.4 Preview & Sandbox

In-Studio execution in an isolated sandbox environment:
- Executes the full graph or a selected subgraph
- Displays the payload flowing through each edge after execution
- Shows a structured log panel (timestamp, node, level, message)
- Sandbox uses mocked AWS dependencies by default; can be toggled to real AWS for integration testing

### 4.5 Local Simulation Panel

Dedicated UI for local execution (see [Section 12](#12-testing--local-simulation)):
- Generates a `docker run` command pre-filled with all required environment variables
- Provides a one-click download of `.env.example` pre-filled from the current node configs
- Shows connection instructions for attaching a debugger to the local container

### 4.6 Import Panel

Upload interface for importing previously exported ZIPs (see [Section 13](#13-project-import--export)).

---

## 5. Node Catalog & Schema

### 5.1 Node JSON Schema

Every node in the canvas is represented by a JSON object conforming to the following base schema:

```json
{
  "$schema": "https://platform.internal/schemas/node/v1.json",
  "id": "string (UUID)",
  "type": "string (node type identifier)",
  "label": "string (user-defined display name)",
  "position": {
    "x": "number",
    "y": "number"
  },
  "config": {
    "...type-specific fields..."
  },
  "ports": {
    "inputs": [
      {
        "id": "string",
        "name": "string",
        "data_type": "string (any | string | json | document | vector | control)",
        "required": "boolean"
      }
    ],
    "outputs": [
      {
        "id": "string",
        "name": "string",
        "data_type": "string"
      }
    ]
  },
  "metadata": {
    "created_at": "ISO 8601 datetime",
    "updated_at": "ISO 8601 datetime",
    "notes": "string (optional)"
  }
}
```

### 5.2 Edge JSON Schema

```json
{
  "id": "string (UUID)",
  "source_node_id": "string",
  "source_port_id": "string",
  "target_node_id": "string",
  "target_port_id": "string",
  "data_type": "string",
  "transform": "string | null (optional expression applied to the payload in transit)"
}
```

### 5.3 Node Type Definitions

#### `input`

Entry point of a workflow. Defines the trigger mechanism.

```json
{
  "type": "input",
  "config": {
    "trigger": "http | s3_event | sqs | schedule",
    "http": {
      "method": "GET | POST | PUT | DELETE",
      "path": "string",
      "auth": "none | jwt | api_key"
    },
    "s3_event": {
      "bucket": "string",
      "prefix": "string",
      "event_type": "ObjectCreated | ObjectRemoved"
    },
    "sqs": {
      "queue_url": "string",
      "batch_size": "integer (1-10)"
    },
    "schedule": {
      "expression": "string (cron or rate expression)"
    }
  },
  "ports": {
    "inputs": [],
    "outputs": [{ "id": "payload", "name": "Payload", "data_type": "json" }]
  }
}
```

#### `output`

Terminal node that defines the workflow response.

```json
{
  "type": "output",
  "config": {
    "mode": "json | stream | s3_file",
    "status_code": "integer (default: 200)",
    "s3": {
      "bucket": "string",
      "key_template": "string (supports {{run_id}}, {{timestamp}})"
    }
  },
  "ports": {
    "inputs": [{ "id": "payload", "name": "Payload", "data_type": "any", "required": true }],
    "outputs": []
  }
}
```

#### `agent`

Core node. Encapsulates a LangGraph agent with a Bedrock LLM.

```json
{
  "type": "agent",
  "config": {
    "model_id": "string (Bedrock model ID, e.g. anthropic.claude-3-5-sonnet-20241022-v2:0)",
    "inference_profile_arn": "string | null (cross-region inference profile ARN; takes precedence over model_id when set. Required if the model is not available in the deployment region. Format: arn:aws:bedrock:{region}:{account}:inference-profile/{profile-id})",
    "system_prompt": "string (supports {{variable}} interpolation)",
    "temperature": "number (0.0–1.0, default: 0.7)",
    "max_tokens": "integer (default: 4096)",
    "memory": {
      "enabled": "boolean",
      "backend": "dynamodb | in_memory",
      "ttl_seconds": "integer"
    },
    "guardrails": {
      "guardrail_id": "string | null",
      "guardrail_version": "string | null"
    },
    "tools": ["string (node IDs of connected tool nodes)"],
    "streaming": "boolean (default: false)"
  },
  "ports": {
    "inputs": [
      { "id": "message", "name": "User message", "data_type": "string", "required": true },
      { "id": "context", "name": "Context", "data_type": "json", "required": false }
    ],
    "outputs": [
      { "id": "response", "name": "Agent response", "data_type": "string" },
      { "id": "tool_calls", "name": "Tool calls log", "data_type": "json" }
    ]
  }
}
```

#### `multi_agent_coordinator`

Supervisor agent that routes tasks to sub-agents.

```json
{
  "type": "multi_agent_coordinator",
  "config": {
    "model_id": "string",
    "system_prompt": "string",
    "routing_strategy": "llm_based | rule_based",
    "workers": ["string (node IDs of worker agent nodes)"],
    "max_iterations": "integer (default: 10)"
  },
  "ports": {
    "inputs": [{ "id": "task", "name": "Task", "data_type": "string", "required": true }],
    "outputs": [{ "id": "result", "name": "Result", "data_type": "json" }]
  }
}
```

#### `human_in_the_loop`

Pauses workflow execution awaiting human approval via a callback URL.

> **State persistence requirement:** Graphs containing a `human_in_the_loop` node **must** compile with a DynamoDB checkpointer (see [Section 7.3](#73-compilation-steps)). Without a persistent checkpointer, LangGraph cannot resume execution after the interrupt. The compiler detects HITL nodes and injects the checkpointer automatically.

```json
{
  "type": "human_in_the_loop",
  "config": {
    "notification": "email | sns | slack_webhook",
    "notification_target": "string",
    "timeout_seconds": "integer (default: 86400)",
    "timeout_action": "reject | approve"
  },
  "ports": {
    "inputs": [{ "id": "payload", "name": "Payload for review", "data_type": "json", "required": true }],
    "outputs": [
      { "id": "approved", "name": "Approved payload", "data_type": "json" },
      { "id": "rejected", "name": "Rejection reason", "data_type": "string" }
    ]
  }
}
```

**Callback mechanism:**

The generated node function calls LangGraph's `interrupt(payload)` to pause execution. The runner wraps the invocation with a `thread_id` (UUID, generated per-request and returned to the caller). The platform generates a dedicated `/callbacks/{thread_id}` endpoint on API Gateway.

```
1. Caller → POST /invoke  { "message": "...", "thread_id": "uuid" }
           ← 202 Accepted { "thread_id": "uuid", "status": "awaiting_approval" }

2. HITL node fires → sends notification to notification_target with:
   {
     "payload": <graph payload at this node>,
     "approve_url": "POST {api-gateway-url}/callbacks/{thread_id}",
     "instructions": "POST with { \"decision\": \"approve\"|\"reject\", \"reason\": \"string\" }"
   }

3. Reviewer → POST /callbacks/{thread_id}
              { "decision": "approve", "reason": "LGTM" }
              Authorization: Bearer {jwt}   ← same auth as /invoke

4. Callback handler resumes graph:
   graph.invoke(Command(resume={"decision": "approve", "reason": "LGTM"}),
                config={"configurable": {"thread_id": thread_id}})

5. Graph continues on `approved` or `rejected` branch.
```

If `timeout_seconds` elapses without a callback, a scheduled Lambda (EventBridge) fires and auto-resolves using `timeout_action`.
```

#### `tool_custom`

Custom Python function executed in a Lambda.

```json
{
  "type": "tool_custom",
  "config": {
    "name": "string (function name, snake_case)",
    "description": "string (shown to the LLM in the tools list)",
    "runtime": "inline | lambda_arn",
    "inline_code": "string (Python function body, used when runtime=inline)",
    "lambda_arn": "string | null",
    "input_schema": "JSON Schema object",
    "output_schema": "JSON Schema object",
    "timeout_seconds": "integer (default: 30)",
    "memory_mb": "integer (default: 256)"
  },
  "ports": {
    "inputs": [{ "id": "input", "name": "Input", "data_type": "json", "required": true }],
    "outputs": [{ "id": "output", "name": "Output", "data_type": "json" }]
  }
}
```

#### `tool_athena`

Executes a parameterized SQL query on Athena.

> **Parameterization:** Use `?` positional placeholders in `query_template`. The generated tool passes parameters via Athena's `ExecutionParameters` field in `StartQueryExecution`, which prevents SQL injection. String-formatted queries are prohibited by the compiler. Example: `SELECT * FROM orders WHERE customer_id = ? AND status = ?` with `params: ["C001", "shipped"]`.

```json
{
  "type": "tool_athena",
  "config": {
    "name": "string",
    "description": "string",
    "database": "string",
    "workgroup": "string (default: primary)",
    "query_template": "string (SQL with ? positional placeholders — passed via Athena ExecutionParameters, NOT string-formatted)",
    "output_location": "string (S3 URI for query results)",
    "max_rows": "integer (default: 100)"
  },
  "ports": {
    "inputs": [{ "id": "params", "name": "Query parameters", "data_type": "json", "required": true }],
    "outputs": [{ "id": "results", "name": "Query results", "data_type": "json" }]
  }
}
```

#### `tool_s3`

Reads from or writes to an S3 bucket.

```json
{
  "type": "tool_s3",
  "config": {
    "name": "string",
    "description": "string",
    "operation": "read | write | list",
    "bucket": "string",
    "key_template": "string (supports {{variable}} interpolation)"
  },
  "ports": {
    "inputs": [{ "id": "input", "name": "Input", "data_type": "any", "required": true }],
    "outputs": [{ "id": "output", "name": "Output", "data_type": "any" }]
  }
}
```

#### `tool_http`

Calls an external HTTP API.

```json
{
  "type": "tool_http",
  "config": {
    "name": "string",
    "description": "string",
    "base_url": "string",
    "method": "GET | POST | PUT | PATCH | DELETE",
    "headers": "object (static headers)",
    "auth": {
      "type": "none | api_key | bearer | oauth2_client_credentials",
      "secret_ref": "string (secret://secret-name)",
      "oauth2": {
        "token_url": "string (token endpoint, required when type=oauth2_client_credentials)",
        "scope": "string | null (space-separated OAuth2 scopes, optional)"
      }
    },
    "timeout_seconds": "integer (default: 30)"
  },
  "ports": {
    "inputs": [{ "id": "request", "name": "Request body / params", "data_type": "json", "required": true }],
    "outputs": [
      { "id": "response", "name": "Response body", "data_type": "json" },
      { "id": "status_code", "name": "HTTP status code", "data_type": "string" }
    ]
  }
}
```

> **OAuth2 client credentials generated pattern:** `secret_ref` must point to a Secrets Manager secret containing `{"client_id": "...", "client_secret": "..."}`. The generated tool fetches a token from `token_url` on first call and caches it (using `lru_cache` keyed on expiry) until the token's `expires_in` minus a 60-second buffer. On expiry the cache is cleared and a fresh token is fetched. No token is stored in state or logs.

#### `tool_bedrock`

Calls Amazon Bedrock APIs directly — model invocation, agent invocation, or batch inference. Used when the agent needs to call Bedrock outside the standard LLM channel (e.g., specialized models, image generation, or invoking a pre-existing Bedrock Agent by ARN).

```json
{
  "type": "tool_bedrock",
  "config": {
    "name": "string (function name, snake_case)",
    "description": "string (shown to the LLM in the tools list)",
    "operation": "invoke_model | invoke_agent | invoke_model_with_response_stream",
    "model_id": "string | null (Bedrock model ID, required when operation=invoke_model*)",
    "inference_profile_arn": "string | null (cross-region profile ARN, takes precedence over model_id)",
    "agent_id": "string | null (Bedrock Agent ID, required when operation=invoke_agent)",
    "agent_alias_id": "string | null (Bedrock Agent alias ID, required when operation=invoke_agent)",
    "body_template": "string | null (JSON template for model request body; supports {{variable}} interpolation)",
    "timeout_seconds": "integer (default: 30)"
  },
  "ports": {
    "inputs": [{ "id": "input", "name": "Input", "data_type": "json", "required": true }],
    "outputs": [
      { "id": "output", "name": "Model/Agent response", "data_type": "json" }
    ]
  }
}
```

The generated tool invokes Bedrock via boto3 (`bedrock-runtime` for models, `bedrock-agent-runtime` for agents). IAM generation adds `bedrock:InvokeModel` or `bedrock:InvokeAgent` scoped to the specified model/agent ARN.

#### `mcp_server`

Defines and exposes an MCP server running on AgentCore Runtime.

```json
{
  "type": "mcp_server",
  "config": {
    "name": "string",
    "transport": "stdio | sse",
    "tools": [
      {
        "name": "string",
        "description": "string",
        "input_schema": "JSON Schema object",
        "handler_ref": "string (node ID of a tool_custom node)"
      }
    ],
    "resources": [
      {
        "uri": "string",
        "name": "string",
        "description": "string",
        "mime_type": "string"
      }
    ]
  },
  "ports": {
    "inputs": [],
    "outputs": [{ "id": "server_url", "name": "Server URL", "data_type": "string" }]
  }
}
```

#### `mcp_client`

Connects to an external MCP server and makes its tools available to agents.

```json
{
  "type": "mcp_client",
  "config": {
    "server_url": "string",
    "transport": "stdio | sse",
    "auth": {
      "type": "none | bearer",
      "secret_ref": "string"
    }
  },
  "ports": {
    "inputs": [],
    "outputs": [{ "id": "tools", "name": "Available tools", "data_type": "json" }]
  }
}
```

#### `kb_s3_vector`

Connects to an Amazon S3 Vectors vector store.

```json
{
  "type": "kb_s3_vector",
  "config": {
    "bucket": "string (S3 Vectors bucket)",
    "index_name": "string",
    "embedding_model_id": "string (Bedrock model ID)"
  },
  "ports": {
    "inputs": [],
    "outputs": [{ "id": "retriever", "name": "Retriever", "data_type": "retriever" }]
  }
}
```

#### `kb_bedrock`

Connects to an Amazon Bedrock managed Knowledge Base.

```json
{
  "type": "kb_bedrock",
  "config": {
    "knowledge_base_id": "string",
    "retrieval_config": {
      "number_of_results": "integer (default: 5)",
      "search_type": "SEMANTIC | HYBRID"
    }
  },
  "ports": {
    "inputs": [],
    "outputs": [{ "id": "retriever", "name": "Retriever", "data_type": "retriever" }]
  }
}
```

#### `chunking`

Splits documents into chunks with configurable strategies.

```json
{
  "type": "chunking",
  "config": {
    "strategy": "fixed_size | semantic | by_section",
    "chunk_size": "integer (tokens, used when strategy=fixed_size, default: 512)",
    "chunk_overlap": "integer (tokens, default: 50)",
    "separators": ["string (used when strategy=by_section)"]
  },
  "ports": {
    "inputs": [{ "id": "documents", "name": "Documents", "data_type": "document", "required": true }],
    "outputs": [{ "id": "chunks", "name": "Chunks", "data_type": "document" }]
  }
}
```

#### `embedding`

Vectorizes chunks using a Bedrock embedding model.

```json
{
  "type": "embedding",
  "config": {
    "model_id": "string (e.g. amazon.titan-embed-text-v2:0)",
    "batch_size": "integer (default: 100)"
  },
  "ports": {
    "inputs": [{ "id": "chunks", "name": "Chunks", "data_type": "document", "required": true }],
    "outputs": [{ "id": "vectors", "name": "Vectors", "data_type": "vector" }]
  }
}
```

#### `retriever`

Performs semantic or hybrid search on a vector store.

```json
{
  "type": "retriever",
  "config": {
    "top_k": "integer (default: 5)",
    "search_type": "semantic | hybrid",
    "score_threshold": "number (0.0–1.0, optional)"
  },
  "ports": {
    "inputs": [
      { "id": "retriever", "name": "Retriever", "data_type": "retriever", "required": true },
      { "id": "query", "name": "Query", "data_type": "string", "required": true }
    ],
    "outputs": [{ "id": "documents", "name": "Retrieved documents", "data_type": "document" }]
  }
}
```

#### `s3_source`

Reads objects from an S3 bucket as the start of an ingestion pipeline.

```json
{
  "type": "s3_source",
  "config": {
    "bucket": "string",
    "prefix": "string",
    "allowed_mime_types": ["string"],
    "recursive": "boolean (default: true)"
  },
  "ports": {
    "inputs": [],
    "outputs": [{ "id": "objects", "name": "S3 objects", "data_type": "document" }]
  }
}
```

#### `document_parser`

Extracts text from structured files.

```json
{
  "type": "document_parser",
  "config": {
    "supported_formats": ["pdf", "docx", "html", "csv", "json"],
    "extract_metadata": "boolean (default: true)"
  },
  "ports": {
    "inputs": [{ "id": "raw", "name": "Raw file", "data_type": "document", "required": true }],
    "outputs": [{ "id": "parsed", "name": "Parsed document", "data_type": "document" }]
  }
}
```

#### `ingest_pipeline`

Composite node that orchestrates a full ingestion flow.

```json
{
  "type": "ingest_pipeline",
  "config": {
    "source_node_id": "string",
    "parser_node_id": "string",
    "chunking_node_id": "string",
    "embedding_node_id": "string",
    "destination_node_id": "string (kb_s3_vector or kb_bedrock node ID)"
  },
  "ports": {
    "inputs": [],
    "outputs": [{ "id": "summary", "name": "Ingestion summary", "data_type": "json" }]
  }
}
```

#### `condition`

Branches flow based on an expression evaluated on the incoming payload.

> **Security note:** Expressions are evaluated server-side. Only `jmespath` (read-only data traversal) and `cel` (Google Common Expression Language, sandboxed) are supported. `eval()`-based Python execution is explicitly prohibited — it would allow arbitrary code execution from the canvas.

```json
{
  "type": "condition",
  "config": {
    "expression": "string (e.g. payload.status == 'approved')",
    "expression_language": "jmespath | cel"
  },
  "ports": {
    "inputs": [{ "id": "payload", "name": "Payload", "data_type": "any", "required": true }],
    "outputs": [
      { "id": "true", "name": "True branch", "data_type": "any" },
      { "id": "false", "name": "False branch", "data_type": "any" }
    ]
  }
}
```

#### `loop`

Iterates over a list with configurable parallelism.

```json
{
  "type": "loop",
  "config": {
    "max_parallelism": "integer (default: 1, max: 10)",
    "error_strategy": "fail_fast | continue_on_error"
  },
  "ports": {
    "inputs": [{ "id": "items", "name": "List of items", "data_type": "json", "required": true }],
    "outputs": [
      { "id": "item", "name": "Current item (per-iteration output)", "data_type": "any" },
      { "id": "results", "name": "Collected results (post-loop output)", "data_type": "json" }
    ]
  }
}
```

> **Compilation semantics:** The `loop` node compiles to a LangGraph subgraph using the [Send API](https://langchain-ai.github.io/langgraph/how-tos/map-reduce/). The compiler generates a *fan-out* node that emits one `Send(target_node, item)` per list element (up to `max_parallelism` concurrent), and a *fan-in* collector node that aggregates results into the `results` output using `Annotated[List, operator.add]` state. Downstream nodes wired to `item` receive per-iteration payloads; downstream nodes wired to `results` receive the aggregated list after all iterations complete. These are **two separate subgraph edges** — a single downstream node cannot be wired to both ports.
```

#### `cache`

Stores and retrieves intermediate results.

> **v1 scope:** DynamoDB is the only supported backend. ElastiCache (Redis) support is planned for a future release (see [Section 18](#18-open-decisions--future-work)).

```json
{
  "type": "cache",
  "config": {
    "backend": "dynamodb",
    "key_expression": "string (JMESPath expression evaluated on incoming payload to derive cache key)",
    "ttl_seconds": "integer (default: 3600)"
  },
  "ports": {
    "inputs": [{ "id": "payload", "name": "Payload", "data_type": "any", "required": true }],
    "outputs": [
      { "id": "hit", "name": "Cache hit value", "data_type": "any" },
      { "id": "miss", "name": "Cache miss (original payload)", "data_type": "any" }
    ]
  }
}
```

#### `logger`

Emits structured events to CloudWatch (correlated with AgentCore Observability spans via OTEL `trace_id`).

```json
{
  "type": "logger",
  "config": {
    "level": "DEBUG | INFO | WARNING | ERROR",
    "message_template": "string (supports {{variable}} interpolation)",
    "include_payload": "boolean (default: false)"
  },
  "ports": {
    "inputs": [{ "id": "payload", "name": "Payload", "data_type": "any", "required": true }],
    "outputs": [{ "id": "payload", "name": "Pass-through payload", "data_type": "any" }]
  }
}
```

---

## 6. Layer 2 — Code Generation Engine

The engine is a backend service (Python) that receives the validated graph JSON and produces all deployable artifacts. It runs as a Lambda function or ECS task invoked when the user clicks **"Generate & Export"** in the Studio.

### Engine pipeline

```
Graph JSON (DAG)
       │
       ▼
┌─────────────┐
│  Validator  │ ── topological sort, type checking, required fields
└──────┬──────┘
       │ validated DAG
       ▼
┌──────────────────┐
│  Graph Compiler  │ ── emits Python (LangGraph) code
└──────┬───────────┘
       │ Python modules
       ▼
┌──────────────────┐
│  IaC Generator   │ ── emits Terraform modules
└──────┬───────────┘
       │ .tf files
       ▼
┌──────────────────────┐
│  Test Generator      │ ── emits pytest files per tool
└──────┬───────────────┘
       │ test files
       ▼
┌─────────────────────────┐
│  Local Runner Scaffold  │ ── emits local/ scripts
└──────┬──────────────────┘
       │ local scripts
       ▼
┌───────────────────────────┐
│  Observability Injector   │ ── injects AgentCore Observability + CloudWatch
└──────┬────────────────────┘
       │ instrumented code
       ▼
┌─────────────┐
│ ZIP Bundler │ ── packages everything + project.json
└─────────────┘
       │
       ▼
  agent-{name}-{timestamp}.zip
```

### Engine components

| Component | Input | Output |
|---|---|---|
| Validator | Graph JSON | Validated DAG or error list |
| Graph Compiler | Validated DAG | Python modules (LangGraph) |
| IaC Generator | Validated DAG | Terraform modules |
| Test Generator | Tool node configs | pytest files |
| Local Runner Scaffold | Full DAG | local/ scripts |
| Observability Injector | Python modules | Instrumented Python modules |
| ZIP Bundler | All artifacts | `.zip` download |

---

## 7. Graph Compiler — Design

The Graph Compiler is the most complex component of the engine. It translates the visual DAG into a fully functional LangGraph Python program.

### 7.1 Input

A validated DAG object with:
- `nodes: List[NodeDefinition]` — topologically sorted
- `edges: List[EdgeDefinition]` — typed connections between ports

### 7.2 Output

A Python package under `agent/` with the following structure:

```
agent/
├── __init__.py
├── graph.py          ← main LangGraph graph definition
├── state.py          ← TypedDict state schema
├── nodes/
│   ├── __init__.py
│   ├── {node_id}.py  ← one module per node
│   └── ...
├── config.py         ← environment variables and constants
└── runner.py         ← entrypoint (Lambda handler or CLI)
```

### 7.3 Compilation steps

#### Step 1 — State schema generation (`state.py`)

The compiler inspects all edges to determine what data flows through the graph. Each edge port becomes a field in the LangGraph `TypedDict` state:

```python
# state.py (generated)
from typing import TypedDict, List, Annotated
from langchain_core.messages import BaseMessage
import operator

class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]
    user_input: str
    retrieved_documents: List[dict]
    tool_results: List[dict]
    final_response: str
```

Rules:
- `data_type: "string"` → `str`
- `data_type: "json"` → `dict`
- `data_type: "document"` → `List[dict]`
- `data_type: "vector"` → `List[float]`
- Message-carrying edges → `Annotated[List[BaseMessage], operator.add]` (LangGraph convention for message accumulation)

#### Step 2 — Node function generation (`nodes/{node_id}.py`)

Each node in the DAG maps to a Python async function with the signature `async def node_{id}(state: AgentState) -> dict`. The return dict contains only the state keys that this node writes.

**`agent` node → LangGraph ReAct agent:**

```python
# nodes/node_abc123.py (generated)
from langchain_aws import ChatBedrock
from langgraph.prebuilt import create_react_agent
from ..state import AgentState
from ..tools import get_tools_for_agent

_model = ChatBedrock(
    model_id="anthropic.claude-3-5-sonnet-20241022-v2:0",
    model_kwargs={"temperature": 0.7, "max_tokens": 4096},
)
_agent = create_react_agent(_model, get_tools_for_agent("node_abc123"))

async def node_abc123(state: AgentState) -> dict:
    result = await _agent.ainvoke({"messages": state["messages"]})
    return {"messages": result["messages"], "final_response": result["messages"][-1].content}
```

**`condition` node → routing function:**

```python
# nodes/node_def456.py (generated)
from ..state import AgentState

def node_def456(state: AgentState) -> str:
    """Returns the name of the next node branch."""
    payload = state.get("payload", {})
    if payload.get("status") == "approved":
        return "true"
    return "false"
```

**`tool_custom` node → LangChain Tool:**

```python
# tools/tool_ghi789.py (generated)
from langchain_core.tools import tool
import boto3
import json

@tool
def check_inventory(product_id: str, warehouse: str) -> dict:
    """Check inventory levels for a product in a warehouse."""
    # --- BEGIN USER CODE ---
    client = boto3.client("dynamodb")
    response = client.get_item(
        TableName="inventory",
        Key={"product_id": {"S": product_id}, "warehouse": {"S": warehouse}}
    )
    return json.loads(json.dumps(response.get("Item", {})))
    # --- END USER CODE ---
```

#### Step 3 — Graph assembly (`graph.py`)

The compiler traverses the sorted DAG and emits the `StateGraph` definition:

```python
# graph.py (generated)
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.dynamodb import DynamoDBSaver  # injected when HITL nodes present
from .state import AgentState
from .nodes.node_abc123 import node_abc123
from .nodes.node_def456 import node_def456
from .config import CHECKPOINTER_TABLE, AWS_REGION

def build_graph() -> StateGraph:
    graph = StateGraph(AgentState)

    # Add nodes
    graph.add_node("node_abc123", node_abc123)
    graph.add_node("node_def456", node_def456)

    # Set entry point
    graph.set_entry_point("node_abc123")

    # Add edges
    graph.add_conditional_edges(
        "node_abc123",
        node_def456,
        {"true": "node_ghi789", "false": END}
    )

    # Compiler injects a DynamoDB checkpointer when human_in_the_loop nodes are present.
    # Without it, interrupt() cannot persist state and the workflow cannot resume.
    checkpointer = DynamoDBSaver.from_conn_info(
        region=AWS_REGION,
        table_name=CHECKPOINTER_TABLE,
    )
    return graph.compile(checkpointer=checkpointer)

graph = build_graph()

# Note: when NO human_in_the_loop nodes are present, the compiler omits the
# DynamoDBSaver import and calls graph.compile() with no checkpointer argument.
```

#### Step 4 — Runner / entrypoint (`runner.py`)

The runner is a **BedrockAgentCoreApp**. The agent runs inside an AgentCore
Runtime container (no Lambda for the agent). `app.run()` starts an HTTP
server on `0.0.0.0:8080`. AgentCore Runtime injects `session_context`
(session_id, actor_id) per invocation.

```python
# runner.py (generated)
from __future__ import annotations
import json
import uuid

from langchain_core.messages import HumanMessage
from bedrock_agentcore.runtime import BedrockAgentCoreApp

from .graph import graph
from .state import AgentState

app = BedrockAgentCoreApp()


def _build_initial_state(body: dict, actor_id: str, session_id: str) -> AgentState:
    message = body.get("message", "")
    return AgentState(
        messages=[HumanMessage(content=message)] if message else [],
        actor_id=actor_id,
        session_id=session_id,
        **{k: v for k, v in body.items() if k not in ("message", "thread_id", "actor_id", "session_id")},
    )


@app.entrypoint
async def invoke(payload: dict, session_context: dict) -> dict:
    body = payload if isinstance(payload, dict) else {}
    session_id = session_context.get("session_id") or body.get("thread_id") or str(uuid.uuid4())
    actor_id = session_context.get("actor_id") or session_context.get("user_id") or body.get("actor_id") or "anonymous"
    thread_id = session_id
    config = {"configurable": {"thread_id": thread_id}}
    state = _build_initial_state(body, actor_id=actor_id, session_id=session_id)

    result = await graph.ainvoke(state, config=config)
    final_output = result.get("final_output") or (result.get("messages", [])[-1].content if result.get("messages") else "")
    return {"response": final_output, "thread_id": thread_id}


# --- Streaming entrypoint (only when at least one agent has streaming=true) ---
@app.streaming_entrypoint
async def invoke_stream(payload: dict, session_context: dict):
    body = payload if isinstance(payload, dict) else {}
    session_id = session_context.get("session_id") or body.get("thread_id") or str(uuid.uuid4())
    actor_id = session_context.get("actor_id") or "anonymous"
    config = {"configurable": {"thread_id": session_id}}
    state = _build_initial_state(body, actor_id=actor_id, session_id=session_id)

    async for chunk in graph.astream(state, config=config, stream_mode="messages"):
        message, _ = chunk
        if hasattr(message, "content") and message.content:
            yield {"token": message.content, "thread_id": session_id}


if __name__ == "__main__":
    # Container entrypoint — AgentCore Runtime executes this command.
    app.run()
```

> **No `lambda_handler` is generated.** Public HTTP fronting goes via
> API Gateway → a tiny `agentcore_invoker` Lambda (≈80 lines) →
> `bedrock-agentcore:InvokeAgentRuntime`. Direct callers (A2A / SigV4)
> bypass API GW and hit the AgentCore Runtime endpoint directly.

### 7.4 Multi-agent compilation

When a `multi_agent_coordinator` node is present, the compiler generates a supervisor graph that contains sub-graphs:

```python
# graph.py (generated — multi-agent)
from langgraph.graph import StateGraph, END
from langgraph_supervisor import create_supervisor
from .agents.research_agent import research_agent
from .agents.writing_agent import writing_agent

supervisor = create_supervisor(
    [research_agent, writing_agent],
    model=_model,
    prompt="Route tasks to the appropriate agent."
)
graph = supervisor.compile()
```

### 7.5 Compilation error handling

The compiler emits a structured error report if it cannot generate valid code:

```json
{
  "status": "error",
  "errors": [
    {
      "node_id": "node_abc123",
      "field": "config.model_id",
      "code": "MISSING_REQUIRED_FIELD",
      "message": "model_id is required for agent nodes"
    }
  ]
}
```

Errors are surfaced in the Studio as inline validation markers on the affected nodes before generation is attempted.

---

## 8. Layer 3 — Generated Artifacts

### 8.1 ZIP structure

```
agent-{name}-{timestamp}.zip
│
├── agent/                    ← LangGraph Python agent
│   ├── __init__.py
│   ├── graph.py
│   ├── state.py
│   ├── config.py
│   ├── runner.py
│   └── nodes/
│       └── {node_id}.py
│
├── tools/                    ← Tool implementations
│   └── {tool_name}.py
│
├── mcp_server/               ← MCP server (AgentCore Runtime)
│   ├── server.py
│   ├── tools.py
│   └── resources.py
│
├── infra/                    ← Terraform modules
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── lambda.tf
│   ├── agentcore.tf
│   ├── api_gateway.tf
│   ├── iam.tf
│   ├── s3.tf
│   ├── dynamodb.tf
│   └── bedrock.tf
│
├── tests/                    ← Generated unit tests
│   ├── conftest.py
│   └── test_{tool_name}.py
│
├── local/                    ← Local simulation scripts
│   ├── run_agent.py
│   ├── run_workflow.py
│   └── mock_tools.py
│
├── Dockerfile                ← Multi-stage Python image
├── pyproject.toml            ← Dependencies (uv)
├── .env.example              ← Environment variables template
├── README.md                 ← Generated deployment guide
└── project.json              ← Graph schema (for re-import)
```

### 8.2 Generated README

The ZIP includes a `README.md` with:
- Prerequisites (AWS CLI, Terraform, uv, Docker)
- Step-by-step local simulation instructions
- Step-by-step deploy instructions (Terraform init → plan → apply)
- Environment variable reference table
- AgentCore Observability is auto-instrumented in-container; no setup needed
- Architecture diagram (text-based)

### 8.3 Python dependency stack

```toml
# pyproject.toml (generated)
[project]
name = "{agent-name}"
version = "0.1.0"
requires-python = ">=3.12"

dependencies = [
    "langgraph>=0.2",
    "langgraph-supervisor>=0.0.5",   # multi_agent_coordinator compilation
    "langchain>=0.3",
    "langchain-aws>=0.2",
    "langchain-community>=0.3",
    "boto3>=1.35",
    "bedrock-agentcore>=0.1",        # AgentCore Runtime/Memory/Identity/Tools/MCP/Observability SDK
    "langchain-mcp-adapters>=0.1",   # mcp_client integration
    "pydantic>=2.0",
    "jmespath>=1.0",                 # condition node jmespath expression language
    "celpy>=0.1.5",                  # condition node cel (sandboxed) expression language
    "httpx>=0.27",                   # tool_http
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "moto[all]>=5.0",
    "responses>=0.25",
]
```

---

## 9. Layer 4 — AWS Runtime

All resources are provisioned entirely within the customer's AWS account.

### 9.1 Resource map

```
┌──────────────────────────────────────────────────────────────────────┐
│  Customer AWS Account                                                │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Amazon AgentCore                                           │    │
│  │                                                             │    │
│  │  ┌─────────────────┐    ┌─────────────────────────────┐    │    │
│  │  │  Agent Runtime  │    │  MCP Server Runtime          │    │    │
│  │  │  (LangGraph)    │    │  (FastAPI/stdio on           │    │    │
│  │  │                 │    │   AgentCore Runtime)         │    │    │
│  │  └────────┬────────┘    └─────────────────────────────┘    │    │
│  │           │                                                 │    │
│  └───────────┼─────────────────────────────────────────────────┘    │
│              │                                                       │
│    ┌─────────▼────────────────────────────────────────────┐        │
│    │  AWS Lambda (Tools)                                  │        │
│    │  tool_custom · tool_athena · tool_s3 · tool_http     │        │
│    └─────────┬────────────────────────────────────────────┘        │
│              │                                                       │
│    ┌─────────▼──────────┐  ┌────────────┐  ┌──────────────────┐   │
│    │  Amazon Bedrock    │  │  S3 +      │  │  Amazon Athena   │   │
│    │  LLMs + Embeddings │  │  S3 Vectors│  │  Data lake       │   │
│    └────────────────────┘  └────────────┘  └──────────────────┘   │
│                                                                      │
│    ┌────────────────────┐  ┌────────────┐  ┌──────────────────┐   │
│    │  API Gateway       │  │  DynamoDB  │  │  CloudWatch      │   │
│    │  REST / WebSocket  │  │  State     │  │  Logs + Metrics  │   │
│    └────────────────────┘  └────────────┘  └──────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.2 Resource descriptions

| Resource | Purpose |
|---|---|
| **Amazon AgentCore** | Managed orchestrator for agents. Provides sessions, memory, traces, and Bedrock guardrails. Hosts both the agent runtime and the MCP Server runtime. |
| **AWS Lambda** | Serverless execution of tool functions. Each tool node generates one Lambda function with its own IAM role. |
| **Amazon S3** | Raw document storage for ingestion pipelines. |
| **Amazon S3 Vectors** | Vector store for embeddings with ANN search. |
| **Amazon Athena** | SQL queries over S3 data lakes via dedicated tool. |
| **Amazon API Gateway** | Exposes the agent as a REST endpoint (synchronous) or WebSocket (streaming). |
| **Amazon Bedrock** | LLM runtime (Anthropic Claude, Amazon Titan) and embedding models (Titan Embeddings v2). Cross-region inference supported. |
| **Amazon DynamoDB** | Agent session state, conversation history (if memory enabled), cache backend. |
| **AWS Secrets Manager** | Stores external API keys and sensitive config referenced in generated code. |
| **Amazon CloudWatch** | Structured JSON logs, custom metrics, and threshold-based alarms. |
| **AWS CloudTrail** | Audit log of all deploy and runtime API calls. |

---

## 10. MCP Server Execution Model

MCP Servers defined in the canvas are packaged in `mcp_server/` and deployed to **Amazon AgentCore Runtime**. This eliminates the need for ECS Fargate or separate Lambda infrastructure for MCP hosting.

### Structure of the generated MCP server

```python
# mcp_server/server.py (generated)
from agentcore_sdk.mcp import MCPServer
from .tools import get_all_tools
from .resources import get_all_resources

server = MCPServer(
    name="{agent-name}-mcp",
    transport="{stdio | sse}",
)

for tool in get_all_tools():
    server.register_tool(tool)

for resource in get_all_resources():
    server.register_resource(resource)

if __name__ == "__main__":
    server.run()
```

### Transport modes

| Mode | Use case | AgentCore deployment |
|---|---|---|
| `stdio` | Agent and MCP server co-located in same runtime | Subprocess inside AgentCore agent container |
| `sse` | MCP server consumed by multiple agents or external clients | Dedicated AgentCore Runtime endpoint with SSE |

### Tool handler wiring

Each MCP tool's `handler_ref` points to a `tool_custom` node. The compiler generates a handler that invokes the corresponding Lambda function:

```python
# mcp_server/tools.py (generated)
import boto3, json
from agentcore_sdk.mcp import MCPTool

lambda_client = boto3.client("lambda")

def search_documents_handler(query: str, top_k: int = 5) -> dict:
    response = lambda_client.invoke(
        FunctionName="arn:aws:lambda:...:function:tool-search-documents",
        Payload=json.dumps({"query": query, "top_k": top_k})
    )
    return json.loads(response["Payload"].read())

def get_all_tools():
    return [
        MCPTool(
            name="search_documents",
            description="Search documents in the knowledge base",
            input_schema={...},
            handler=search_documents_handler
        )
    ]
```

---

## 11. Observability

### 11.1 AgentCore Observability (current)

**Implementation status:** LangSmith was removed in favor of **Amazon
Bedrock AgentCore Observability**. The Observability Injector now emits
`agent/observability.py` with:

```python
from bedrock_agentcore.observability import configure as _configure_observability

_configure_observability(
    service_name=AGENT_NAME,
    enable_genai_spans=True,
    enable_langchain_instrumentation=True,
)
```

This module is side-effect-imported at the top of `agent/runner.py`. When
the container runs inside AgentCore Runtime, the SDK auto-instruments
LangGraph / LangChain calls and ships OpenTelemetry traces + GenAI spans
to **Amazon CloudWatch GenAI Observability**. No external SaaS keys, no
`LANGCHAIN_*` env vars, no `langsmith` PyPI dependency.

What's captured per invocation:
- Full input and output at each node
- Latency per step
- Token usage per LLM call
- Tool call arguments and results
- Error traces with full stack context
- A2A protocol session metadata (when AgentCore Runtime invocation)

### 11.2 Amazon CloudWatch

**Logs:** All Lambda functions and the AgentCore Runtime container emit
structured JSON logs:

```json
{
  "timestamp": "2026-05-06T10:00:00Z",
  "level": "INFO",
  "agent_name": "my-agent",
  "session_id": "sess-abc123",
  "actor_id": "user-42",
  "trace_id": "1-660abc12-…",
  "node_id": "node_abc123",
  "message": "Tool execution completed",
  "tool_name": "check_inventory",
  "duration_ms": 142
}
```

`trace_id` is the OpenTelemetry trace ID minted by AgentCore
Observability — open it directly in CloudWatch GenAI Observability for
the full span tree.

**Custom metrics (emitted via `agent/observability.py::emit_metric`):**

| Metric | Unit | Description |
|---|---|---|
| `AgentInvocationDuration` | Milliseconds | End-to-end latency per agent call |
| `ToolExecutionDuration` | Milliseconds | Per-tool execution time |
| `TokensConsumed` | Count | Total tokens (input + output) per invocation |
| `ToolErrorRate` | Percent | Error rate per tool function |

**Alarms (generated Terraform — when wired):**

```hcl
resource "aws_cloudwatch_metric_alarm" "latency_p95" {
  alarm_name          = "${var.agent_name}-latency-p95"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "AgentInvocationDuration"
  namespace           = "AgentsPlatform/${var.agent_name}"
  period              = 300
  statistic           = "p95"
  threshold           = var.latency_alarm_threshold_ms
}
```

### 11.3 Cross-system correlation

The OTEL `trace_id` from AgentCore Observability is included in every
CloudWatch structured log entry. Click through from a log entry in
`/aws/bedrock-agentcore/{agent_name}` to the GenAI Observability span tree
to debug any execution end-to-end.

---

## 12. Testing & Local Simulation

### 12.1 Generated unit tests

For each `tool_custom`, `tool_athena`, `tool_s3`, and `tool_http` node, the Test Generator emits a corresponding `tests/test_{tool_name}.py` file.

**Example generated test:**

```python
# tests/test_check_inventory.py (generated)
import pytest
import boto3
from moto import mock_aws
from tools.check_inventory import check_inventory

@pytest.fixture(autouse=True)
def aws_credentials(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")

@mock_aws
def test_check_inventory_success():
    # Setup
    dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
    table = dynamodb.create_table(
        TableName="inventory",
        KeySchema=[
            {"AttributeName": "product_id", "KeyType": "HASH"},
            {"AttributeName": "warehouse", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "product_id", "AttributeType": "S"},
            {"AttributeName": "warehouse", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    table.put_item(Item={"product_id": "P001", "warehouse": "WH-BR-01", "quantity": 150})

    # Execute
    result = check_inventory.invoke({"product_id": "P001", "warehouse": "WH-BR-01"})

    # Assert
    assert result["quantity"] == 150

@mock_aws
def test_check_inventory_not_found():
    dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
    dynamodb.create_table(
        TableName="inventory",
        KeySchema=[{"AttributeName": "product_id", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "product_id", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    result = check_inventory.invoke({"product_id": "NONEXISTENT", "warehouse": "WH-BR-01"})
    assert result == {}
```

Running all tests:

```bash
uv run pytest tests/ -v
```

### 12.2 Local agent simulation

**Setup:**

```bash
cp .env.example .env   # fill in values
uv sync                # install dependencies
```

**Run with mocked tools (fully offline):**

```bash
uv run python local/run_agent.py \
  --input '{"message": "What is the inventory for product P001?"}' \
  --mock-tools
```

**Run with real Bedrock (AWS profile required):**

```bash
AWS_PROFILE=my-dev-profile uv run python local/run_agent.py \
  --input '{"message": "What is the inventory for product P001?"}'
```

**Run full workflow:**

```bash
uv run python local/run_workflow.py \
  --input-file local/sample_input.json
```

**Run containerized (Docker):**

```bash
docker build -t my-agent .
docker run --env-file .env my-agent \
  python local/run_agent.py --input '{"message": "Hello"}'
```

The Studio's **"Run Locally"** button generates the `docker run` command pre-filled with all required environment variables extracted from the current node configs.

---

## 13. Project Import & Export

### 13.1 Export flow

```
User clicks "Export Project"
         │
         ▼
Engine validates graph
         │
         ▼
Engine generates all artifacts
         │
         ▼
ZIP bundled with project.json
         │
         ▼
ZIP offered as browser download
(no upload to external services)
```

The exported ZIP has no license restrictions. It is the customer's property.

### 13.2 Import flow

```
User uploads ZIP via Import Panel
         │
         ▼
Platform extracts project.json
         │
         ▼
Schema version check
  ├── Compatible: proceed
  ├── Requires migration: run migrators in chain → proceed with warning
  └── Incompatible (>2 major versions behind): show error with instructions
         │
         ▼
Graph reconstructed on canvas
         │
         ▼
Nodes referencing external AWS resources
(ARNs, bucket names) marked with amber warning badge
         │
         ▼
User reviews, adjusts, and can
re-export or deploy normally
```

Imported projects are indistinguishable from natively created ones — fully editable, re-exportable, and deployable.

---

## 14. project.json Schema & Versioning

### 14.1 Full schema

```json
{
  "$schema": "https://platform.internal/schemas/project/v1.json",
  "schema_version": "1.0.0",
  "platform_version": "0.4.2",
  "name": "string",
  "description": "string",
  "created_at": "ISO 8601 datetime",
  "exported_at": "ISO 8601 datetime",
  "tags": ["string"],
  "nodes": [
    {
      "id": "string (UUID)",
      "type": "string",
      "label": "string",
      "position": { "x": "number", "y": "number" },
      "config": {},
      "ports": {
        "inputs": [],
        "outputs": []
      },
      "metadata": {
        "created_at": "string",
        "updated_at": "string",
        "notes": "string"
      }
    }
  ],
  "edges": [
    {
      "id": "string (UUID)",
      "source_node_id": "string",
      "source_port_id": "string",
      "target_node_id": "string",
      "target_port_id": "string",
      "data_type": "string",
      "transform": "string | null"
    }
  ],
  "groups": [
    {
      "id": "string",
      "label": "string",
      "node_ids": ["string"]
    }
  ],
  "canvas": {
    "viewport": {
      "x": "number",
      "y": "number",
      "zoom": "number"
    }
  }
}
```

### 14.2 Versioning strategy

The `project.json` carries its own schema version, independent of the platform version.

#### Increment rules

| Type | Example | Rule |
|---|---|---|
| **patch** | 1.0.0 → 1.0.1 | Metadata fields, optional fields with defaults. Fully backward compatible. |
| **minor** | 1.0.0 → 1.1.0 | New node types, new optional fields. Older platforms ignore unknown fields. |
| **major** | 1.0.0 → 2.0.0 | Renaming required fields, restructuring edges, removing node types. Requires a migrator. |

#### Migrators

For each version bump, a declarative Python migrator module is maintained in the platform codebase:

```python
# platform/migrations/v1_0_to_v1_1.py
#
# ILLUSTRATIVE EXAMPLE of the migrator pattern.
# This specific rename (model_id → model) is a PLANNED v1.1 change —
# the current schema (v1.0.0) still uses `model_id` in agent nodes.
# When v1.1 is released, this migrator fires on import of any v1.0 project.
#
from typing import Any

MIGRATION_FROM = "1.0.0"
MIGRATION_TO = "1.1.0"

def migrate(project: dict[str, Any]) -> dict[str, Any]:
    """
    Planned v1.1.0 change: agent node config field renamed from
    'model_id' to 'model' to align with Bedrock SDK naming.
    Current v1.0.0 schema uses 'model_id'; v1.1.0 will use 'model'.
    """
    for node in project["nodes"]:
        if node["type"] == "agent" and "model_id" in node.get("config", {}):
            node["config"]["model"] = node["config"].pop("model_id")

    project["schema_version"] = MIGRATION_TO
    return project
```

On import, the platform applies migrators in chain:

```
project.json v1.0.0
       │
       ▼  v1_0_to_v1_1.migrate()
     v1.1.0
       │
       ▼  v1_1_to_v1_2.migrate()
     v1.2.0  ← current platform version
```

The Studio surfaces a migration warning to the user before opening the canvas.

#### Compatibility policy

- The platform supports importing schemas from the **last 2 major versions**.
- Schemas older than 2 major versions receive a clear error with manual migration instructions.
- Export always uses the most recent schema version of the installed platform.

---

## 15. Deploy Flow

### 15.1 Prerequisites

| Tool | Minimum version |
|---|---|
| AWS CLI | 2.x |
| Terraform | 1.9+ |
| uv | 0.4+ |
| Docker | 24+ |
| Python | 3.12+ |

### 15.2 End-to-end deploy flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. Design & Export (Studio)                                        │
│     User designs agent → clicks "Generate & Export"                │
│     → Downloads agent-{name}-{timestamp}.zip                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  2. Unzip & Configure                                               │
│     unzip agent-{name}-{timestamp}.zip                             │
│     cp .env.example .env                                           │
│     # Fill in: AWS_REGION, LANGSMITH_API_KEY, etc.                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  3. Local Validation (optional but recommended)                     │
│     uv sync                                                         │
│     uv run pytest tests/ -v          # run unit tests              │
│     uv run python local/run_agent.py --input '...' --mock-tools    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  4. Build & Push Docker Image                                       │
│     docker build -t {agent-name}:latest .                          │
│     aws ecr create-repository --repository-name {agent-name}       │
│     docker tag {agent-name}:latest {ecr-uri}/{agent-name}:latest   │
│     docker push {ecr-uri}/{agent-name}:latest                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  5. Terraform Init & Plan                                           │
│     cd infra/                                                       │
│     terraform init \                                               │
│       -backend-config="bucket={state-bucket}" \                    │
│       -backend-config="key={agent-name}/terraform.tfstate"         │
│     terraform workspace select dev || terraform workspace new dev   │
│     terraform plan -var-file=dev.tfvars -out=tfplan                │
│     # Review: IAM roles, Lambda functions, AgentCore config        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  6. Terraform Apply                                                 │
│     terraform apply tfplan                                          │
│                                                                     │
│     Resources created:                                              │
│     + aws_iam_role.agent_execution_role                            │
│     + aws_lambda_function.tool_{name} (one per tool)               │
│     + aws_agentcore_agent.{agent-name}                             │
│     + aws_agentcore_mcp_server.{agent-name}-mcp                   │
│     + aws_apigatewayv2_api.{agent-name}                            │
│     + aws_s3_bucket.{agent-name}-docs (if ingestion pipeline)      │
│     + aws_dynamodb_table.{agent-name}-sessions (if memory enabled) │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  7. Smoke Test                                                      │
│     # Invoke via API Gateway endpoint                               │
│     curl -X POST {api-gateway-url}/invoke \                        │
│       -H "Authorization: Bearer {token}" \                         │
│       -H "Content-Type: application/json" \                        │
│       -d '{"message": "Hello, agent!"}'                            │
│                                                                     │
│     # Verify trace in CloudWatch GenAI Observability                │
│     # Verify logs in CloudWatch: /aws/bedrock-agentcore/{agent-name}│
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  8. Promote to Production (optional)                                │
│     terraform workspace select prod                                 │
│     terraform plan -var-file=prod.tfvars -out=tfplan-prod          │
│     terraform apply tfplan-prod                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 15.3 Terraform variable files

The generated `infra/` directory includes variable files per environment:

```hcl
# infra/dev.tfvars (generated)
agent_name                   = "my-agent"
environment                  = "dev"
aws_region                   = "us-east-1"
ecr_image_uri                = "{ecr-uri}/my-agent:latest"
lambda_memory_mb             = 256
lambda_timeout_seconds       = 30
agentcore_model_id           = "anthropic.claude-3-5-sonnet-20241022-v2:0"
agentcore_inference_profile_arn = ""  # Set to cross-region profile ARN if model unavailable in deployment region
enable_memory                = true
memory_ttl_seconds           = 3600
latency_alarm_threshold_ms   = 5000
cloudwatch_log_retention_days = 30
```

### 15.4 IAM roles generated per agent

```
{agent-name}-execution-role
  └── policies:
      ├── bedrock:InvokeModel (scoped to configured model ARNs)
      ├── s3:GetObject, s3:PutObject (scoped to agent bucket)
      ├── dynamodb:GetItem, PutItem, DeleteItem (scoped to session table)
      ├── athena:StartQueryExecution, GetQueryResults (if Athena tool present)
      ├── lambda:InvokeFunction (scoped to tool Lambda ARNs)
      └── secretsmanager:GetSecretValue (scoped to agent secret ARNs)

{agent-name}-tool-{name}-role (one per Lambda tool)
  └── policies:
      └── (minimal permissions specific to that tool's resources)
```

### 15.5 Remote state configuration

```hcl
# infra/main.tf (generated)
terraform {
  required_version = ">= 1.9"

  backend "s3" {
    # Configured via -backend-config flags at init time
    # bucket = "{state-bucket}"
    # key    = "{agent-name}/terraform.tfstate"
    # region = "us-east-1"
    dynamodb_table = "{agent-name}-tf-lock"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
```

---

## 16. Security

### 16.1 IAM least-privilege

Each generated agent receives a dedicated IAM execution role with permissions scoped exclusively to the resources it actually uses, inferred from the node types present in the graph. No wildcard resource ARNs are used.

### 16.2 No credentials in generated code

- Authentication uses IAM execution roles (Lambda) and AgentCore instance profiles.
- No AWS access keys are ever hardcoded or included in the ZIP.
- The `.env.example` contains placeholder values only — never real secrets.

### 16.3 Secrets management

External API keys and other sensitive configuration are stored in **AWS Secrets Manager** and referenced in generated code as:

```python
# config.py (generated)
import boto3
import functools

# Secrets are fetched lazily on first access and cached in-process.
# This avoids Secrets Manager API calls on every Lambda cold start
# and ensures the cache persists across warm invocations within the
# same execution environment.
@functools.lru_cache(maxsize=None)
def get_secret(secret_name: str) -> str:
    client = boto3.client("secretsmanager")
    response = client.get_secret_value(SecretId=secret_name)
    return response["SecretString"]

# Usage — values are resolved on first call, not at import time:
def external_api_key() -> str:
    return get_secret("my-agent/external-api-key")
```

Call sites use `external_api_key()` accessor functions rather than a
module-level constant. The platform never embeds resolved secret values
in generated files. OAuth2 client credentials are vended by **AgentCore
Identity** (`IdentityClient.get_token`), not Secrets Manager.

### 16.4 Bedrock guardrails

Each `agent` node supports optional Bedrock Guardrails configuration:

```json
{
  "guardrails": {
    "guardrail_id": "gr-abc123",
    "guardrail_version": "1"
  }
}
```

When configured, the generated agent passes `guardrailConfig` to every Bedrock invocation, enabling content filtering, PII detection, and topic blocking.

### 16.5 Audit trail

All platform actions (project export, deploy events) and runtime AWS API calls are captured in **AWS CloudTrail**, providing a full audit log within the customer's account.

### 16.6 Data in transit and at rest

- All API calls between Studio and platform backend use HTTPS (TLS 1.2+) via API Gateway.
- S3 buckets are created with server-side encryption (SSE-S3 or SSE-KMS) enabled by default in the generated Terraform.
- DynamoDB tables use AWS-managed encryption at rest by default.

---

## 17. Technology Stack Reference

### Platform (self-hosted on AWS)

| Component | Technology |
|---|---|
| Frontend SPA | React, TypeScript, React Flow |
| Frontend hosting | CloudFront + S3 |
| Platform API | Python (FastAPI), Lambda or ECS |
| Graph/project storage | DynamoDB |
| Authentication | Amazon Cognito or ALB + OIDC |

### Generated agent

| Component | Technology |
|---|---|
| Agent framework | LangGraph |
| LLM abstractions | LangChain |
| AWS integration | boto3, bedrock-agentcore |
| Runtime host | AgentCore Runtime (container) — `BedrockAgentCoreApp` on :8080, `network_mode = "VPC"` (private, no internet egress) |
| MCP server | bedrock-agentcore (`MCPServer`), exposed via AgentCore Gateway |
| Memory | AgentCore Memory (semantic + summary + user_preference strategies) |
| Identity / OAuth2 | AgentCore Identity (`IdentityClient.get_token`) |
| Observability | AgentCore Observability → CloudWatch GenAI Observability |
| Dependency management | uv |
| Testing | pytest, moto, responses |
| Container | Docker `python:3.12-slim` running `python -m agent.runner` |

### AWS services (runtime)

| Service | Role |
|---|---|
| Amazon Bedrock AgentCore Runtime | Agent container hosting (replaces Lambda for the agent) |
| Amazon Bedrock AgentCore Memory | Semantic + episodic + user_preference memory |
| Amazon Bedrock AgentCore Gateway | REST↔MCP bridge for `mcp_server` nodes |
| Amazon Bedrock AgentCore Identity | M2M OAuth2 token vending for `tool_http` |
| Amazon Bedrock AgentCore Tools | Code Interpreter + Browser sandboxes |
| AWS Lambda | Per-tool execution + API GW invoker bridge to AgentCore Runtime |
| Amazon VPC | Private network for the agent runtime + Lambdas — no internet gateway, no NAT |
| AWS PrivateLink (VPC endpoints) | Reach AWS APIs (Bedrock, ECR, Secrets Manager, CloudWatch Logs, STS, S3, DynamoDB) without internet egress |
| Amazon Bedrock | LLMs and embeddings |
| Amazon S3 | Document storage |
| Amazon S3 Vectors | Vector store |
| Amazon Athena | SQL over data lake |
| Amazon API Gateway | REST / WebSocket endpoint |
| Amazon DynamoDB | Session state, cache |
| AWS Secrets Manager | Sensitive configuration |
| Amazon CloudWatch | Logs, metrics, alarms |
| AWS CloudTrail | Audit trail |
| Amazon ECR | Container image registry |

---

## 18. Open Decisions & Future Work

### Resolved

| Decision | Resolution |
|---|---|
| Multi-workspace / RBAC | Out of scope |
| Authentication | Cognito or corporate SSO, developer's choice |
| Generated artifact destination | ZIP download, no license restrictions |
| MCP Server execution | AgentCore Runtime via AgentCore Gateway target |
| Observability stack | AgentCore Observability → CloudWatch GenAI (LangSmith dropped) |
| Agent runtime host | AgentCore Runtime container (no Lambda for the agent) |
| Network isolation | All agents run in a private VPC; AgentCore Runtime uses `network_mode = "VPC"`, never `PUBLIC`. No internet gateway, no NAT — AWS APIs via PrivateLink endpoints. Engine generates the VPC (`infra/vpc.tf`) by default; `create_vpc = false` + `existing_*` variables inject a customer VPC. Egress is default-deny; `egress_allowlist_cidrs` permits HTTPS 443 to specific CIDRs. Tools needing the public internet (`tool_http` to external APIs, `browser_tool`, OAuth2 `token_url`) do not work in the generated VPC — require an override VPC with an egress path. |
| OAuth2 token vending | AgentCore Identity (`bedrock_agentcore.identity.IdentityClient`) |
| Test generation strategy | Unit tests only (pytest + mocks) |
| Local simulation | Python scripts + Docker |
| Project import/export | Supported via `project.json` in ZIP |
| Schema versioning | Semantic versioning with declarative migrators |
| Code licensing | Customer's property, no restrictions |

### Open / Future work

| Topic | Notes |
|---|---|
| **Additional LLM providers** | OpenAI, Google Vertex AI, Ollama. Architecture supports it via LangChain provider swap. |
| **CI/CD scaffold for generated ZIPs** | Optional GitHub Actions / GitLab CI pipeline generation alongside the ZIP. |
| **Agent evals** | AgentCore Observability + custom CloudWatch metrics for run comparisons; integration with managed eval frameworks under evaluation. |
| **Platform upgrade path** | How the platform itself (Studio + Engine) is upgraded without losing saved graphs. |
| **Custom node SDK** | Public API for developing and registering custom node types beyond the built-in catalog. |
| **Node versioning** | Individual node type versioning to handle deprecations without breaking existing graphs. |
| **Streaming UI** | Real-time token streaming from the agent to the Studio preview panel. |
| **Cost estimation** | Pre-deploy Terraform cost estimation (Infracost integration). |
| **ElastiCache cache backend** | Redis via ElastiCache as an alternative to DynamoDB for the `cache` node. Lower latency for high-frequency caching. Requires VPC configuration for Lambda. Deferred from v1 due to added infrastructure complexity. |
| **Long-running workflow strategy** | AgentCore Runtime sessions are 8 hours, so the agent path no longer hits Lambda's 15-min limit. Per-tool Lambdas still bound by 15 min — Step Functions scaffold remains planned for tool nodes that may exceed it. |
| **AgentCore feature flag** | Customer's AWS account must have the Bedrock AgentCore feature enabled before `terraform apply`. No automated enablement check yet. |
| **S3 Vectors index Terraform** | No `aws` provider resource for S3 Vectors index creation as of 2026-05-06; tracked at terraform-provider-aws #43438. Customers create the index manually or via a `null_resource` shim. |

---

*End of specification.*
