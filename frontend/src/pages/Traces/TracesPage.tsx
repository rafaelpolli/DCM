import { useState } from 'react';
import { queryTraces, type TraceSpan, type TracesResult } from '../../api/engine';
import { useAuthStore } from '../../store/authStore';

const SPAN_COLORS: Record<string, string> = {
  llm: '#a855f7',
  tool: '#f59e0b',
  retrieval: '#3b82f6',
  memory: '#22c55e',
  unknown: '#9ca3af',
};

function SpanRow({ span }: { span: TraceSpan }) {
  const [open, setOpen] = useState(false);
  const color = SPAN_COLORS[span.span_type] ?? SPAN_COLORS.unknown;
  return (
    <div className="border-b border-gray-50 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-xs font-mono text-gray-400 w-44 shrink-0">{span.timestamp}</span>
        <span className="text-xs font-semibold" style={{ color }}>{span.span_type}</span>
        {span.duration_ms != null && (
          <span className="ml-auto text-xs font-mono text-gray-400">{span.duration_ms}ms</span>
        )}
        <span className="text-gray-300 ml-2">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-3 ml-5">
          <pre className="text-xs bg-gray-50 rounded p-3 overflow-x-auto text-gray-700 font-mono whitespace-pre-wrap break-words">
            {span.message}
          </pre>
        </div>
      )}
    </div>
  );
}

export function TracesPage() {
  const { token } = useAuthStore();
  const [form, setForm] = useState({
    aws_access_key_id: '',
    aws_secret_access_key: '',
    aws_session_token: '',
    aws_region: 'us-east-1',
    agent_name: '',
    minutes: 60,
  });
  const [result, setResult] = useState<TracesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));

  const handleLoad = async () => {
    if (!form.aws_access_key_id || !form.aws_secret_access_key || !form.agent_name) {
      setError('AWS credentials and agent name are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await queryTraces({
        aws_access_key_id: form.aws_access_key_id,
        aws_secret_access_key: form.aws_secret_access_key,
        aws_session_token: form.aws_session_token || undefined,
        aws_region: form.aws_region,
        agent_name: form.agent_name,
        minutes: form.minutes,
      }, token!);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-brand placeholder-gray-400 font-mono';

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-gray-900">Live Trace Viewer</h1>
        <p className="text-sm text-gray-400 mt-1">Query CloudWatch Logs Insights for AgentCore observability spans</p>
      </div>

      <div className="card p-6 mb-6">
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">AWS Credentials</h2>
        <p className="text-xs text-gray-400 mb-4">Credentials are sent to the engine backend and used only for this request. Never stored.</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Access Key ID</label>
            <input type="password" className={inputCls} value={form.aws_access_key_id}
              onChange={e => set('aws_access_key_id', e.target.value)} placeholder="AKIA..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Secret Access Key</label>
            <input type="password" className={inputCls} value={form.aws_secret_access_key}
              onChange={e => set('aws_secret_access_key', e.target.value)} placeholder="wJal..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Session Token <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="password" className={inputCls} value={form.aws_session_token}
              onChange={e => set('aws_session_token', e.target.value)} placeholder="FwoG..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Region</label>
            <input className={inputCls} value={form.aws_region}
              onChange={e => set('aws_region', e.target.value)} placeholder="us-east-1" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Agent Name</label>
            <input className={inputCls} value={form.agent_name}
              onChange={e => set('agent_name', e.target.value)} placeholder="my-agent" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Time Window (minutes)</label>
            <input type="number" className={inputCls} value={form.minutes} min={1} max={1440}
              onChange={e => set('minutes', Number(e.target.value))} />
          </div>
        </div>
        {error && <p className="text-sm text-red-600 font-mono mb-3">{error}</p>}
        <button onClick={handleLoad} disabled={loading} className="btn-primary">
          {loading ? 'Loading...' : '⟳ Load Traces'}
        </button>
      </div>

      {result && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-700">{result.spans.length} spans</h2>
              <p className="text-xs text-gray-400 font-mono">{result.log_group} · last {result.query_window_minutes}min</p>
            </div>
            <div className="flex gap-3">
              {Object.entries(SPAN_COLORS).filter(([k]) => k !== 'unknown').map(([k, c]) => (
                <span key={k} className="flex items-center gap-1 text-xs text-gray-500">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
                  {k}
                </span>
              ))}
            </div>
          </div>
          {result.spans.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">No spans found in the time window.</div>
          ) : (
            <div>
              {result.spans.map((span, i) => <SpanRow key={i} span={span} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
