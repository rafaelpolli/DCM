import type { Project, ValidationResult } from '../types/graph';

/**
 * Engine base URL.
 *
 * Local dev: defaults to '/api', proxied to http://localhost:8000 by vite.config.ts.
 * Production: set VITE_API_BASE=https://your-engine-host.example.com at build time.
 * Trailing slash is stripped so callers can always use `${API_BASE}/path`.
 */
const RAW_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
const API_BASE = RAW_BASE.replace(/\/+$/, '');

export interface HealthResult {
  ok: boolean;
  timestamp?: string;
  error?: string;
  mockMode?: boolean;
}

export async function checkEngineHealth(signal?: AbortSignal): Promise<HealthResult> {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { status?: string; timestamp?: string; mock_mode?: boolean };
    return { ok: body.status === 'ok', timestamp: body.timestamp, mockMode: body.mock_mode === true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function validateGraph(project: Project, token: string): Promise<ValidationResult> {
  const res = await fetch(`${API_BASE}/agents/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(project),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ValidationResult>;
}

export async function generateZip(project: Project, token: string): Promise<void> {
  const res = await fetch(`${API_BASE}/agents/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(project),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { detail?: { message?: string } }).detail?.message ?? 'Generation failed';
    throw new Error(msg);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const cd = res.headers.get('Content-Disposition') ?? '';
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : 'agent.zip';

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Preview (Inline Prompt Tester) ───────────────────────────────────────────

export interface PreviewRequest {
  model_id: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  input_text: string;
  aws_region: string;
  guardrail_id?: string;
  guardrail_version?: string;
}

export interface PreviewResult {
  response: string;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
}

export async function previewNode(req: PreviewRequest, token: string): Promise<PreviewResult> {
  const res = await fetch(`${API_BASE}/agents/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { detail?: { message?: string } }).detail?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json() as Promise<PreviewResult>;
}

// ── Agent runtimes (catalog) ─────────────────────────────────────────────────

export interface AwsCredsBody {
  aws_region?: string;
  aws_access_key_id?: string | null;
  aws_secret_access_key?: string | null;
  aws_session_token?: string | null;
}

export interface AgentRuntimeSummary {
  agent_runtime_id: string;
  agent_runtime_arn: string;
  name: string;
  status: string;
  endpoint?: string | null;
  created_at?: string | null;
  last_updated_at?: string | null;
}

export interface ListAgentsResult {
  agents: AgentRuntimeSummary[];
  using_iam_role: boolean;
}

export interface AgentStatusResult {
  agent_runtime_id: string;
  status: string;
  endpoint?: string | null;
  created_at?: string | null;
  last_updated_at?: string | null;
  raw: Record<string, string>;
}

export interface InvokeAgentResult {
  response_text: string;
  latency_ms: number;
  session_id: string;
  raw: Record<string, string>;
}

function cleanCredsBody(creds: AwsCredsBody): Record<string, unknown> {
  const out: Record<string, unknown> = { aws_region: creds.aws_region ?? 'us-east-1' };
  if (creds.aws_access_key_id) {
    out.aws_access_key_id = creds.aws_access_key_id;
    out.aws_secret_access_key = creds.aws_secret_access_key;
    if (creds.aws_session_token) out.aws_session_token = creds.aws_session_token;
  }
  return out;
}

async function postJson<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const msg = (detail as { detail?: { message?: string } | string }).detail;
    const text = typeof msg === 'string' ? msg : msg?.message ?? `HTTP ${res.status}`;
    throw new Error(text);
  }
  return res.json() as Promise<T>;
}

export function listAgentRuntimes(creds: AwsCredsBody, token: string): Promise<ListAgentsResult> {
  return postJson<ListAgentsResult>('/agents/runtimes/list', cleanCredsBody(creds), token);
}

export function getAgentStatus(agent_runtime_id: string, creds: AwsCredsBody, token: string): Promise<AgentStatusResult> {
  return postJson<AgentStatusResult>('/agents/runtimes/status', { ...cleanCredsBody(creds), agent_runtime_id }, token);
}

export interface AgentUsageRow {
  agent_runtime_id: string;
  name: string;
  status: string;
  invocations: number;
  avg_latency_ms: number | null;
  tokens_window: number;
  estimated_cost_usd: number;
  anomaly: boolean;
  anomaly_reasons: string[];
}

export interface UsageStats {
  total_agents: number;
  by_status: Record<string, number>;
  total_invocations_window: number;
  avg_latency_ms: number | null;
  window_minutes: number;
  alerts_count?: number;
  per_agent?: AgentUsageRow[];
}

export function getAgentsUsage(creds: AwsCredsBody, token: string, minutes = 1440): Promise<UsageStats> {
  return postJson<UsageStats>('/agents/runtimes/usage', { ...cleanCredsBody(creds), minutes }, token);
}

export function invokeAgentRuntime(
  agent_runtime_arn: string,
  input_text: string,
  creds: AwsCredsBody,
  token: string,
  opts: { session_id?: string; qualifier?: string } = {},
): Promise<InvokeAgentResult> {
  return postJson<InvokeAgentResult>('/agents/runtimes/invoke', {
    ...cleanCredsBody(creds),
    agent_runtime_arn,
    input_text,
    session_id: opts.session_id,
    qualifier: opts.qualifier ?? 'DEFAULT',
  }, token);
}

// ── Test plan ────────────────────────────────────────────────────────────────

export interface TestPlanResult {
  files: Record<string, string>;
  tool_count: number;
}

export async function getTestPlan(project: Project, token: string): Promise<TestPlanResult> {
  const res = await fetch(`${API_BASE}/agents/test-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(project),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { detail?: { message?: string } }).detail?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json() as Promise<TestPlanResult>;
}

// ── Traces ───────────────────────────────────────────────────────────────────

export interface TracesRequest {
  aws_access_key_id?: string | null;
  aws_secret_access_key?: string | null;
  aws_session_token?: string | null;
  aws_region: string;
  agent_name: string;
  minutes: number;
}

export interface TraceSpan {
  timestamp: string;
  span_type: string;
  message: string;
  duration_ms: number | null;
}

export interface TracesResult {
  spans: TraceSpan[];
  log_group: string;
  query_window_minutes: number;
}

export async function queryTraces(req: TracesRequest, token: string): Promise<TracesResult> {
  const res = await fetch(`${API_BASE}/agents/traces/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { detail?: { message?: string } }).detail?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json() as Promise<TracesResult>;
}

