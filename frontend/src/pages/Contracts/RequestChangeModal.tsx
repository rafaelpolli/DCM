import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRequest } from '../../api/dcm';
import { useAuthStore } from '../../store/authStore';
import { showToast } from '../../components/shared/Toast';
import type { Contract, RequestType, FieldSchema, SLA, DQRule, PiiLevel } from '../../types/dcm';
import { useT } from '../../hooks/useT';

interface Props {
  contract: Contract;
  onClose: () => void;
}

interface ChangeOp {
  op: 'add' | 'remove' | 'modify';
  field: string;
  old: unknown;
  new: unknown;
}

const TYPES: { value: RequestType; labelPt: string; labelEs: string }[] = [
  { value: 'AMEND',          labelPt: 'Emenda geral',         labelEs: 'Enmienda general' },
  { value: 'SCHEMA_CHANGE',  labelPt: 'Mudança de schema',    labelEs: 'Cambio de esquema' },
  { value: 'SLA_CHANGE',     labelPt: 'Mudança de SLA',       labelEs: 'Cambio de SLA' },
  { value: 'QUALITY_CHANGE', labelPt: 'Mudança de qualidade', labelEs: 'Cambio de calidad' },
  { value: 'UPDATE',         labelPt: 'Atualização',          labelEs: 'Actualización' },
  { value: 'DEPRECATE',      labelPt: 'Depreciar contrato',   labelEs: 'Despreciar contrato' },
  { value: 'DELETE',         labelPt: 'Excluir contrato',     labelEs: 'Eliminar contrato' },
];

const PII_OPTIONS: PiiLevel[] = ['NONE', 'EMAIL', 'PHONE', 'CPF', 'CNPJ', 'ADDRESS', 'FULL_NAME'];
const TYPE_OPTIONS = ['STRING', 'INTEGER', 'BIGINT', 'DECIMAL', 'BOOLEAN', 'DATE', 'TIMESTAMP', 'JSON'];
const SEVERITY_OPTIONS: DQRule['severity'][] = ['CRITICAL', 'ALERT'];

function bumpMinor(v: string): string {
  const parts = v.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return '0.1.0';
  parts[1] += 1;
  parts[2] = 0;
  return parts.join('.');
}

function emptyField(): FieldSchema {
  return { name: '', type: 'STRING', description: '', nullable: true, pii: 'NONE', partition_key: false, business_key: false };
}

function emptyRule(): DQRule {
  return { category: 'COMPLETENESS', check: 'not_null', column: '', params: {}, severity: 'ALERT' };
}

function diffSLA(oldSla: SLA, newSla: SLA): ChangeOp[] {
  const ops: ChangeOp[] = [];
  (Object.keys(newSla) as (keyof SLA)[]).forEach(k => {
    if (oldSla[k] !== newSla[k]) {
      ops.push({ op: 'modify', field: `sla.${k}`, old: oldSla[k], new: newSla[k] });
    }
  });
  return ops;
}

function diffFields(oldFields: FieldSchema[], newFields: FieldSchema[]): ChangeOp[] {
  const ops: ChangeOp[] = [];
  const oldByName = new Map(oldFields.map(f => [f.name, f]));
  const newByName = new Map(newFields.filter(f => f.name.trim()).map(f => [f.name, f]));

  oldByName.forEach((f, name) => {
    if (!newByName.has(name)) ops.push({ op: 'remove', field: `fields.${name}`, old: f, new: null });
  });
  newByName.forEach((f, name) => {
    const prev = oldByName.get(name);
    if (!prev) {
      ops.push({ op: 'add', field: `fields.${name}`, old: null, new: f });
    } else {
      (Object.keys(f) as (keyof FieldSchema)[]).forEach(k => {
        if (prev[k] !== f[k]) {
          ops.push({ op: 'modify', field: `fields.${name}.${k}`, old: prev[k], new: f[k] });
        }
      });
    }
  });
  return ops;
}

function diffRules(oldRules: DQRule[], newRules: DQRule[]): ChangeOp[] {
  const ops: ChangeOp[] = [];
  const key = (r: DQRule) => `${r.category}:${r.check}:${r.column}`;
  const oldByKey = new Map(oldRules.map(r => [key(r), r]));
  const newByKey = new Map(newRules.filter(r => r.column.trim()).map(r => [key(r), r]));

  oldByKey.forEach((r, k) => {
    if (!newByKey.has(k)) ops.push({ op: 'remove', field: `data_quality.${k}`, old: r, new: null });
  });
  newByKey.forEach((r, k) => {
    if (!oldByKey.has(k)) ops.push({ op: 'add', field: `data_quality.${k}`, old: null, new: r });
    else if (oldByKey.get(k)?.severity !== r.severity) {
      ops.push({ op: 'modify', field: `data_quality.${k}.severity`, old: oldByKey.get(k)?.severity, new: r.severity });
    }
  });
  return ops;
}

export function RequestChangeModal({ contract, onClose }: Props) {
  const { token } = useAuthStore();
  const navigate = useNavigate();
  const t = useT();
  const isPt = t.requestDetail.back === 'Solicitações';

  const [type, setType] = useState<RequestType>('AMEND');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetVersion, setTargetVersion] = useState(bumpMinor(contract.version));

  const [sla, setSla] = useState<SLA>({ ...contract.sla });
  const [fields, setFields] = useState<FieldSchema[]>(() => contract.fields.map(f => ({ ...f })));
  const [rules, setRules] = useState<DQRule[]>(() => (contract.data_quality ?? []).map(r => ({ ...r, params: { ...r.params } })));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const changes = useMemo<ChangeOp[]>(() => {
    if (type === 'SLA_CHANGE') return diffSLA(contract.sla, sla);
    if (type === 'SCHEMA_CHANGE') return diffFields(contract.fields, fields);
    if (type === 'QUALITY_CHANGE') return diffRules(contract.data_quality ?? [], rules);
    return [];
  }, [type, contract.sla, contract.fields, contract.data_quality, sla, fields, rules]);

  const handleSubmit = async () => {
    if (!token) return;
    if (!title.trim()) {
      setError(isPt ? 'Título obrigatório.' : 'Título obligatorio.');
      return;
    }
    const editorTypes: RequestType[] = ['SCHEMA_CHANGE', 'SLA_CHANGE', 'QUALITY_CHANGE'];
    if (editorTypes.includes(type) && changes.length === 0) {
      setError(isPt ? 'Faça pelo menos uma alteração.' : 'Realice al menos un cambio.');
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
        changes,
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

  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100';
  const smallCls = 'bg-white border border-gray-200 rounded px-1.5 py-1 text-xs text-gray-900 focus:outline-none focus:border-orange-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              {isPt ? 'Solicitar alteração' : 'Solicitar cambio'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5 font-mono">{contract.name} · v{contract.version}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Type / title / version row */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {isPt ? 'Tipo' : 'Tipo'} <span className="text-red-500">*</span>
              </label>
              <select value={type} onChange={e => setType(e.target.value as RequestType)} className={inputCls}>
                {TYPES.map(opt => (
                  <option key={opt.value} value={opt.value}>{isPt ? opt.labelPt : opt.labelEs}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">
                {isPt ? 'Título' : 'Título'} <span className="text-red-500">*</span>
              </label>
              <input
                type="text" value={title} onChange={e => setTitle(e.target.value)}
                placeholder={isPt ? 'Ex: Adicionar campo customer_segment' : 'Ej: Agregar campo customer_segment'}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {isPt ? 'Descrição / justificativa' : 'Descripción / justificación'}
            </label>
            <textarea
              value={description} onChange={e => setDescription(e.target.value)} rows={3}
              placeholder={isPt ? 'Descreva o que muda e por quê...' : 'Describe qué cambia y por qué...'}
              className={`${inputCls} resize-none`}
            />
          </div>

          <div className="w-48">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {isPt ? 'Versão alvo' : 'Versión objetivo'}
            </label>
            <input type="text" value={targetVersion} onChange={e => setTargetVersion(e.target.value)}
              placeholder="0.2.0" className={`${inputCls} font-mono`} />
            <p className="text-xs text-gray-400 mt-1">
              {isPt ? `Atual: v${contract.version}` : `Actual: v${contract.version}`}
            </p>
          </div>

          {/* SLA editor */}
          {type === 'SLA_CHANGE' && (
            <div className="border-t border-gray-100 pt-4">
              <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">SLA</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">{isPt ? 'Frescor' : 'Frescura'}</label>
                  <select value={sla.freshness} onChange={e => setSla({ ...sla, freshness: e.target.value })} className={inputCls}>
                    {['hourly', 'daily', 'weekly', 'monthly'].map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">{isPt ? 'Latência máx (min)' : 'Latencia máx (min)'}</label>
                  <input type="number" value={sla.max_latency_minutes}
                    onChange={e => setSla({ ...sla, max_latency_minutes: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">{isPt ? 'Disponibilidade (%)' : 'Disponibilidad (%)'}</label>
                  <input type="number" step="0.1" value={sla.availability_percent}
                    onChange={e => setSla({ ...sla, availability_percent: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">{isPt ? 'Retenção (dias)' : 'Retención (días)'}</label>
                  <input type="number" value={sla.retention_days}
                    onChange={e => setSla({ ...sla, retention_days: Number(e.target.value) })} className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-600 mb-1">{isPt ? 'Email de alerta' : 'Email de alerta'}</label>
                  <input type="email" value={sla.alert_email}
                    onChange={e => setSla({ ...sla, alert_email: e.target.value })} className={inputCls} />
                </div>
              </div>
            </div>
          )}

          {/* Schema editor */}
          {type === 'SCHEMA_CHANGE' && (
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">{isPt ? 'Campos' : 'Campos'}</h3>
                <button onClick={() => setFields([...fields, emptyField()])}
                  className="text-xs text-orange-600 hover:text-orange-700 font-semibold">
                  + {isPt ? 'Adicionar campo' : 'Agregar campo'}
                </button>
              </div>
              <div className="space-y-1">
                <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-gray-500 px-1">
                  <div className="col-span-3">{isPt ? 'Nome' : 'Nombre'}</div>
                  <div className="col-span-2">{isPt ? 'Tipo' : 'Tipo'}</div>
                  <div className="col-span-2">PII</div>
                  <div className="col-span-1">Null</div>
                  <div className="col-span-1">PK</div>
                  <div className="col-span-1">BK</div>
                  <div className="col-span-2"></div>
                </div>
                {fields.map((f, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded p-1.5">
                    <input value={f.name} onChange={e => { const n = [...fields]; n[i] = { ...f, name: e.target.value }; setFields(n); }}
                      placeholder="field_name" className={`${smallCls} col-span-3 font-mono`} />
                    <select value={f.type} onChange={e => { const n = [...fields]; n[i] = { ...f, type: e.target.value }; setFields(n); }}
                      className={`${smallCls} col-span-2`}>
                      {TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <select value={f.pii} onChange={e => { const n = [...fields]; n[i] = { ...f, pii: e.target.value as PiiLevel }; setFields(n); }}
                      className={`${smallCls} col-span-2`}>
                      {PII_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <input type="checkbox" checked={f.nullable}
                      onChange={e => { const n = [...fields]; n[i] = { ...f, nullable: e.target.checked }; setFields(n); }}
                      className="col-span-1 w-4 h-4 accent-orange-500" />
                    <input type="checkbox" checked={f.partition_key}
                      onChange={e => { const n = [...fields]; n[i] = { ...f, partition_key: e.target.checked }; setFields(n); }}
                      className="col-span-1 w-4 h-4 accent-orange-500" />
                    <input type="checkbox" checked={f.business_key}
                      onChange={e => { const n = [...fields]; n[i] = { ...f, business_key: e.target.checked }; setFields(n); }}
                      className="col-span-1 w-4 h-4 accent-orange-500" />
                    <button onClick={() => setFields(fields.filter((_, idx) => idx !== i))}
                      className="col-span-2 text-xs text-red-500 hover:text-red-700">{isPt ? 'Remover' : 'Eliminar'}</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quality editor */}
          {type === 'QUALITY_CHANGE' && (
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">{isPt ? 'Regras de qualidade' : 'Reglas de calidad'}</h3>
                <button onClick={() => setRules([...rules, emptyRule()])}
                  className="text-xs text-orange-600 hover:text-orange-700 font-semibold">
                  + {isPt ? 'Adicionar regra' : 'Agregar regla'}
                </button>
              </div>
              <div className="space-y-1">
                <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-gray-500 px-1">
                  <div className="col-span-3">{isPt ? 'Categoria' : 'Categoría'}</div>
                  <div className="col-span-3">Check</div>
                  <div className="col-span-3">{isPt ? 'Coluna' : 'Columna'}</div>
                  <div className="col-span-2">{isPt ? 'Severidade' : 'Severidad'}</div>
                  <div className="col-span-1"></div>
                </div>
                {rules.map((r, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded p-1.5">
                    <input value={r.category} onChange={e => { const n = [...rules]; n[i] = { ...r, category: e.target.value }; setRules(n); }}
                      className={`${smallCls} col-span-3 font-mono uppercase`} />
                    <input value={r.check} onChange={e => { const n = [...rules]; n[i] = { ...r, check: e.target.value }; setRules(n); }}
                      placeholder="not_null" className={`${smallCls} col-span-3 font-mono`} />
                    <input value={r.column} onChange={e => { const n = [...rules]; n[i] = { ...r, column: e.target.value }; setRules(n); }}
                      placeholder="column_name" className={`${smallCls} col-span-3 font-mono`} />
                    <select value={r.severity} onChange={e => { const n = [...rules]; n[i] = { ...r, severity: e.target.value as DQRule['severity'] }; setRules(n); }}
                      className={`${smallCls} col-span-2`}>
                      {SEVERITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <button onClick={() => setRules(rules.filter((_, idx) => idx !== i))}
                      className="col-span-1 text-xs text-red-500 hover:text-red-700">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Diff preview */}
          {(type === 'SCHEMA_CHANGE' || type === 'SLA_CHANGE' || type === 'QUALITY_CHANGE') && (
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-500">
                {changes.length === 0
                  ? (isPt ? 'Nenhuma alteração detectada.' : 'Sin cambios detectados.')
                  : (isPt
                      ? `${changes.length} alteração(ões) detectada(s).`
                      : `${changes.length} cambio(s) detectado(s).`)}
              </p>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors disabled:opacity-50">
            {isPt ? 'Cancelar' : 'Cancelar'}
          </button>
          <button onClick={handleSubmit} disabled={submitting || !title.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#FF6200,#E05200)' }}>
            {submitting ? (isPt ? 'Enviando...' : 'Enviando...') : (isPt ? 'Criar solicitação' : 'Crear solicitud')}
          </button>
        </div>
      </div>
    </div>
  );
}
