import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchDashboard } from '../../api/dcm';
import { getAgentsUsage, type UsageStats } from '../../api/engine';
import { useAuthStore } from '../../store/authStore';
import { useAwsCredsStore } from '../../store/awsCredentialsStore';
import { useMockModeStore } from '../../store/mockModeStore';
import type { DashboardData } from '../../types/dcm';
import { useT } from '../../hooks/useT';

const LAYER_COLORS: Record<string, string> = {
  RAW: '#9ca3af',
  BRONZE: '#d97706',
  SILVER: '#6b7280',
  GOLD: '#f59e0b',
};

export function DashboardPage() {
  const { token, user } = useAuthStore();
  const navigate = useNavigate();
  const t = useT();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const creds = useAwsCredsStore();
  const { mockMode } = useMockModeStore();
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState('');

  useEffect(() => {
    if (!token) return;
    fetchDashboard(token)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setUsageLoading(true);
    setUsageError('');
    getAgentsUsage(
      { aws_region: creds.region, aws_access_key_id: creds.accessKeyId, aws_secret_access_key: creds.secretAccessKey, aws_session_token: creds.sessionToken },
      token,
      1440,
    )
      .then(setUsage)
      .catch(e => setUsageError(e instanceof Error ? e.message : String(e)))
      .finally(() => setUsageLoading(false));
  }, [token, creds.region, creds.accessKeyId, creds.secretAccessKey, creds.sessionToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-2 h-2 rounded-full bg-brand animate-pulse" />
        <span className="ml-3 text-sm text-gray-400">{t.dashboard.loading}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-8 text-center">
        <div className="text-red-500 text-sm mb-2">{t.dashboard.error}</div>
        <div className="text-gray-400 text-xs font-mono">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  const { stats, recent } = data;

  const metrics = [
    { label: t.dashboard.total, value: stats.total, color: 'text-gray-800' },
    { label: t.dashboard.pending, value: stats.pending, color: 'text-blue-600' },
    { label: t.dashboard.approved, value: stats.approved_this_month, color: 'text-green-600' },
    { label: t.dashboard.pii_fields, value: stats.pii_fields, color: 'text-orange-600' },
  ];

  const maxLayer = Math.max(...Object.values(stats.by_layer), 1);

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">{t.dashboard.title}</h1>
          <p className="text-sm text-gray-400 mt-1">{t.dashboard.subtitle}</p>
        </div>
        {user?.role !== 'viewer' && (
          <Link to="/contracts/new" className="btn-primary no-underline">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            {t.dashboard.new_contract}
          </Link>
        )}
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-4 gap-5 mb-8">
        {metrics.map(m => (
          <div key={m.label} className="card metric-card p-5">
            <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">{m.label}</div>
            <div className={`text-3xl font-extrabold ${m.color}`}>{m.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-5">
        {/* Layer chart */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">{t.dashboard.by_layer}</h3>
          <div className="space-y-3">
            {Object.entries(stats.by_layer).map(([layer, count]) => (
              <div key={layer}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-600">{layer}</span>
                  <span className="text-xs font-bold text-gray-800 font-mono">{count}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${(count / maxLayer) * 100}%`,
                      backgroundColor: LAYER_COLORS[layer] || '#9ca3af',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className="col-span-3 card" id="recent-activity">
          <div className="p-5 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">{t.dashboard.recent}</h3>
          </div>
          {recent.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">{t.dashboard.no_recent}</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left">
                  <th className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-5 py-3">{t.dashboard.col_request}</th>
                  <th className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-5 py-3">{t.dashboard.col_contract}</th>
                  <th className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-5 py-3">{t.dashboard.col_type}</th>
                  <th className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-5 py-3">{t.dashboard.col_status}</th>
                  <th className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-5 py-3">{t.dashboard.col_date}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(r => (
                  <tr
                    key={r.id}
                    className="border-t border-gray-50 hover:bg-[#FFF8F4] cursor-pointer transition-colors"
                    onClick={() => navigate(`/requests/${r.id}`)}
                  >
                    <td className="px-5 py-3 text-sm font-medium text-gray-800">{r.title}</td>
                    <td className="px-5 py-3 text-sm text-gray-600">{r.contract_name}</td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-mono text-gray-500 bg-gray-100 rounded px-2 py-0.5">{r.type}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                        r.status === 'APPROVED' ? 'bg-green-50 text-green-700 border-green-200' :
                        r.status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200' :
                        'bg-yellow-50 text-yellow-700 border-yellow-200'
                      }`}>
                        {r.status === 'OPEN' ? 'Open' : r.status === 'APPROVED' ? 'Approved' : 'Rejected'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-400 font-mono">{r.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Agents section */}
      <div className="mt-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">{t.dashboard.agents_section}</h2>
          <Link to="/agents-catalog" className="text-xs text-orange-600 hover:underline font-semibold">
            {t.dashboard.agents_view_catalog}
          </Link>
        </div>

        {usageLoading ? (
          <div className="grid grid-cols-4 gap-5">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="card p-5">
                <div className="h-3 w-24 bg-gray-100 rounded animate-pulse mb-3" />
                <div className="h-8 w-16 bg-gray-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : usageError ? (
          <div className="card p-4 text-sm text-gray-400">{t.dashboard.agents_load_error}</div>
        ) : usage ? (
          <div className="grid grid-cols-4 gap-5">
            <div className="card metric-card p-5">
              <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">{t.dashboard.agents_total}</div>
              <div className="text-3xl font-extrabold text-gray-800">{usage.total_agents}</div>
            </div>

            <div className="card metric-card p-5">
              <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">{t.dashboard.agents_active}</div>
              <div className="text-3xl font-extrabold text-green-600">{usage.by_status.ACTIVE ?? 0}</div>
            </div>

            <div className="card metric-card p-5">
              <div className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">{t.dashboard.agents_failed}</div>
              <div className={`text-3xl font-extrabold ${(usage.by_status.FAILED ?? 0) > 0 ? 'text-red-600' : 'text-gray-300'}`}>
                {usage.by_status.FAILED ?? 0}
              </div>
            </div>

            <div className="card metric-card p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400 font-semibold uppercase tracking-wider">{t.dashboard.agents_invocations_24h}</span>
                {mockMode && (
                  <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 uppercase">
                    {t.dashboard.agents_demo}
                  </span>
                )}
              </div>
              <div className="text-3xl font-extrabold text-blue-600">{usage.total_invocations_window.toLocaleString()}</div>
              <div className="text-xs text-gray-400 mt-1 font-mono">
                {usage.avg_latency_ms != null ? `${usage.avg_latency_ms}ms ${t.dashboard.agents_avg_latency}` : '—'}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
