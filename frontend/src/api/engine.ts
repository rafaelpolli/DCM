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
}

export async function checkEngineHealth(signal?: AbortSignal): Promise<HealthResult> {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { status?: string; timestamp?: string };
    return { ok: body.status === 'ok', timestamp: body.timestamp };
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

// ── Test plan ────────────────────────────────────────────────────────────────

export interface TestPlanResult {
  files: Record<string, string>;
  tool_count: number;
}

export async function getTestPlan(project: Project, token: string): Promise<TestPlanResult> {
  const res = await fetch(`${API_BASE}/test-plan`, {
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
  aws_access_key_id: string;
  aws_secret_access_key: string;
  aws_session_token?: string;
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

// ── Deployments ──────────────────────────────────────────────────────────────

export interface DeploymentStatusRequest {
  aws_access_key_id: string;
  aws_secret_access_key: string;
  aws_session_token?: string;
  aws_region: string;
  agent_runtime_id: string;
}

export interface DeploymentStatusResult {
  agent_runtime_id: string;
  status: string;
  endpoint: string | null;
  created_at: string | null;
  last_updated_at: string | null;
  raw: Record<string, string>;
}

export async function getDeploymentStatus(req: DeploymentStatusRequest, token: string): Promise<DeploymentStatusResult> {
  const res = await fetch(`${API_BASE}/agents/deployments/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { detail?: { message?: string } }).detail?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json() as Promise<DeploymentStatusResult>;
}
