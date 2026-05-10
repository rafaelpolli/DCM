import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRequest } from '../../api/dcm';
import { useAuthStore } from '../../store/authStore';
import { showToast } from '../../components/shared/Toast';
import type { Contract, RequestType } from '../../types/dcm';
import { useT } from '../../hooks/useT';

interface Props {
  contract: Contract;
  onClose: () => void;
}

const TYPES: { value: RequestType; labelPt: string; labelEs: string }[] = [
  { value: 'AMEND',         labelPt: 'Emenda geral',          labelEs: 'Enmienda general' },
  { value: 'SCHEMA_CHANGE', labelPt: 'Mudança de schema',     labelEs: 'Cambio de esquema' },
  { value: 'SLA_CHANGE',    labelPt: 'Mudança de SLA',        labelEs: 'Cambio de SLA' },
  { value: 'UPDATE',        labelPt: 'Atualização',           labelEs: 'Actualización' },
  { value: 'DEPRECATE',     labelPt: 'Depreciar contrato',    labelEs: 'Despreciar contrato' },
  { value: 'DELETE',        labelPt: 'Excluir contrato',      labelEs: 'Eliminar contrato' },
];

function bumpVersion(v: string): string {
  const parts = v.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return '0.1.0';
  parts[1] += 1;
  parts[2] = 0;
  return parts.join('.');
}

export function RequestChangeModal({ contract, onClose }: Props) {
  const { token } = useAuthStore();
  const navigate = useNavigate();
  const t = useT();

  const [type, setType] = useState<RequestType>('AMEND');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetVersion, setTargetVersion] = useState(bumpVersion(contract.version));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isPt = t.requestDetail.back === 'Solicitações';

  const handleSubmit = async () => {
    if (!token) return;
    if (!title.trim()) {
      setError(isPt ? 'Título obrigatório.' : 'Título obligatorio.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await createRequest(token, {
        contract_id: contract.id,
        type,
        title: title.trim(),
        description: description.trim(),
        target_version: targetVersion.trim(),
        changes: [],
      });
      showToast(isPt ? 'Solicitação criada!' : '¡Solicitud creada!');
      onClose();
      navigate(`/requests/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              {isPt ? 'Solicitar alteração' : 'Solicitar cambio'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 font-mono">{contract.name} · v{contract.version}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {isPt ? 'Tipo de mudança' : 'Tipo de cambio'} <span className="text-red-500">*</span>
            </label>
            <select
              value={type}
              onChange={e => setType(e.target.value as RequestType)}
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            >
              {TYPES.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {isPt ? opt.labelPt : opt.labelEs}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {isPt ? 'Título' : 'Título'} <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={isPt ? 'Ex: Adicionar campo customer_segment' : 'Ej: Agregar campo customer_segment'}
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {isPt ? 'Descrição / justificativa' : 'Descripción / justificación'}
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              placeholder={isPt
                ? 'Descreva o que muda e por quê...'
                : 'Describe qué cambia y por qué...'}
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {isPt ? 'Versão alvo' : 'Versión objetivo'}
            </label>
            <input
              type="text"
              value={targetVersion}
              onChange={e => setTargetVersion(e.target.value)}
              placeholder="0.2.0"
              className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 font-mono focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
            <p className="text-xs text-gray-400 mt-1">
              {isPt ? `Versão atual: v${contract.version}` : `Versión actual: v${contract.version}`}
            </p>
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {isPt ? 'Cancelar' : 'Cancelar'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !title.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#FF6200,#E05200)' }}
          >
            {submitting
              ? (isPt ? 'Enviando...' : 'Enviando...')
              : (isPt ? 'Criar solicitação' : 'Crear solicitud')}
          </button>
        </div>
      </div>
    </div>
  );
}
