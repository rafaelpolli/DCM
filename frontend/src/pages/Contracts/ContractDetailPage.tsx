import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { fetchContract } from '../../api/dcm';
import { useAuthStore } from '../../store/authStore';
import type { Contract, ChangeRequest, DQRule } from '../../types/dcm';
import { ExportModal } from './ExportModal';
import { useGraphStore } from '../../store/graphStore';
import type { AgentNode, AgentEdge } from '../../types/graph';

// ── Status badge colours ──────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, [string, string]> = {
  DRAFT:      ['#71717a', '#f4f4f5'],
  PENDING:    ['#d97706', '#fffbeb'],
  APPROVED:   ['#16a34a', '#f0fdf4'],
  REJECTED:   ['#dc2626', '#fef2f2'],
  DEPRECATED: ['#52525b', '#f4f4f5'],
};

const CLASS_COLORS: Record<string, [string, string]> = {
  INTERNAL:     ['#185FA5', '#EFF6FF'],
  CONFIDENTIAL: ['#dc2626', '#FEF2F2'],
  PUBLIC:       ['#16a34a', '#F0FDF4'],
  RESTRICTED:   ['#FF6200', '#FFF7ED'],
};

const REQ_STATUS_CLS: Record<string, string> = {
  OPEN:      'bg-blue-50 text-blue-700',
  APPROVED:  'bg-green-50 text-green-700',
  REJECTED:  'bg-red-50 text-red-700',
  IN_REVIEW: 'bg-purple-50 text-purple-700',
};

// ── Tab definitions ───────────────────────────────────────────────────────────

type TabKey = 'overview' | 'schema' | 'location' | 'partitioning' | 'data_quality' | 'history' | 'requests' | 'business_logic';

// ── Component ─────────────────────────────────────────────────────────────────

export function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, user } = useAuthStore();
  const navigate = useNavigate();

  const [contract, setContract] = useState<Contract | null>(null);
  const [related, setRelated] = useState<ChangeRequest[]>([]);
  const [pairedContract, setPairedContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [showExport, setShowExport] = useState(false);
  const [exportDropOpen, setExportDropOpen] = useState(false);

  const loadProject = useGraphStore(s => s.loadProject);
  const setProjectName = useGraphStore(s => s.setProjectName);

  useEffect(() => {
    if (!token || !id) return;
    fetchContract(token, id)
      .then(d => {
        setContract(d.contract);
        setRelated(d.related_requests);
        if (d.paired_contract) setPairedContract(d.paired_contract);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-2 h-2 rounded-full bg-brand animate-pulse" />
        <span className="ml-3 text-sm text-gray-400">Carregando contrato...</span>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="card p-8 text-center">
        <div className="text-red-500 text-sm mb-2">Erro ao carregar contrato</div>
        <div className="text-gray-400 text-xs font-mono">{error || 'Not found'}</div>
        <Link to="/contracts" className="text-brand text-sm mt-4 inline-block hover:underline">Voltar ao Catálogo</Link>
      </div>
    );
  }

  const [sc, sbg] = STATUS_COLORS[contract.status] ?? ['#71717a', '#f4f4f5'];
  const [cc, cbg] = CLASS_COLORS[contract.data_classification] ?? ['#9ca3af', '#F9FAFB'];

  const isSpec = (contract.location.layer as string) === 'SPEC';
  const dq: DQRule[] = contract.data_quality ?? [];
  const dqCritical = dq.filter(r => r.severity === 'CRITICAL').length;
  const dqAlert    = dq.filter(r => r.severity === 'ALERT').length;

  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: 'overview',      label: 'Visão Geral' },
    { key: 'schema',        label: 'Schema' },
    { key: 'location',      label: 'Localização' },
    { key: 'partitioning',  label: 'Particionamento' },
    { key: 'data_quality',  label: 'Data Quality', badge: dq.length || undefined },
    { key: 'history',       label: 'Histórico' },
    { key: 'requests',      label: 'Solicitações' },
    ...(isSpec ? [{ key: 'business_logic' as TabKey, label: 'Lógica de Negócio' }] : []),
  ];

  const handleGenerateAgent = () => {
    const agentName = contract.name.toLowerCase().replace(/\s+/g, '-') + '-agent';
    const inputNode: AgentNode = {
      id: 'input-1', type: 'input', label: 'Input',
      position: { x: 80, y: 220 },
      config: { trigger: 'http', 'http.method': 'POST', 'http.path': '/invoke', 'http.auth': 'none' },
      ports: { inputs: [], outputs: [{ id: 'payload', name: 'Payload', data_type: 'json' }] },
    };
    const s3Node: AgentNode = {
      id: 's3-1', type: 'tool_s3', label: `Read ${contract.name}`,
      position: { x: 320, y: 120 },
      config: {
        name: `read_${contract.name.toLowerCase().replace(/\s+/g, '_')}`,
        description: `Read data from ${contract.name} (${contract.location.layer} layer)`,
        operation: 'read', bucket: contract.location.bucket, key_template: contract.location.path,
      },
      ports: {
        inputs: [{ id: 'input', name: 'Input', data_type: 'any', required: true }],
        outputs: [{ id: 'output', name: 'Output', data_type: 'any' }],
      },
    };
    const agentNode: AgentNode = {
      id: 'agent-1', type: 'agent', label: `${contract.name} Agent`,
      position: { x: 560, y: 220 },
      config: {
        model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        system_prompt: `You are an expert data analyst for the "${contract.name}" dataset (${contract.domain} domain, ${contract.data_classification} classification). Use the provided data to answer questions accurately.`,
        temperature: 0.3, max_tokens: 4096, streaming: false, tools: ['s3-1'],
        memory: { enabled: false, namespace: 'default', top_k: 5, ttl_seconds: 3600 },
      },
      ports: {
        inputs: [{ id: 'message', name: 'User message', data_type: 'any', required: true }, { id: 'context', name: 'Context', data_type: 'any' }],
        outputs: [{ id: 'response', name: 'Agent response', data_type: 'string' }, { id: 'tool_calls', name: 'Tool calls log', data_type: 'json' }],
      },
    };
    const outputNode: AgentNode = {
      id: 'output-1', type: 'output', label: 'Response',
      position: { x: 800, y: 220 },
      config: { mode: 'json', status_code: 200 },
      ports: { inputs: [{ id: 'payload', name: 'Payload', data_type: 'any', required: true }], outputs: [] },
    };
    const edges: AgentEdge[] = [
      { id: 'e1', source_node_id: 'input-1', source_port_id: 'payload', target_node_id: 'agent-1', target_port_id: 'message', data_type: 'any' },
      { id: 'e2', source_node_id: 'agent-1', source_port_id: 'response', target_node_id: 'output-1', target_port_id: 'payload', data_type: 'string' },
    ];
    loadProject({ name: agentName, nodes: [inputNode, s3Node, agentNode, outputNode], edges });
    setProjectName(agentName);
    navigate('/agents');
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Link to="/contracts" className="hover:text-gray-800 transition-colors">Catálogo</Link>
        <span>/</span>
        <span className="font-mono text-gray-700">{contract.name}</span>
      </div>

      {/* Header card */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5 mb-2">
              <h1 className="text-xl font-semibold font-mono text-gray-900">{contract.name}</h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold font-mono"
                style={{ color: sc, background: sbg }}>
                {contract.status}
              </span>
              <span className="text-xs text-gray-500 font-mono">v{contract.version}</span>
              <span className="text-xs text-gray-400 font-mono">· {contract.environment}</span>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">{contract.description}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {contract.tags.map(t => (
                <span key={t} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono text-gray-500 border border-gray-200 bg-gray-50">
                  #{t}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(user?.role === 'creator' || user?.role === 'admin') && (
              <Link to="/requests"
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 border border-gray-200 hover:border-gray-300 hover:text-gray-900 transition-colors no-underline">
                Solicitar Alteração
              </Link>
            )}
            {/* Export dropdown */}
            <div className="relative">
              <button onClick={() => setExportDropOpen(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 border border-gray-200 hover:border-gray-300 hover:text-gray-900 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                </svg>
                Exportar
              </button>
              {exportDropOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setExportDropOpen(false)} />
                  <div className="absolute right-0 top-9 card shadow-lg z-20 w-28 py-1 overflow-hidden border border-gray-200">
                    {(['json','yaml','ddl'] as const).map(fmt => (
                      <button key={fmt} onClick={() => { setShowExport(true); setExportDropOpen(false); }}
                        className="block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-mono uppercase transition-colors">
                        {fmt}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button onClick={handleGenerateAgent}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-brand border border-brand hover:bg-orange-50 transition-colors">
              🤖 Gerar Agente
            </button>
          </div>
        </div>
      </div>

      {/* Paired contract banner */}
      {pairedContract && (
        <div className="card px-5 py-3 flex items-center gap-3 border-l-4" style={{ borderLeftColor: '#f59e0b' }}>
          <svg className="w-4 h-4 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
          </svg>
          <span className="text-xs text-gray-500">Contrato par</span>
          <Link to={`/contracts/${pairedContract.id}`}
            className="text-xs font-semibold font-mono text-blue-600 hover:underline">
            {pairedContract.name}
          </Link>
          <span className="text-xs text-gray-400 font-mono">{pairedContract.location.layer}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-5 -mb-px overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`tab-btn whitespace-nowrap ${activeTab === t.key ? 'active' : ''}`}
              style={{
                position: 'relative', padding: '10px 2px', fontSize: '13px', fontWeight: 500,
                color: activeTab === t.key ? '#0f0f0f' : '#9ca3af',
                border: 'none', background: 'transparent', cursor: 'pointer',
              }}
            >
              {t.label}
              {t.badge !== undefined && (
                <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold"
                  style={{ background: '#fef2f2', color: '#dc2626', fontSize: '10px' }}>
                  {t.badge}
                </span>
              )}
              {activeTab === t.key && (
                <span style={{
                  position: 'absolute', bottom: '-1px', left: 0, right: 0,
                  height: '2px', background: '#FF6200', borderRadius: '2px 2px 0 0',
                }} />
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Tab: Visão Geral ── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Metadata */}
          <div className="card p-5 space-y-3">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Metadados</h3>
            {([
              ['Domínio',          contract.domain],
              ['Time',             contract.team],
              ['Owner',            contract.owner],
              ['Sistema de origem',contract.source_system],
              ['Ambiente',         contract.environment],
              ['Criado em',        contract.created_at],
              ['Atualizado em',    contract.updated_at],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label} className="flex justify-between items-center text-sm border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                <span className="text-gray-400">{label}</span>
                <span className="text-gray-800 font-mono text-xs font-medium">{value}</span>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            {/* Classification */}
            <div className="card p-5">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Classificação</h3>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold font-mono"
                style={{ color: cc, background: cbg }}>
                {contract.data_classification}
              </span>
            </div>
            {/* Tags */}
            <div className="card p-5">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {contract.tags.map(t => (
                  <span key={t} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs bg-gray-100 text-gray-600 border border-gray-200 font-mono">
                    #{t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* SLA */}
          <div className="card p-5 md:col-span-2">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">SLA</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {([
                ['Freshness',       contract.sla.freshness],
                ['Latência máx.',   `${contract.sla.max_latency_minutes} min`],
                ['Disponibilidade', `${contract.sla.availability_percent}%`],
                ['Retenção',        `${contract.sla.retention_days} dias`],
                ['Alert e-mail',    contract.sla.alert_email],
              ] as [string, string][]).map(([label, value]) => (
                <div key={label} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                  <div className="text-xs text-gray-400 mb-1">{label}</div>
                  <div className="text-sm font-bold text-gray-800 font-mono">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Schema ── */}
      {activeTab === 'schema' && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50">
            <h3 className="text-sm font-bold text-gray-800">Schema — {contract.fields.length} campo(s)</h3>
          </div>
          {contract.fields.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  {['Campo','Tipo','Nullable','PK','PII','Descrição'].map(col => (
                    <th key={col} className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-widest">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contract.fields.map((f, i) => (
                  <tr key={i} className="border-b border-gray-50 hover:bg-orange-50/30 transition-colors">
                    <td className="px-5 py-3">
                      <span className="font-mono font-semibold text-gray-800">{f.name}</span>
                      {f.partition_key && <span className="ml-1 text-xs text-amber-500" title="Partition Key">⚡</span>}
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">{f.type}</span>
                    </td>
                    <td className="px-5 py-3">
                      {f.nullable
                        ? <span className="text-gray-400 text-xs">NULL</span>
                        : <span className="text-gray-700 text-xs font-semibold">NOT NULL</span>}
                    </td>
                    <td className="px-5 py-3">
                      {f.business_key
                        ? <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-700 font-mono">PK</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      {f.pii && f.pii !== 'NONE'
                        ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-600 font-mono">{f.pii}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{f.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-gray-300">
              <p className="text-sm">Nenhum campo definido</p>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Localização ── */}
      {activeTab === 'location' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="card p-5 space-y-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Localização</h3>
            {([
              ['Layer',      contract.location.layer],
              ['Bucket',     contract.location.bucket],
              ['Path',       contract.location.path],
              ['Formato',    contract.location.format],
              ['Compressão', contract.location.compression],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label}>
                <div className="text-xs text-gray-400 mb-1">{label}</div>
                <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 font-mono text-sm text-gray-800 font-medium">{value}</div>
              </div>
            ))}
          </div>
          <div className="card p-5">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Path completo</h3>
            <div className="bg-gray-100 border border-gray-200 rounded-xl p-4 font-mono text-sm text-gray-700 break-all select-all">
              {contract.location.bucket}{contract.location.path}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Formato: <span className="text-gray-700 font-mono font-medium">{contract.location.format}</span>
              {' · '}
              Compressão: <span className="text-gray-700 font-mono font-medium">{contract.location.compression}</span>
            </p>
          </div>
        </div>
      )}

      {/* ── Tab: Particionamento ── */}
      {activeTab === 'partitioning' && (
        <div className="max-w-lg">
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 shadow-sm">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Particionamento</h3>
            {([
              ['Estratégia',          contract.partitioning.strategy],
              ['Coluna de partição',  contract.partitioning.partition_column],
              ['Formato da partição', contract.partitioning.partition_format],
              ['Pruning habilitado',  contract.partitioning.pruning_enabled ? 'Sim' : 'Não'],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label}>
                <div className="text-xs text-gray-500 mb-1">{label}</div>
                <div className="bg-gray-50 border border-gray-100 rounded px-3 py-2 font-mono text-sm text-gray-800">{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab: Data Quality ── */}
      {activeTab === 'data_quality' && (
        <div className="space-y-5">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            {([
              { label: 'Total de regras', value: dq.length, color: '#111827' },
              { label: 'Crítico',         value: dqCritical, color: '#dc2626' },
              { label: 'Alerta',          value: dqAlert,    color: '#d97706' },
            ]).map(s => (
              <div key={s.label} className="card p-4 text-center">
                <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {dq.length === 0 ? (
            <div className="card p-10 text-center text-gray-400">
              <svg className="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <p className="text-sm">Nenhuma regra de Data Quality definida.</p>
              <p className="text-xs mt-1">Crie um novo contrato para adicionar regras SodaCore.</p>
            </div>
          ) : (
            <>
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-400 border-b border-gray-100 bg-gray-50/50">
                        {['Categoria','Check','Coluna','Parâmetros','Severidade'].map(col => (
                          <th key={col} className="text-left px-4 py-3 font-medium">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dq.map((rule, i) => (
                        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-3 text-gray-600 text-xs">{rule.category}</td>
                          <td className="px-4 py-3 font-mono text-gray-800 text-xs">{rule.check}</td>
                          <td className="px-4 py-3 font-mono text-gray-500 text-xs">{rule.column || '—'}</td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {Object.entries(rule.params ?? {}).filter(([, v]) => v).length > 0
                              ? Object.entries(rule.params).filter(([, v]) => v).map(([k, v]) => (
                                <span key={k} className="inline-flex items-center gap-1 mr-2">
                                  <span className="text-gray-400">{k}:</span>
                                  <span className="font-mono text-gray-700">{v}</span>
                                </span>
                              ))
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {rule.severity === 'CRITICAL'
                              ? <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold font-mono" style={{ color: '#dc2626', background: '#fef2f2' }}>CRÍTICO</span>
                              : <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-bold font-mono" style={{ color: '#d97706', background: '#fffbeb' }}>ALERTA</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Category breakdown */}
              {(() => {
                const cats = [...new Set(dq.map(r => r.category))];
                return (
                  <div className="card p-5">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Por categoria</h3>
                    <div className="space-y-2">
                      {cats.map(cat => {
                        const catRules = dq.filter(r => r.category === cat);
                        const catCrit  = catRules.filter(r => r.severity === 'CRITICAL').length;
                        return (
                          <div key={cat} className="flex items-center gap-3">
                            <span className="text-xs text-gray-600 w-40 truncate">{cat}</span>
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${Math.round(catRules.length / dq.length * 100)}%`, background: '#185FA5' }} />
                            </div>
                            <span className="text-xs text-gray-400 w-16 text-right">{catRules.length} regra(s)</span>
                            {catCrit > 0 && <span className="text-xs font-bold" style={{ color: '#dc2626' }}>{catCrit}✗</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* ── Tab: Histórico ── */}
      {activeTab === 'history' && (
        <div className="space-y-3 max-w-2xl">
          {contract.history.length > 0 ? (
            [...contract.history].reverse().map((h, i, arr) => (
              <div key={i} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="w-3 h-3 rounded-full mt-1 flex-shrink-0" style={{ background: '#185FA5' }} />
                  {i < arr.length - 1 && <div className="w-px flex-1 bg-gray-200 mt-1" />}
                </div>
                <div className="bg-white border border-gray-200 rounded-xl p-4 flex-1 mb-2 shadow-sm">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-sm font-medium text-blue-600">v{h.version}</span>
                    <span className="text-xs text-gray-400 font-mono">{h.date}</span>
                  </div>
                  <p className="text-sm text-gray-700">{h.note}</p>
                  <p className="text-xs text-gray-400 mt-1 font-mono">{h.author}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="text-gray-400 text-sm">Nenhum histórico disponível.</div>
          )}
        </div>
      )}

      {/* ── Tab: Solicitações ── */}
      {activeTab === 'requests' && (
        related.length > 0 ? (
          <div className="space-y-3">
            {related.map(r => (
              <Link key={r.id} to={`/requests/${r.id}`}
                className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-400 hover:shadow-sm transition-all no-underline">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-800">{r.title}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium font-mono ${REQ_STATUS_CLS[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {r.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                  <span>{r.requester_name}</span>
                  <span>·</span>
                  <span className="font-mono">{r.updated_at}</span>
                  <span>·</span>
                  <span className="font-mono">{r.type}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <svg className="w-10 h-10 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
            </svg>
            <p className="text-sm">Nenhuma solicitação vinculada</p>
          </div>
        )
      )}

      {/* ── Tab: Lógica de Negócio (SPEC) ── */}
      {activeTab === 'business_logic' && (
        <div className="space-y-5">
          {!contract.business_logic?.sql && !contract.business_logic?.dependencies?.length ? (
            <div className="card p-10 text-center text-gray-400">
              <svg className="w-10 h-10 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
              </svg>
              <p className="text-sm">Nenhuma lógica de negócio definida.</p>
              <p className="text-xs mt-1">Disponível apenas para contratos da camada SPEC.</p>
            </div>
          ) : (
            <>
              {contract.business_logic?.sql && (
                <div className="card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Script SQL</h3>
                    <button
                      onClick={() => navigator.clipboard.writeText(contract.business_logic?.sql ?? '')}
                      className="text-xs text-gray-400 hover:text-gray-700 border border-gray-200 rounded px-2 py-1 transition-colors">
                      Copiar
                    </button>
                  </div>
                  <pre className="bg-gray-900 text-green-400 text-xs rounded-lg p-4 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap">
                    {contract.business_logic.sql}
                  </pre>
                </div>
              )}

              <div className="card p-5">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">
                  Tabelas dependência
                  <span className="ml-2 text-gray-400 font-normal normal-case">
                    ({contract.business_logic?.dependencies?.length ?? 0})
                  </span>
                </h3>
                {(contract.business_logic?.dependencies ?? []).length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 border-b border-gray-100">
                          <th className="text-left py-2 pr-6 font-medium">Tabela</th>
                          <th className="text-left py-2 font-medium">Contrato vinculado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contract.business_logic!.dependencies!.map((dep, i) => (
                          <tr key={i} className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
                            <td className="py-3 pr-6 font-mono text-gray-800 text-xs">{dep.table || '—'}</td>
                            <td className="py-3 text-xs">
                              {dep.contract_id
                                ? <Link to={`/contracts/${dep.contract_id}`} className="text-blue-600 hover:underline font-mono">{dep.contract_id}</Link>
                                : <span className="text-gray-400">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">Nenhuma dependência registrada.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {showExport && (
        <ExportModal contract={contract} token={token!} onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}
