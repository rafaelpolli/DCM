import { useEffect, useState, useCallback, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listAgentRuntimes,
  getAgentStatus,
  getAgentsUsage,
  queryTraces,
  type AgentRuntimeSummary,
  type AgentStatusResult,
  type AgentUsageRow,
  type TraceSpan,
  type AwsCredsBody,
} from '../../api/engine';
import {
  listConversations,
  runProbeSuite,
  checkCompliance,
  type ConversationLog,
  type ProbeResult,
  type ComplianceResult,
} from '../../api/security';
import { useAuthStore } from '../../store/authStore';
import { useAwsCredsStore } from '../../store/awsCredentialsStore';
import { useMockModeStore } from '../../store/mockModeStore';
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
  const { mockMode } = useMockModeStore();

  const [agents, setAgents] = useState<AgentRuntimeSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCredsForm, setShowCredsForm] = useState(false);
  const [credsProbed, setCredsProbed] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusByAgent, setStatusByAgent] = useState<Record<string, AgentStatusResult>>({});
  const [tracesByAgent, setTracesByAgent] = useState<Record<string, TraceSpan[]>>({});
  const [convsByAgent, setConvsByAgent] = useState<Record<string, ConversationLog[]>>({});
  const [securityByAgent, setSecurityByAgent] = useState<Record<string, ProbeResult>>({});
  const [complianceByAgent, setComplianceByAgent] = useState<Record<string, ComplianceResult>>({});
  const [drawerLoading, setDrawerLoading] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<Record<string, 'status' | 'conversations' | 'security'>>({});
  const [usageRows, setUsageRows] = useState<AgentUsageRow[]>([]);

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
      // Fetch usage too (for anomaly + tokens + cost)
      try {
        const usage = await getAgentsUsage(credsBody(), token!, 1440);
        setUsageRows(usage.per_agent ?? []);
      } catch { /* non-fatal */ }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      if (!creds.accessKeyId) setShowCredsForm(true);
    } finally {
      setLoading(false);
      setCredsProbed(true);
    }
  }, [credsBody, token, creds]);

  const usageByAgent = (id: string) => usageRows.find(u => u.agent_runtime_id === id);

  useEffect(() => {
    if (!credsProbed) fetchAgents();
  }, [credsProbed, fetchAgents]);

  const handleExpand = async (a: AgentRuntimeSummary) => {
    if (expandedId === a.agent_runtime_id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(a.agent_runtime_id);
    if (!drawerTab[a.agent_runtime_id]) setDrawerTab(t => ({ ...t, [a.agent_runtime_id]: 'status' }));
    if (statusByAgent[a.agent_runtime_id]) return;

    setDrawerLoading(a.agent_runtime_id);
    try {
      const [status, traces, convs, compliance] = await Promise.all([
        getAgentStatus(a.agent_runtime_id, credsBody(), token!).catch(() => null),
        queryTraces({
          ...credsBody(),
          aws_region: creds.region,
          agent_name: a.name,
          minutes: 60,
        }, token!).catch(() => null),
        listConversations(a.agent_runtime_arn, credsBody(), token!, 20).catch(() => null),
        checkCompliance(a.agent_runtime_arn, null, credsBody(), token!).catch(() => null),
      ]);
      if (status) setStatusByAgent(s => ({ ...s, [a.agent_runtime_id]: status }));
      if (traces) setTracesByAgent(s => ({ ...s, [a.agent_runtime_id]: traces.spans }));
      if (convs) setConvsByAgent(s => ({ ...s, [a.agent_runtime_id]: convs.conversations }));
      if (compliance) setComplianceByAgent(s => ({ ...s, [a.agent_runtime_arn]: compliance }));
    } finally {
      setDrawerLoading(null);
    }
  };

  const runQuickInjection = async (a: AgentRuntimeSummary) => {
    setDrawerLoading(a.agent_runtime_id);
    try {
      const r = await runProbeSuite('injection', a.agent_runtime_arn, credsBody(), token!);
      setSecurityByAgent(s => ({ ...s, [a.agent_runtime_id]: r }));
      showToast(`Probes: ${Math.round(r.pass_rate * 100)}% aprovação`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
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
          {mockMode ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Modo demo (mock)
            </span>
          ) : creds.usingIamRole ? (
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
          {!mockMode && (
            <button
              onClick={() => setShowCredsForm(v => !v)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 border border-gray-200 hover:border-gray-300 hover:text-gray-900 transition-colors"
            >
              {showCredsForm ? 'Fechar' : 'Configurar AWS'}
            </button>
          )}
          <button
            onClick={fetchAgents}
            disabled={loading}
            className="btn-primary text-xs"
          >
            {loading ? 'Carregando...' : '↻ Atualizar'}
          </button>
        </div>
      </div>

      {showCredsForm && !mockMode && (
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
                <th className="px-4 py-3">Tokens 24h</th>
                <th className="px-4 py-3">$ 24h</th>
                <th className="px-4 py-3">Compliance</th>
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
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusChip status={a.status} />
                        {usageByAgent(a.agent_runtime_id)?.anomaly && (
                          <span
                            title={(usageByAgent(a.agent_runtime_id)?.anomaly_reasons ?? []).join('; ')}
                            className="w-2 h-2 rounded-full bg-red-500 animate-pulse"
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-600">
                      {usageByAgent(a.agent_runtime_id)?.tokens_window?.toLocaleString() ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-600">
                      {usageByAgent(a.agent_runtime_id)?.estimated_cost_usd != null
                        ? `$${(usageByAgent(a.agent_runtime_id)!.estimated_cost_usd).toFixed(4)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {complianceByAgent[a.agent_runtime_arn] ? (
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                            complianceByAgent[a.agent_runtime_arn].compliant
                              ? 'bg-green-50 text-green-700 border border-green-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {complianceByAgent[a.agent_runtime_arn].score}/{complianceByAgent[a.agent_runtime_arn].total}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
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
                      <td colSpan={7} className="px-6 py-5">
                        {drawerLoading === a.agent_runtime_id ? (
                          <p className="text-xs text-gray-400">Carregando detalhes...</p>
                        ) : (
                          <>
                            <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
                              {(['status', 'conversations', 'security'] as const).map(t => (
                                <button
                                  key={t}
                                  onClick={() => setDrawerTab(prev => ({ ...prev, [a.agent_runtime_id]: t }))}
                                  className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                                    (drawerTab[a.agent_runtime_id] ?? 'status') === t
                                      ? 'text-orange-600 border-b-2 border-orange-500'
                                      : 'text-gray-500 hover:text-gray-800'
                                  }`}
                                >
                                  {t === 'status' ? 'Status + Traces' : t === 'conversations' ? 'Conversas' : 'Segurança'}
                                </button>
                              ))}
                            </div>

                            {(drawerTab[a.agent_runtime_id] ?? 'status') === 'status' && (
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
                                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Traces recentes (60min)</h3>
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

                            {(drawerTab[a.agent_runtime_id] ?? 'status') === 'conversations' && (
                              <div>
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Conversas recentes</h3>
                                {convsByAgent[a.agent_runtime_id]?.length ? (
                                  <div className="space-y-2 max-h-96 overflow-y-auto">
                                    {convsByAgent[a.agent_runtime_id].map(c => (
                                      <div key={c.id} className="bg-white border border-gray-200 rounded p-2 text-xs">
                                        <div className="flex justify-between text-gray-400 font-mono mb-1">
                                          <span>{c.created_at}</span>
                                          <span>{c.latency_ms != null ? `${c.latency_ms}ms` : '—'}</span>
                                        </div>
                                        <p className="text-gray-700"><span className="font-semibold">User:</span> {c.input_text}</p>
                                        <p className="text-gray-600 mt-1"><span className="font-semibold">Agent:</span> {c.response_text}</p>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-gray-400 italic">Sem conversas registradas.</p>
                                )}
                              </div>
                            )}

                            {(drawerTab[a.agent_runtime_id] ?? 'status') === 'security' && (
                              <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Quick injection probe</h3>
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => navigate(`/security?agent=${encodeURIComponent(a.agent_runtime_arn)}`)}
                                      className="text-xs text-orange-600 hover:underline font-semibold"
                                    >
                                      Abrir Segurança →
                                    </button>
                                    <button
                                      onClick={() => runQuickInjection(a)}
                                      className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded-md font-semibold"
                                    >
                                      ▶ Rodar
                                    </button>
                                  </div>
                                </div>
                                {securityByAgent[a.agent_runtime_id] && (
                                  <div className="bg-white border border-gray-200 rounded p-3">
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="text-sm font-semibold text-gray-700">
                                        Pass rate: {Math.round(securityByAgent[a.agent_runtime_id].pass_rate * 100)}%
                                      </span>
                                      <span className="text-xs text-gray-500">
                                        {securityByAgent[a.agent_runtime_id].total} probes ·{' '}
                                        {securityByAgent[a.agent_runtime_id].leak_count ?? 0} leaks
                                      </span>
                                    </div>
                                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${
                                          securityByAgent[a.agent_runtime_id].pass_rate >= 0.85 ? 'bg-green-500' :
                                          securityByAgent[a.agent_runtime_id].pass_rate >= 0.6 ? 'bg-yellow-500' : 'bg-red-500'
                                        }`}
                                        style={{ width: `${securityByAgent[a.agent_runtime_id].pass_rate * 100}%` }}
                                      />
                                    </div>
                                  </div>
                                )}
                                {complianceByAgent[a.agent_runtime_arn] && (
                                  <div className="bg-white border border-gray-200 rounded p-3">
                                    <p className="text-xs font-semibold text-gray-600 mb-2">
                                      Compliance: {complianceByAgent[a.agent_runtime_arn].score}/{complianceByAgent[a.agent_runtime_arn].total}
                                    </p>
                                    <ul className="space-y-1">
                                      {complianceByAgent[a.agent_runtime_arn].items.map(i => (
                                        <li key={i.id} className="text-xs flex items-center gap-2">
                                          <span className={i.passed ? 'text-green-600' : 'text-red-500'}>{i.passed ? '✓' : '✗'}</span>
                                          <span className="text-gray-700">{i.title}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}
                          </>
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
