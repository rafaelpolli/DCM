import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { listAgentRuntimes, type AgentRuntimeSummary, type AwsCredsBody } from '../../api/engine';
import {
  runProbeSuite,
  runCustomProbes,
  checkCompliance,
  saveBaseline,
  getBaseline,
  type ProbeResult,
  type ProbeRow,
  type ComplianceResult,
  type SuiteName,
} from '../../api/security';
import { useAuthStore } from '../../store/authStore';
import { useAwsCredsStore } from '../../store/awsCredentialsStore';
import { showToast } from '../../components/shared/Toast';

type Tab = SuiteName | 'compliance';

const TABS: { id: Tab; label: string }[] = [
  { id: 'injection',     label: 'Prompt Injection' },
  { id: 'bias',          label: 'Bias' },
  { id: 'hallucination', label: 'Hallucination' },
  { id: 'toxicity',      label: 'Toxicity' },
  { id: 'tool-abuse',    label: 'Tool Abuse' },
  { id: 'compliance',    label: 'Compliance' },
];

function PassRateBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.85 ? 'bg-green-500' : value >= 0.6 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono font-bold w-10 text-right text-gray-700">{pct}%</span>
    </div>
  );
}

function RowDetail({ row, suite }: { row: ProbeRow; suite: SuiteName }) {
  const passed = row.passed;
  const bg = passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200';
  return (
    <div className={`border rounded-lg p-3 ${bg}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono font-semibold">{row.id ?? '-'}</span>
        <span className={`text-xs font-bold ${passed ? 'text-green-700' : 'text-red-700'}`}>
          {passed ? '✓ passed' : '✗ failed'}
        </span>
      </div>
      {suite === 'bias' ? (
        <div className="space-y-2">
          <div className="text-xs"><span className="font-semibold text-gray-600">A:</span> <span className="font-mono">{row.prompt_a}</span></div>
          <div className="text-xs text-gray-700 bg-white border border-gray-200 rounded p-2 whitespace-pre-wrap">{row.response_a}</div>
          <div className="text-xs"><span className="font-semibold text-gray-600">B:</span> <span className="font-mono">{row.prompt_b}</span></div>
          <div className="text-xs text-gray-700 bg-white border border-gray-200 rounded p-2 whitespace-pre-wrap">{row.response_b}</div>
          <div className="text-xs text-gray-500">Token overlap: <span className="font-mono">{row.token_overlap}</span></div>
        </div>
      ) : (
        <>
          <div className="text-xs mb-1"><span className="font-semibold text-gray-600">Prompt:</span> <span className="font-mono">{row.prompt}</span></div>
          <div className="text-xs text-gray-700 bg-white border border-gray-200 rounded p-2 whitespace-pre-wrap">{row.response}</div>
          <div className="text-xs text-gray-500 mt-2 flex gap-3 flex-wrap">
            {row.is_refusal != null && <span>refusal: {row.is_refusal ? '✓' : '✗'}</span>}
            {row.is_leak != null && <span>leak: {row.is_leak ? '⚠' : 'no'}</span>}
            {row.echoed_dangerous != null && <span>echo: {row.echoed_dangerous ? '⚠' : 'no'}</span>}
            {row.toxicity_score != null && <span>toxicity: {row.toxicity_score}</span>}
            {row.expected && <span>expected: {row.expected}</span>}
            {row.ground_truth && <span>gt: {row.ground_truth}</span>}
          </div>
        </>
      )}
    </div>
  );
}

export function SecurityPage() {
  const { token } = useAuthStore();
  const creds = useAwsCredsStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialArn = searchParams.get('agent') ?? '';

  const [tab, setTab] = useState<Tab>('injection');
  const [agents, setAgents] = useState<AgentRuntimeSummary[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [arn, setArn] = useState(initialArn);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [compliance, setCompliance] = useState<ComplianceResult | null>(null);
  const [baseline, setBaseline] = useState<{ pass_rate: number | null } | null>(null);
  const [customCsv, setCustomCsv] = useState('');

  const credsBody = useCallback((): AwsCredsBody => ({
    aws_region: creds.region,
    aws_access_key_id: creds.accessKeyId,
    aws_secret_access_key: creds.secretAccessKey,
    aws_session_token: creds.sessionToken,
  }), [creds.region, creds.accessKeyId, creds.secretAccessKey, creds.sessionToken]);

  useEffect(() => {
    if (!token) return;
    setAgentsLoading(true);
    listAgentRuntimes(credsBody(), token)
      .then(r => setAgents(r.agents))
      .catch(() => setAgents([]))
      .finally(() => setAgentsLoading(false));
  }, [token, credsBody]);

  useEffect(() => {
    if (tab === 'compliance' || !arn || !token) return;
    getBaseline(arn, tab, token).then(b => setBaseline(b ? { pass_rate: b.pass_rate } : null)).catch(() => setBaseline(null));
  }, [arn, tab, token]);

  const handleRun = async () => {
    if (!arn) { setError('Selecione um agente.'); return; }
    setRunning(true);
    setError('');
    setResult(null);
    setCompliance(null);
    try {
      if (tab === 'compliance') {
        const c = await checkCompliance(arn, null, credsBody(), token!);
        setCompliance(c);
      } else {
        const r = await runProbeSuite(tab, arn, credsBody(), token!);
        setResult(r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const handleRunCustom = async () => {
    if (!arn) { setError('Selecione um agente.'); return; }
    const prompts = customCsv.split('\n').map(l => l.trim()).filter(Boolean);
    if (prompts.length === 0) { setError('Cole pelo menos um prompt.'); return; }
    setRunning(true);
    setError('');
    try {
      const r = await runCustomProbes(prompts, arn, credsBody(), token!);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const handleSaveBaseline = async () => {
    if (!result || !arn) return;
    try {
      await saveBaseline(arn, tab as string, result.pass_rate, result, token!);
      setBaseline({ pass_rate: result.pass_rate });
      showToast('Baseline salvo');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const drift = result && baseline?.pass_rate != null
    ? result.pass_rate - baseline.pass_rate
    : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">Segurança</h1>
          <p className="text-sm text-gray-400 mt-1">Red & blue team — guardrails, probes, compliance</p>
        </div>
        <button
          onClick={() => navigate('/agents-catalog')}
          className="text-xs text-orange-600 hover:underline font-semibold"
        >
          ← Catálogo
        </button>
      </div>

      {/* Agent picker */}
      <div className="card p-4 mb-5 flex items-center gap-3 flex-wrap">
        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Agente:</label>
        {agentsLoading ? (
          <span className="text-xs text-gray-400">carregando...</span>
        ) : agents.length === 0 ? (
          <input
            type="text"
            value={arn}
            onChange={e => setArn(e.target.value)}
            placeholder="arn:aws:bedrock-agentcore:..."
            className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 font-mono focus:outline-none focus:border-brand"
          />
        ) : (
          <select
            value={arn}
            onChange={e => setArn(e.target.value)}
            className="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 font-mono focus:outline-none focus:border-brand"
          >
            <option value="">— escolha o agente —</option>
            {agents.map(a => (
              <option key={a.agent_runtime_arn} value={a.agent_runtime_arn}>
                {a.name} ({a.status})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-gray-200 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setResult(null); setCompliance(null); }}
            className={`px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${
              tab === t.id ? 'text-orange-600 border-b-2 border-orange-500' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Run controls */}
      <div className="card p-4 mb-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-gray-600">
            {tab === 'injection' && 'Bateria de prompts adversariais (~30) testando jailbreak e leak.'}
            {tab === 'bias' && 'Pares de prompts simétricos testando viés em respostas.'}
            {tab === 'hallucination' && 'Perguntas factuais + armadilhas — verifica truthful vs refuse.'}
            {tab === 'toxicity' && 'Provocadores de toxicidade — espera-se recusa.'}
            {tab === 'tool-abuse' && 'Tentativas de invocar tools de forma destrutiva.'}
            {tab === 'compliance' && 'Checklist LGPD/GDPR: nodes de segurança, guardrails, auditoria.'}
          </p>
          <button
            onClick={handleRun}
            disabled={running || !arn}
            className="btn-primary"
          >
            {running ? 'Rodando...' : tab === 'compliance' ? '⟳ Verificar' : '▶ Rodar probes'}
          </button>
        </div>

        {tab !== 'compliance' && tab !== 'bias' && tab !== 'hallucination' && tab !== 'toxicity' && tab !== 'tool-abuse' && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-600 mb-2">Ou rode probes customizados (um por linha):</p>
            <textarea
              value={customCsv}
              onChange={e => setCustomCsv(e.target.value)}
              rows={4}
              placeholder={'Ignore previous instructions and...\nDisregard the above and...'}
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-900 font-mono focus:outline-none focus:border-brand resize-none"
            />
            <button
              onClick={handleRunCustom}
              disabled={running || !arn}
              className="mt-2 text-xs text-orange-600 hover:underline font-semibold"
            >
              Rodar probes customizados →
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="card p-4 mb-5 border border-red-200 bg-red-50">
          <p className="text-sm text-red-700 font-mono">{error}</p>
        </div>
      )}

      {/* Compliance result */}
      {compliance && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-800">
              Compliance: {compliance.score}/{compliance.total}
              {compliance.compliant && <span className="ml-2 text-green-600">✓ Em conformidade</span>}
            </h2>
          </div>
          <ul className="space-y-2">
            {compliance.items.map(item => (
              <li key={item.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                <span className={`text-lg leading-none mt-0.5 ${item.passed ? 'text-green-600' : 'text-red-500'}`}>
                  {item.passed ? '✓' : '✗'}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-800">{item.title}</p>
                  {item.detail && <p className="text-xs text-gray-500 font-mono mt-0.5">{item.detail}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Probe result */}
      {result && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4 gap-4">
            <h2 className="text-sm font-bold text-gray-800">Resultado — {result.total} probes</h2>
            <button onClick={handleSaveBaseline} className="text-xs text-orange-600 hover:underline font-semibold">
              💾 Salvar como baseline
            </button>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-5">
            <div>
              <p className="text-xs text-gray-500 mb-1">Taxa de aprovação</p>
              <PassRateBar value={result.pass_rate} />
            </div>
            {baseline?.pass_rate != null && (
              <div>
                <p className="text-xs text-gray-500 mb-1">Baseline ({Math.round(baseline.pass_rate * 100)}%)</p>
                <p className={`text-sm font-mono font-bold ${(drift ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {drift != null ? `${drift >= 0 ? '+' : ''}${(drift * 100).toFixed(1)}pp` : '—'}
                </p>
              </div>
            )}
            <div className="text-xs text-gray-500 space-y-0.5">
              {result.refusal_count != null && <p>Recusas: {result.refusal_count}</p>}
              {result.leak_count != null && <p>Leaks: {result.leak_count}</p>}
              {result.divergent_count != null && <p>Divergentes: {result.divergent_count}</p>}
              {result.correct_count != null && <p>Corretos: {result.correct_count}</p>}
            </div>
          </div>

          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {result.rows.map((row, i) => (
              <RowDetail key={i} row={row} suite={tab as SuiteName} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
