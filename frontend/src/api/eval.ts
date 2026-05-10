const RAW_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
const API_BASE = RAW_BASE.replace(/\/+$/, '');

export interface EvalRow {
  question: string;
  contexts: string[];
  answer: string;
  ground_truth: string;
}

export interface RowMetrics {
  question: string;
  answer: string;
  ground_truth: string;
  exact_match: number;
  token_f1: number;
  context_relevance: number;
  answer_faithfulness: number;
  latency_ms?: number | null;
  agent_response?: string | null;
}

export interface EvalResult {
  rows: RowMetrics[];
  aggregate: Record<string, number>;
}

export interface RunEvalOptions {
  agentRuntimeArn?: string;
  awsRegion?: string;
  awsAccessKeyId?: string | null;
  awsSecretAccessKey?: string | null;
  awsSessionToken?: string | null;
}

export async function runEval(rows: EvalRow[], token: string, opts: RunEvalOptions = {}): Promise<EvalResult> {
  const body: Record<string, unknown> = { rows };
  if (opts.agentRuntimeArn) {
    body.agent_runtime_arn = opts.agentRuntimeArn;
    body.aws_region = opts.awsRegion ?? 'us-east-1';
    if (opts.awsAccessKeyId) {
      body.aws_access_key_id = opts.awsAccessKeyId;
      body.aws_secret_access_key = opts.awsSecretAccessKey;
      if (opts.awsSessionToken) body.aws_session_token = opts.awsSessionToken;
    }
  }
  const res = await fetch(`${API_BASE}/agents/eval/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    const msg = (detail as { detail?: { message?: string } }).detail?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json() as Promise<EvalResult>;
}
