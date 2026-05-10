import { useEffect, useState, useCallback, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listAgentRuntimes,
  getAgentStatus,
  queryTraces,
  type AgentRuntimeSummary,
  type AgentStatusResult,
  type TraceSpan,
  type AwsCredsBody,
} from '../../api/engine';
import { useAuthStore } from '../../store/authStore';
import { useAwsCredsStore } from '../../store/awsCredentialsStore';
import { showToast } from '../../components/shared/Toast';

const STATUS_STYLE: Record<string, { cls: string; dot: string }> = {
  CREATING: { cls: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  ACTIVE:   { cls: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-500' },
  READY:    { cls: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-500' },
  UPDATING: { cls: 'bg-yellow-50 text-yellow-700 border-yellow-200', dot: 'bg-yellow-500' },
  DELETING: { cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-400' },
  FAILED:   { cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-600' },
  UNKNOWN:  { cls: 'bg-gray-50 text-gray-600 border-gray-200', dot: 'bg-gray-400' },
};

function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.UNKNOWN;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${s.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-gray-400 hover:text-gray-700 text-xs"
      title="Copy"
    >
      {copied ? '✓' : '⎘'}
    </button>
  );
}

export function AgentsCatalogPage() {
  const { token } = useAuthStore();
  const navigate = useNavigate();
  const creds = useAwsCredsStore();

  const [agents, setAgents] = useState<AgentRuntimeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCredsForm, setShowCredsForm] = useState(false);
  const [credsProbed, setCredsProbed] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusByAgent, setStatusByAgent] = useState<Record<string, AgentStatusResult>>({});
  const [tracesByAgent, setTracesByAgent] = useState<Record<string, TraceSpan[]>>({});
  const [drawerLoading, setDrawerLoading] = useState<string | null>(null);

  const credsBody = useCallback((): AwsCredsBody => ({
    aws_region: creds.region,
    aws_access_key_id: creds.accessKeyId,
    aws_secret_access_key: creds.secretAccessKey,
    aws_session_token: creds.sessionToken,
  }), [creds.region, creds.accessKeyId, creds.secretAccessKey, creds.sessionToken]);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listAgentRuntimes(credsBody(), token!);
      setAgents(res.agents);
      creds.setUsingIamRole(res.using_iam_role);
      setShowCredsForm(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (!creds.accessKeyId) setShowCredsForm(true);
    } finally {
      setLoading(false);
      setCredsProbed(true);
    }
  }, [credsBody, token, creds]);

  useEffect(() => {
    if (!credsProbed) fetchAgents();
  }, [credsProbed, fetchAgents]);

  const handleExpand = async (a: AgentRuntimeSummary) => {
    if (expandedId === a.agent_runtime_id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(a.agent_runtime_id);
    if (statusByAgent[a.agent_runtime_id]) return;

    setDrawerLoading(a.agent_runtime_id);
    try {
      const [status, traces] = await Promise.all([
        getAgentStatus(a.agent_runtime_id, credsBody(), token!).catch(() => null),
        queryTraces({
          ...credsBody(),
          aws_region: creds.region,
          agent_name: a.name,
          minutes: 60,
        }, token!).catch(() => null),
      ]);
      if (status) setStatusByAgent(s => ({ ...s, [a.agent_runtime_id]: status }));
      if (traces) setTracesByAgent(s => ({ ...s, [a.agent_runtime_id]: traces.spans }));
    } finally {
      setDrawerLoading(null);
    }
  };

  const handleTestInEval = (a: AgentRuntimeSummary) => {
    navigate(`/eval?agent=${encodeURIComponent(a.agent_runtime_arn)}&name=${encodeURIComponent(a.name)}`);
  };

  const handleSaveCreds = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const accessKey = String(fd.get('access_key_id') || '').trim();
    const secret = String(fd.get('secret_access_key') || '').trim();
    const sessionToken = String(fd.get('session_token') || '').trim();
    const region = String(fd.get('region') || 'us-east-1').trim();
    creds.setRegion(region);
    creds.setKeys(accessKey || null, secret || null, sessionToken || null);
    setCredsProbed(false);
    showToast('Credenciais atualizadas');
  };

  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-brand placeholder-gray-400 font-mono';

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">Catálogo de Agentes</h1>
          <p className="text-sm text-gray-400 mt-1">Agentes implantados em AgentCore Runtime na conta AWS</p>
        </div>
        <div className="flex items-center gap-2">
          {creds.usingIamRole ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-green-700 bg-green-50 border border-green-200">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Usando IAM role
            </span>
          ) : creds.accessKeyId ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              Credenciais manuais
            </span>
          ) : null}
          <button
            onClick={() => setShowCredsForm(v => !v)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 border border-gray-200 hover:border-gray-300 hover:text-gray-900 transition-colors"
          >
            {showCredsForm ? 'Fechar' : 'Configurar AWS'}
          </button>
          <button
            onClick={fetchAgents}
            disabled={loading}
            className="btn-primary text-xs"
          >
            {loading ? 'Carregando...' : '↻ Atualizar'}
          </button>
        </div>
      </div>

      {showCredsForm && (
        <div className="card p-5 mb-5">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Credenciais AWS</h2>
          <p className="text-xs text-gray-400 mb-4">
            Deixe vazio para usar IAM role (engine rodando dentro da conta AWS). Credenciais ficam apenas em sessionStorage do navegador.
          </p>
          <form onSubmit={handleSaveCreds} className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Region</label>
              <input name="region" defaultValue={creds.region} className={inputCls} placeholder="us-east-1" />
            </div>
            <div></div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Access Key ID</label>
              <input name="access_key_id" type="password" defaultValue={creds.accessKeyId ?? ''} className={inputCls} placeholder="AKIA..." />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Secret Access Key</label>
              <input name="secret_access_key" type="password" defaultValue={creds.secretAccessKey ?? ''} className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Session Token (opcional)</label>
              <input name="session_token" type="password" defaultValue={creds.sessionToken ?? ''} className={inputCls} />
            </div>
            <div className="col-span-2 flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { creds.clear(); setCredsProbed(false); }}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-600 hover:bg-gray-100">
                Limpar (usar IAM role)
              </button>
              <button type="submit" className="btn-primary text-xs">Salvar</button>
            </div>
          </form>
        </div>
      )}

      {error && (
        <div className="card p-4 mb-5 border border-red-200 bg-red-50">
          <p className="text-sm text-red-700 font-mono">{error}</p>
          {!creds.accessKeyId && (
            <p className="text-xs text-red-500 mt-2">Engine não conseguiu credenciais via IAM role. Configure manualmente acima.</p>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        {agents.length === 0 && !loading ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-sm">Nenhum agente encontrado.</p>
            <p className="text-xs mt-1">Faça deploy via Studio → Generate ZIP → terraform apply.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Runtime ID</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Atualizado</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {agents.map(a => (
                <Fragment key={a.agent_runtime_id}>
                  <tr
                    onClick={() => handleExpand(a)}
                    className="hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{a.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="truncate max-w-[180px]">{a.agent_runtime_id}</span>
                        <CopyBtn text={a.agent_runtime_id} />
                      </span>
                    </td>
                    <td className="px-4 py-3"><StatusChip status={a.status} /></td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-500">{a.last_updated_at ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleTestInEval(a); }}
                        className="text-xs text-brand hover:underline font-semibold"
                      >
                        Testar no Eval →
                      </button>
                    </td>
                  </tr>
                  {expandedId === a.agent_runtime_id && (
                    <tr className="bg-gray-50/50">
                      <td colSpan={5} className="px-6 py-5">
                        {drawerLoading === a.agent_runtime_id ? (
                          <p className="text-xs text-gray-400">Carregando detalhes...</p>
                        ) : (
                          <div className="grid grid-cols-2 gap-6">
                            <div>
                              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Status detalhado</h3>
                              {statusByAgent[a.agent_runtime_id] ? (
                                <div className="space-y-2">
                                  {a.endpoint && (
                                    <div>
                                      <p className="text-xs text-gray-400">Endpoint</p>
                                      <p className="text-xs font-mono text-gray-700 break-all">{a.endpoint}</p>
                                    </div>
                                  )}
                                  <div>
                                    <p className="text-xs text-gray-400">ARN</p>
                                    <p className="text-xs font-mono text-gray-700 break-all">{a.agent_runtime_arn}</p>
                                  </div>
                                  <details className="text-xs mt-2">
                                    <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Resposta API bruta</summary>
                                    <pre className="mt-2 bg-white border border-gray-200 rounded p-2 overflow-x-auto text-[10px]">
                                      {JSON.stringify(statusByAgent[a.agent_runtime_id].raw, null, 2)}
                                    </pre>
                                  </details>
                                </div>
                              ) : (
                                <p className="text-xs text-gray-400 italic">Status não disponível.</p>
                              )}
                            </div>
                            <div>
                              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                                Traces recentes (60min)
                              </h3>
                              {tracesByAgent[a.agent_runtime_id]?.length ? (
                                <ul className="space-y-1 max-h-48 overflow-y-auto">
                                  {tracesByAgent[a.agent_runtime_id].slice(0, 20).map((s, i) => (
                                    <li key={i} className="text-[11px] font-mono bg-white border border-gray-200 rounded px-2 py-1">
                                      <span className="text-gray-400">{s.timestamp}</span>{' '}
                                      <span className="text-purple-600">{s.span_type}</span>
                                      {s.duration_ms != null && <span className="text-gray-500"> · {s.duration_ms}ms</span>}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="text-xs text-gray-400 italic">Nenhum trace nos últimos 60min.</p>
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
