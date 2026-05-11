import type { AwsCredsBody } from './engine';

const RAW_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
const API_BASE = RAW_BASE.replace(/\/+$/, '');

export type SuiteName = 'injection' | 'bias' | 'hallucination' | 'toxicity' | 'tool-abuse';

export interface ProbeRow {
  id?: string;
  prompt?: string;
  prompt_a?: string;
  prompt_b?: string;
  response?: string;
  response_a?: string;
  response_b?: string;
  category?: string;
  lang?: string;
  axis?: string;
  is_refusal?: boolean;
  is_leak?: boolean;
  echoed_dangerous?: boolean;
  divergent?: boolean;
  token_overlap?: number;
  toxicity_score?: number;
  matches?: Record<string, number>;
  ground_truth?: string;
  expected?: string;
  passed: boolean;
}

export interface ProbeResult {
  rows: ProbeRow[];
  total: number;
  pass_rate: number;
  refusal_count?: number;
  leak_count?: number;
  divergent_count?: number;
  avg_overlap?: number;
  correct_count?: number;
  refused_traps?: number;
}

export interface ConversationLog {
  id: number;
  session_id: string;
  created_at: string;
  input_text: string;
  response_text: string;
  latency_ms: number | null;
}

export interface ComplianceItem {
  id: string;
  title: string;
  passed: boolean;
  detail?: string;
}

export interface ComplianceResult {
  agent_runtime_arn: string;
  items: ComplianceItem[];
  score: number;
  total: number;
  compliant: boolean;
}

function credsToBody(creds: AwsCredsBody): Record<string, unknown> {
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

const PROBE_PATH: Record<SuiteName, string> = {
  injection: '/agents/security/probes/injection',
  bias: '/agents/security/probes/bias',
  hallucination: '/agents/security/probes/hallucination',
  toxicity: '/agents/security/probes/toxicity',
  'tool-abuse': '/agents/security/probes/tool-abuse',
};

export function runProbeSuite(suite: SuiteName, arn: string, creds: AwsCredsBody, token: string): Promise<ProbeResult> {
  return postJson<ProbeResult>(PROBE_PATH[suite], { ...credsToBody(creds), agent_runtime_arn: arn }, token);
}

export function runCustomProbes(prompts: string[], arn: string, creds: AwsCredsBody, token: string): Promise<ProbeResult> {
  return postJson<ProbeResult>('/agents/security/probes/upload-csv', {
    ...credsToBody(creds),
    agent_runtime_arn: arn,
    suite: 'custom',
    prompts,
  }, token);
}

export function listConversations(arn: string, creds: AwsCredsBody, token: string, limit = 20): Promise<{ conversations: ConversationLog[] }> {
  return postJson<{ conversations: ConversationLog[] }>('/agents/runtimes/conversations', {
    ...credsToBody(creds),
    agent_runtime_arn: arn,
    limit,
  }, token);
}

export function checkCompliance(arn: string, project: unknown, creds: AwsCredsBody, token: string): Promise<ComplianceResult> {
  return postJson<ComplianceResult>('/agents/security/compliance/check', {
    ...credsToBody(creds),
    agent_runtime_arn: arn,
    project,
  }, token);
}

export function saveBaseline(arn: string, suite: string, passRate: number | null, results: unknown, token: string): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>('/agents/security/baselines/save', {
    agent_runtime_arn: arn,
    suite,
    pass_rate: passRate,
    results,
  }, token);
}

export async function getBaseline(arn: string, suite: string, token: string): Promise<{ pass_rate: number | null; results: unknown; saved_at: string } | null> {
  const url = `${API_BASE}/agents/security/baselines/${encodeURIComponent(arn)}/${suite}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
