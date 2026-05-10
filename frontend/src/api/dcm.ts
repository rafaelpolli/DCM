import type {
  Contract,
  ChangeRequest,
  ContractCreateBody,
  ContractListResponse,
  RequestListResponse,
  DashboardData,
  ExportResponse,
} from '../types/dcm';

const RAW_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
const API_BASE = RAW_BASE.replace(/\/+$/, '');

function headers(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

// ── Dashboard ───────────────────────────────────────────────────

export async function fetchDashboard(token: string): Promise<DashboardData> {
  const res = await fetch(`${API_BASE}/dcm/dashboard`, { headers: headers(token) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Contracts ───────────────────────────────────────────────────

export async function fetchContracts(
  token: string,
  params?: { status?: string; layer?: string; q?: string }
): Promise<ContractListResponse> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set('status', params.status);
  if (params?.layer) sp.set('layer', params.layer);
  if (params?.q) sp.set('q', params.q);
  const qs = sp.toString();
  const url = `${API_BASE}/dcm/contracts${qs ? '?' + qs : ''}`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchContract(token: string, cid: string): Promise<{ contract: Contract; related_requests: ChangeRequest[]; paired_contract?: Contract }> {
  const res = await fetch(`${API_BASE}/dcm/contracts/${cid}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function createContract(token: string, body: ContractCreateBody): Promise<{ ok: boolean; id: string }> {
  const res = await fetch(`${API_BASE}/dcm/contracts`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function exportContract(
  token: string,
  cid: string,
  format: 'json' | 'yaml' | 'ddl'
): Promise<ExportResponse> {
  const res = await fetch(`${API_BASE}/dcm/contracts/${cid}/export?format=${format}`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Change Requests ─────────────────────────────────────────────

export async function fetchRequests(
  token: string,
  params?: { status?: string }
): Promise<RequestListResponse> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set('status', params.status);
  const qs = sp.toString();
  const url = `${API_BASE}/dcm/requests${qs ? '?' + qs : ''}`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchRequest(token: string, rid: string): Promise<{ request: ChangeRequest; contract: Contract | null }> {
  const res = await fetch(`${API_BASE}/dcm/requests/${rid}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function approveRequest(token: string, rid: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/dcm/requests/${rid}/approve`, {
    method: 'POST',
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function rejectRequest(token: string, rid: string, text: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/dcm/requests/${rid}/reject`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function addComment(token: string, rid: string, text: string): Promise<{ ok: boolean; comment: { author: string; date: string; text: string } }> {
  const res = await fetch(`${API_BASE}/dcm/requests/${rid}/comment`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
