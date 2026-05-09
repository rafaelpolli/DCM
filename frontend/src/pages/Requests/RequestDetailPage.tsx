import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchRequest, approveRequest, rejectRequest, addComment } from '../../api/dcm';
import { useAuthStore } from '../../store/authStore';
import { showToast } from '../../components/shared/Toast';
import type { ChangeRequest, Contract, DiffChange } from '../../types/dcm';

const STATUS_COLORS: Record<string, [string, string]> = {
  OPEN:      ['#185FA5', '#EFF6FF'],
  APPROVED:  ['#16a34a', '#F0FDF4'],
  REJECTED:  ['#dc2626', '#FEF2F2'],
  IN_REVIEW: ['#7c3aed', '#F5F3FF'],
};

const TYPE_COLORS: Record<string, [string, string]> = {
  SCHEMA_CHANGE: ['#7c3aed', '#F5F3FF'],
  SLA_CHANGE:    ['#0d9488', '#F0FDFA'],
  CREATE:        ['#185FA5', '#EFF6FF'],
  UPDATE:        ['#185FA5', '#EFF6FF'],
  DELETE:        ['#dc2626', '#FEF2F2'],
  DEPRECATE:     ['#9ca3af', '#F9FAFB'],
  AMEND:         ['#d97706', '#fffbeb'],
};

const DEFAULT_COLOR: [string, string] = ['#9ca3af', '#F9FAFB'];

function diffOp(c: DiffChange): 'add' | 'remove' | 'modify' {
  if (c.from == null) return 'add';
  if (c.to == null) return 'remove';
  return 'modify';
}

export function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token, user } = useAuthStore();

  const [req, setReq] = useState<ChangeRequest | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [commentText, setCommentText] = useState('');
  const [rejectText, setRejectText] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    if (!token || !id) return;
    fetchRequest(token, id)
      .then(d => { setReq(d.request); setContract(d.contract); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [token, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApprove = async () => {
    if (!token || !id) return;
    setSubmitting(true);
    try {
      await approveRequest(token, id);
      showToast('Solicitação aprovada!');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao aprovar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!token || !id || !rejectText.trim()) return;
    setSubmitting(true);
    try {
      await rejectRequest(token, id, rejectText);
      showToast('Solicitação rejeitada');
      setRejectText('');
      setShowRejectForm(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao rejeitar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleComment = async () => {
    if (!token || !id || !commentText.trim()) return;
    setSubmitting(true);
    try {
      await addComment(token, id, commentText);
      showToast('Comentário adicionado');
      setCommentText('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao comentar');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-2 h-2 rounded-full bg-brand animate-pulse" />
        <span className="ml-3 text-sm text-gray-400">Carregando solicitação...</span>
      </div>
    );
  }

  if (error || !req) {
    return (
      <div className="card p-8 text-center">
        <div className="text-red-500 text-sm mb-2">Erro ao carregar solicitação</div>
        <div className="text-gray-400 text-xs font-mono">{error || 'Not found'}</div>
        <Link to="/requests" className="text-brand text-sm mt-4 inline-block hover:underline">Voltar</Link>
      </div>
    );
  }

  const [sc, sbg] = STATUS_COLORS[req.status] ?? DEFAULT_COLOR;
  const [tc, tbg] = TYPE_COLORS[req.type] ?? DEFAULT_COLOR;
  const changes = req.diff?.changes ?? [];

  const removes = changes.filter(c => diffOp(c) === 'remove');
  const adds    = changes.filter(c => diffOp(c) === 'add');
  const mods    = changes.filter(c => diffOp(c) === 'modify');

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link to="/requests" className="hover:text-orange-500 transition-colors">Solicitações</Link>
        <span>/</span>
        <span className="text-gray-600 font-mono">{req.id}</span>
      </div>

      {/* Header card */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold font-mono"
                style={{ color: sc, background: sbg }}>
                {req.status}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold font-mono"
                style={{ color: tc, background: tbg }}>
                {req.type}
              </span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">{req.title}</h1>
            <p className="text-sm text-gray-500 mt-1">{req.description}</p>
            <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-gray-400">
              <span>Solicitante: <span className="text-gray-700 font-medium">{req.requester_name}</span></span>
              <span>·</span>
              <span>Contrato:{' '}
                <Link to={`/contracts/${req.contract_id}`}
                  className="text-orange-500 hover:underline font-mono font-medium">
                  {req.contract_name || contract?.name || req.contract_id}
                </Link>
              </span>
              <span>·</span>
              <span className="font-mono">{req.created_at}</span>
            </div>
          </div>

          {/* Admin actions */}
          {user?.role === 'admin' && req.status === 'OPEN' && (
            <div className="flex flex-col gap-2 shrink-0">
              <button onClick={handleApprove} disabled={submitting}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-green-600 hover:bg-green-500 transition-colors disabled:opacity-50">
                ✓ Aprovar
              </button>
              <button onClick={() => setShowRejectForm(v => !v)}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-red-600 border border-red-200 hover:bg-red-50 transition-colors">
                ✕ Rejeitar
              </button>
              {showRejectForm && (
                <div className="w-64">
                  <textarea value={rejectText} onChange={e => setRejectText(e.target.value)}
                    rows={3} placeholder="Justificativa..."
                    className="w-full bg-gray-50 border border-gray-200 text-gray-800 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-red-400 resize-none mb-2" />
                  <button onClick={handleReject} disabled={submitting || !rejectText.trim()}
                    className="w-full px-3 py-2 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-500 disabled:opacity-50">
                    Confirmar Rejeição
                  </button>
                </div>
              )}
            </div>
          )}

          {(req.status === 'APPROVED' || req.status === 'REJECTED') && (
            <div className="text-xs text-gray-400 italic shrink-0">
              {req.status === 'APPROVED'
                ? `Aprovado em ${req.updated_at}`
                : `Rejeitado em ${req.updated_at}`}
            </div>
          )}
        </div>
      </div>

      {/* Diff visual */}
      {changes.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <h2 className="text-sm font-bold text-gray-800">Diff Visual</h2>
            <div className="flex items-center gap-2 text-xs text-gray-400 font-mono">
              {req.diff?.version_from && (
                <><span>v{req.diff.version_from}</span><span>→</span></>
              )}
              <span>v{req.diff?.version_to}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 divide-x divide-gray-100 text-xs font-mono">
            <div className="px-5 py-2.5 bg-gray-50 text-gray-500 font-semibold">
              Versão atual{req.diff?.version_from ? ` (${req.diff.version_from})` : ''}
            </div>
            <div className="px-5 py-2.5 bg-gray-50 text-gray-500 font-semibold">
              Versão proposta ({req.diff?.version_to})
            </div>

            {changes.map((c, i) => {
              const op = diffOp(c);
              if (op === 'remove') return (
                <>
                  <div key={`${i}l`} className="px-5 py-2.5 bg-red-50 text-red-700 flex items-center gap-2 border-t border-red-100">
                    <span className="text-red-500 font-bold text-sm">−</span>
                    <span>{c.field} {String(c.from)}</span>
                  </div>
                  <div key={`${i}r`} className="px-5 py-2.5 text-gray-300 italic flex items-center border-t border-gray-100">campo removido</div>
                </>
              );
              if (op === 'add') return (
                <>
                  <div key={`${i}l`} className="px-5 py-2.5 text-gray-300 italic flex items-center border-t border-gray-100">campo adicionado</div>
                  <div key={`${i}r`} className="px-5 py-2.5 bg-green-50 text-green-700 flex items-center gap-2 border-t border-green-100">
                    <span className="text-green-500 font-bold text-sm">+</span>
                    <span>{c.field} {String(c.to)}</span>
                  </div>
                </>
              );
              return (
                <>
                  <div key={`${i}l`} className="px-5 py-2.5 bg-amber-50 text-amber-700 flex items-center gap-2 border-t border-amber-100">
                    <span className="text-amber-500 font-bold text-sm">~</span>
                    <span>{c.field} = {String(c.from)}</span>
                  </div>
                  <div key={`${i}r`} className="px-5 py-2.5 bg-amber-50 text-amber-800 flex items-center gap-2 border-t border-amber-100">
                    <span className="text-amber-500 font-bold text-sm">~</span>
                    <span>{c.field} = {String(c.to)}</span>
                  </div>
                </>
              );
            })}
          </div>

          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-xs text-gray-400">
              {removes.length > 0 && <span className="text-red-500 font-semibold">{removes.length} campo(s) removido(s)</span>}
              {removes.length > 0 && (adds.length > 0 || mods.length > 0) && ' · '}
              {adds.length > 0 && <span className="text-green-600 font-semibold">{adds.length} campo(s) adicionado(s)</span>}
              {adds.length > 0 && mods.length > 0 && ' · '}
              {mods.length > 0 && <span className="text-amber-600 font-semibold">{mods.length} propriedade(s) modificada(s)</span>}
            </p>
          </div>
        </div>
      )}

      {/* Comments */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-800">Comentários</h2>
        </div>

        {req.comments?.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {req.comments.map((c, i) => (
              <div key={i} className="px-5 py-4 flex gap-3">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5"
                  style={{ background: 'linear-gradient(135deg,#FF6200,#E05200)' }}>
                  {c.author[0]}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-gray-800">{c.author}</span>
                    <span className="text-xs text-gray-400 font-mono">{c.date}</span>
                  </div>
                  <p className="text-sm text-gray-600">{c.text}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-gray-300">
            <p className="text-sm">Nenhum comentário ainda</p>
          </div>
        )}

        <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/30">
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 mt-1"
              style={{ background: 'linear-gradient(135deg,#FF6200,#E05200)' }}>
              {user?.name?.[0] ?? '?'}
            </div>
            <div className="flex-1 flex gap-2">
              <input value={commentText} onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleComment(); }}
                placeholder="Adicionar comentário..." required
                className="flex-1 bg-white border border-gray-200 text-gray-800 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" />
              <button onClick={handleComment} disabled={submitting || !commentText.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#FF6200,#E05200)' }}>
                Enviar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
