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
}

export interface EvalResult {
  rows: RowMetrics[];
  aggregate: Record<string, number>;
}

export async function runEval(rows: EvalRow[], token: string): Promise<EvalResult> {
  const res = await fetch(`${API_BASE}/agents/eval/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as { detail?: { message?: string } }).detail?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.json() as Promise<EvalResult>;
}
