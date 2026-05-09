# Feature Suggestions

## Evaluation

### Ragas Evaluation Page (`/eval`)
New route. User picks a deployed agent endpoint, pastes question/context/ground-truth rows (or uploads CSV), clicks Run. Backend calls Ragas metrics (`faithfulness`, `answer_relevancy`, `context_precision`, `context_recall`) against the agent. Shows table + radar chart. Needs `ragas` dep in engine, new `POST /eval/run` endpoint, new frontend page. Natural fit since the platform already generates RAG agents.

### Batch Test Runner
Run the generated `tests/` suite against a real AWS environment (not just moto mocks). Engine endpoint `POST /run-tests` spins up a subprocess, captures pytest output, streams back. Studio shows pass/fail per test with stdout.

---

## Studio / Canvas

### Agent Template Library
Starter graphs (RAG chatbot, HITL approval flow, multi-agent pipeline, S3 data extractor). Shown as a gallery on `/agents` before a canvas is open. One click pre-populates the canvas via `project.json` rehydration (already works).

### Inline Prompt Tester
Side panel in the Studio. Select an `agent` node, enter a sample input, hit "Run". Calls a new `POST /preview` endpoint that compiles just that node (no ZIP, no Terraform) and invokes it against Bedrock. Returns response + token count + latency. No deploy needed.

### Cost Estimator Panel
Based on canvas config (model IDs, estimated invocations/month, memory strategies, tool count) shows estimated monthly AWS cost breakdown (Bedrock tokens, Lambda invocations, DynamoDB reads, AgentCore Runtime hours). Static calc, no API call needed.

---

## Observability / Ops

### Live Trace Viewer (`/traces`)
User enters deployed `AWS_REGION` + `AGENT_NAME`, platform calls CloudWatch Logs Insights (`filter @message like "genai.span"`) and shows spans in a waterfall timeline. Read-only, minimal IAM footprint.

### Deployment Status Dashboard (`/deployments`)
User enters Terraform outputs (runtime endpoint URL, ECR image URI). Platform polls `bedrock-agentcore:GetAgentRuntime` status and shows health, last invocation time, active sessions.

---

## Data Contract Bridge

### Contract → Agent Auto-Generator
From a contract detail page, add "Generate Agent" button. Pre-fills a Studio canvas with an agent graph wired to the contract's data sources (S3 paths, Athena tables, schema columns already in the contract model). Bridges the two halves of the platform.

---

## DevOps

### CI/CD Pipeline Generator
Phase 8 of the code generation pipeline. Adds `.github/workflows/deploy.yml` or `.gitlab-ci.yml` to the ZIP with steps: `docker build` → `docker push ECR` → `terraform apply`. Wired to the same IAC variables already in the ZIP. Zero new frontend work; just another generator phase.

---

## Priority Notes

**Highest ROI:** Ragas eval page + template library.
- Ragas closes the "did the agent actually work?" loop.
- Templates lower barrier to first use — users see a working graph before building their own.
