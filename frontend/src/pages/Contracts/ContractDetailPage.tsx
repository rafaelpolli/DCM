import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { fetchContract, fetchRequests } from '../../api/dcm';
import { useAuthStore } from '../../store/authStore';
import { StatusBadge } from '../../components/shared/StatusBadge';
import type { Contract, ChangeRequest } from '../../types/dcm';
import { ExportModal } from './ExportModal';
import { useGraphStore } from '../../store/graphStore';
import type { AgentNode, AgentEdge } from '../../types/graph';

export function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuthStore();
  const [contract, setContract] = useState<Contract | null>(null);
  const [related, setRelated] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [showExport, setShowExport] = useState(false);
  const loadProject = useGraphStore(s => s.loadProject);
  const setProjectName = useGraphStore(s => s.setProjectName);
  const navigate = useNavigate();

  useEffect(() => {
    if (!token || !id) return;
    Promise.all([
      fetchContract(token, id),
      fetchRequests(token).catch(() => ({ requests: [] })),
    ]).then(([cData, rData]) => {
      setContract(cData.contract);
      setRelated(cData.related_requests);
    }).catch(e => setError(e.message))
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
        <Link to="/contracts" className="text-brand text-sm mt-4 inline-block hover:underline">Voltar ao Catalogo</Link>
      </div>
    );
  }

  const tabs = [
    { key: 'overview', label: 'Visao Geral' },
    { key: 'schema', label: 'Schema' },
    { key: 'location', label: 'Localizacao' },
    { key: 'partitioning', label: 'Particionamento' },
    { key: 'history', label: 'Historico' },
    { key: 'requests', label: 'Solicitacoes' },
  ];

  return (
    <div>
      {/* Breadcrumb + header */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
        <Link to="/contracts" className="hover:text-brand transition-colors">Catalogo</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{contract.name}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">{contract.name}</h1>
          <div className="flex items-center gap-3 mt-1">
            <StatusBadge status={contract.status} />
            <span className="text-xs text-gray-400 font-mono">v{contract.version}</span>
            <span className="text-xs text-gray-400">{contract.domain}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/contracts/new" className="btn-primary no-underline text-xs">
            Novo Contrato
          </Link>
          <button onClick={() => setShowExport(true)} className="text-sm font-semibold text-gray-600 hover:text-brand transition-colors border border-gray-200 rounded-lg px-4 py-2">
            Exportar
          </button>
          <button
            onClick={() => {
              if (!contract) return;
              const agentName = contract.name.toLowerCase().replace(/\s+/g, '-') + '-agent';

              // Build a starter canvas wired to the contract's data source
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
                  operation: 'read',
                  bucket: contract.location.bucket,
                  key_template: contract.location.path,
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
                  temperature: 0.3,
                  max_tokens: 4096,
                  streaming: false,
                  tools: ['s3-1'],
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
            }}
            className="text-sm font-semibold text-brand border border-brand rounded-lg px-4 py-2 hover:bg-orange-50 transition-colors"
          >
            🤖 Gerar Agente
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="card mb-5">
        <div className="border-b border-gray-100 px-5 flex gap-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`tab-btn ${activeTab === t.key ? 'active' : ''}`}
              style={{
                position: 'relative', padding: '10px 14px', fontSize: '13px', fontWeight: 500,
                color: activeTab === t.key ? '#0f0f0f' : '#9ca3af',
                border: 'none', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {t.label}
              {activeTab === t.key && (
                <span style={{
                  position: 'absolute', bottom: '-1px', left: '0', right: '0',
                  height: '2px', background: '#FF6200', borderRadius: '2px 2px 0 0',
                }} />
              )}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === 'overview' && (
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Informacoes Gerais</h3>
                <dl className="space-y-3">
                  {[
                    ['Descricao', contract.description],
                    ['Dominio', contract.domain],
                    ['Time', contract.team],
                    ['Owner', contract.owner],
                    ['Sistema de Origem', contract.source_system],
                    ['Classificacao', contract.data_classification],
                    ['Ambiente', contract.environment],
                    ['Criado em', contract.created_at],
                  ].map(([label, value]) => (
                    <div key={label} className="flex">
                      <dt className="text-xs text-gray-400 w-32 shrink-0">{label}</dt>
                      <dd className="text-sm text-gray-700">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">SLA</h3>
                <dl className="space-y-3">
                  {[
                    ['Freshness', contract.sla.freshness],
                    ['Latencia Max (min)', String(contract.sla.max_latency_minutes)],
                    ['Disponibilidade (%)', String(contract.sla.availability_percent)],
                    ['Retencao (dias)', String(contract.sla.retention_days)],
                    ['Alerta Email', contract.sla.alert_email],
                  ].map(([label, value]) => (
                    <div key={label} className="flex">
                      <dt className="text-xs text-gray-400 w-40 shrink-0">{label}</dt>
                      <dd className="text-sm text-gray-700">{value}</dd>
                    </div>
                  ))}
                </dl>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-5 mb-3">Tags</h3>
                <div className="flex flex-wrap gap-1.5">
                  {contract.tags.map(t => (
                    <span key={t} className="text-xs bg-gray-100 text-gray-600 rounded-full px-2.5 py-0.5 font-mono">{t}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'schema' && (
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-gray-100">
                  <th className="text-[11px] font-bold text-gray-400 uppercase px-3 py-2">Nome</th>
                  <th className="text-[11px] font-bold text-gray-400 uppercase px-3 py-2">Tipo</th>
                  <th className="text-[11px] font-bold text-gray-400 uppercase px-3 py-2">Nullable</th>
                  <th className="text-[11px] font-bold text-gray-400 uppercase px-3 py-2">PII</th>
                  <th className="text-[11px] font-bold text-gray-400 uppercase px-3 py-2">Partition Key</th>
                  <th className="text-[11px] font-bold text-gray-400 uppercase px-3 py-2">Business Key</th>
                  <th className="text-[11px] font-bold text-gray-400 uppercase px-3 py-2">Descricao</th>
                </tr>
              </thead>
              <tbody>
                {contract.fields.map((f, i) => (
                  <tr key={i} className="border-t border-gray-50">
                    <td className="px-3 py-2 text-sm font-mono font-semibold text-gray-800">{f.name}</td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-500">{f.type}</td>
                    <td className="px-3 py-2 text-xs">{f.nullable ? '\u2705' : '\u274c'}</td>
                    <td className="px-3 py-2 text-xs font-mono text-gray-500">{f.pii}</td>
                    <td className="px-3 py-2 text-xs">{f.partition_key ? '\u2705' : '-'}</td>
                    <td className="px-3 py-2 text-xs">{f.business_key ? '\u2705' : '-'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{f.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {activeTab === 'location' && (
            <div className="grid grid-cols-2 gap-6">
              {[
                ['Camada', contract.location.layer],
                ['Bucket', contract.location.bucket],
                ['Path', contract.location.path],
                ['Formato', contract.location.format],
                ['Compressao', contract.location.compression],
              ].map(([label, value]) => (
                <div key={label} className="flex">
                  <dt className="text-xs text-gray-400 w-32 shrink-0">{label}</dt>
                  <dd className="text-sm text-gray-700 font-mono">{value}</dd>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'partitioning' && (
            <div className="grid grid-cols-2 gap-6">
              {[
                ['Estrategia', contract.partitioning.strategy],
                ['Coluna', contract.partitioning.partition_column],
                ['Formato', contract.partitioning.partition_format],
                ['Pruning', contract.partitioning.pruning_enabled ? 'Habilitado' : 'Desabilitado'],
              ].map(([label, value]) => (
                <div key={label} className="flex">
                  <dt className="text-xs text-gray-400 w-32 shrink-0">{label}</dt>
                  <dd className="text-sm text-gray-700 font-mono">{value}</dd>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-4">
              {contract.history.map((h, i) => (
                <div key={i} className="flex gap-4">
                  <div className="w-2 h-2 rounded-full bg-brand mt-1.5 shrink-0" />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-gray-700">{h.version}</span>
                      <span className="text-xs text-gray-400">{h.date}</span>
                      <span className="text-xs text-gray-400">- {h.author}</span>
                    </div>
                    <div className="text-sm text-gray-600">{h.note}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'requests' && (
            related.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-400">Nenhuma solicitacao relacionada</div>
            ) : (
              <div className="space-y-3">
                {related.map(r => (
                  <Link
                    key={r.id}
                    to={`/requests/${r.id}`}
                    className="block card p-4 no-underline hover:border-gray-200 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-gray-800">{r.title}</div>
                        <div className="text-xs text-gray-400 mt-1">{r.requester_name} - {r.created_at}</div>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                  </Link>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {showExport && (
        <ExportModal contract={contract} token={token!} onClose={() => setShowExport(false)} />
      )}
    </div>
  );
}
