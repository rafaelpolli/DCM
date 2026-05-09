import { useState } from 'react';
import { getDeploymentStatus, type DeploymentStatusResult } from '../../api/engine';
import { useAuthStore } from '../../store/authStore';

const STATUS_STYLE: Record<string, { cls: string; dot: string }> = {
  CREATING: { cls: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500' },
  ACTIVE:   { cls: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-500' },
  UPDATING: { cls: 'bg-yellow-50 text-yellow-700 border-yellow-200', dot: 'bg-yellow-500' },
  DELETING: { cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-400' },
  FAILED:   { cls: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-600' },
  UNKNOWN:  { cls: 'bg-gray-50 text-gray-600 border-gray-200', dot: 'bg-gray-400' },
};

function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.UNKNOWN;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${s.cls}`}>
      <span className={`w-2 h-2 rounded-full ${s.dot}`} />
      {status}
    </span>
  );
}

export function DeploymentsPage() {
  const { token } = useAuthStore();
  const [form, setForm] = useState({
    aws_access_key_id: '',
    aws_secret_access_key: '',
    aws_session_token: '',
    aws_region: 'us-east-1',
    agent_runtime_id: '',
  });
  const [result, setResult] = useState<DeploymentStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleCheck = async () => {
    if (!form.aws_access_key_id || !form.aws_secret_access_key || !form.agent_runtime_id) {
      setError('AWS credentials and Agent Runtime ID are required.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await getDeploymentStatus({
        aws_access_key_id: form.aws_access_key_id,
        aws_secret_access_key: form.aws_secret_access_key,
        aws_session_token: form.aws_session_token || undefined,
        aws_region: form.aws_region,
        agent_runtime_id: form.agent_runtime_id,
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
        <h1 className="text-2xl font-extrabold text-gray-900">Deployment Status</h1>
        <p className="text-sm text-gray-400 mt-1">Check AgentCore Runtime health for a deployed agent</p>
      </div>

      <div className="card p-6 mb-6">
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Connection</h2>
        <p className="text-xs text-gray-400 mb-4">Credentials used for this request only. Never stored server-side.</p>
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
              onChange={e => set('aws_session_token', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Region</label>
            <input className={inputCls} value={form.aws_region}
              onChange={e => set('aws_region', e.target.value)} placeholder="us-east-1" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Agent Runtime ID</label>
            <input className={inputCls} value={form.agent_runtime_id}
              onChange={e => set('agent_runtime_id', e.target.value)}
              placeholder="arn:aws:bedrock-agentcore:us-east-1:123456789012:agent-runtime/abc123" />
          </div>
        </div>
        {error && <p className="text-sm text-red-600 font-mono mb-3">{error}</p>}
        <button onClick={handleCheck} disabled={loading} className="btn-primary">
          {loading ? 'Checking...' : '⟳ Check Status'}
        </button>
      </div>

      {result && (
        <div className="space-y-4">
          <div className="card p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{result.agent_runtime_id}</h2>
                <p className="text-xs text-gray-400 font-mono mt-1">{form.aws_region}</p>
              </div>
              <StatusChip status={result.status} />
            </div>
            <dl className="grid grid-cols-2 gap-4">
              {result.endpoint && (
                <div className="col-span-2">
                  <dt className="text-xs text-gray-400 mb-1">Runtime Endpoint</dt>
                  <dd className="text-sm font-mono text-gray-800 break-all">{result.endpoint}</dd>
                </div>
              )}
              {result.created_at && (
                <div>
                  <dt className="text-xs text-gray-400 mb-1">Created</dt>
                  <dd className="text-sm font-mono text-gray-700">{result.created_at}</dd>
                </div>
              )}
              {result.last_updated_at && (
                <div>
                  <dt className="text-xs text-gray-400 mb-1">Last Updated</dt>
                  <dd className="text-sm font-mono text-gray-700">{result.last_updated_at}</dd>
                </div>
              )}
            </dl>
          </div>

          {Object.keys(result.raw).length > 0 && (
            <div className="card p-5">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Raw API Response</h3>
              <pre className="text-xs bg-gray-50 rounded p-3 overflow-x-auto font-mono text-gray-700">
                {JSON.stringify(result.raw, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
