import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { fetchRequests } from '../../api/dcm';
import { useAuthStore } from '../../store/authStore';
import { StatusBadge } from '../../components/shared/StatusBadge';
import type { ChangeRequest } from '../../types/dcm';
import { useT } from '../../hooks/useT';

export function RequestsListPage() {
  const { token } = useAuthStore();
  const navigate = useNavigate();
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();

  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const statusFilter = searchParams.get('status') || '';

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetchRequests(token, { status: statusFilter })
      .then(d => setRequests(d.requests))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, statusFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">{t.requests.title}</h1>
          <p className="text-sm text-gray-400 mt-1">{t.requests.subtitle}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-5 flex items-center gap-4">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{t.requests.filter}</span>
        <select
          value={statusFilter}
          onChange={e => {
            const p = new URLSearchParams(searchParams);
            if (e.target.value) p.set('status', e.target.value); else p.delete('status');
            setSearchParams(p);
          }}
          className="text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-gray-500 outline-none"
        >
          <option value="">{t.requests.all}</option>
          <option value="OPEN">{t.requests.open}</option>
          <option value="APPROVED">{t.requests.approved}</option>
          <option value="REJECTED">{t.requests.rejected}</option>
        </select>
        {statusFilter && (
          <button onClick={() => setSearchParams({})} className="text-xs text-brand hover:underline">
            {t.requests.clear}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-2 h-2 rounded-full bg-brand animate-pulse" />
          <span className="ml-3 text-sm text-gray-400">{t.requests.loading}</span>
        </div>
      ) : error ? (
        <div className="card p-8 text-center text-red-500 text-sm">{error}</div>
      ) : requests.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-gray-400 text-sm mb-2">{t.requests.no_results}</div>
          <Link to="/contracts/new" className="text-brand text-sm font-semibold hover:underline">
            Criar novo contrato
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left border-b border-gray-100">
                <th className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-5 py-3">{t.dashboard.col_request}</th>
                <th className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-5 py-3">{t.dashboard.col_contract}</th>
                <th className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-5 py-3">{t.dashboard.col_type}</th>
                <th className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-5 py-3">{t.requests.requester}</th>
                <th className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-5 py-3">{t.dashboard.col_status}</th>
                <th className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-5 py-3">{t.dashboard.col_date}</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(r => (
                <tr
                  key={r.id}
                  className="border-t border-gray-50 hover:bg-[#FFF8F4] cursor-pointer transition-colors"
                  onClick={() => navigate(`/requests/${r.id}`)}
                >
                  <td className="px-5 py-3 text-sm font-semibold text-gray-800">{r.title}</td>
                  <td className="px-5 py-3 text-sm text-gray-600">{r.contract_name}</td>
                  <td className="px-5 py-3">
                    <span className="text-xs font-mono text-gray-500 bg-gray-100 rounded px-2 py-0.5">{r.type}</span>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600">{r.requester_name}</td>
                  <td className="px-5 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-5 py-3 text-xs text-gray-400 font-mono">{r.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
