import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createContract, fetchContracts } from '../../api/dcm';
import { useAuthStore } from '../../store/authStore';
import { showToast } from '../../components/shared/Toast';
import type { Contract } from '../../types/dcm';

// ── Local types ───────────────────────────────────────────────────────────────

type FieldDraft = { name: string; type: string; nullable: boolean; pii: string; desc: string };

type DQParam = {
  key: string; label: string;
  type: 'number' | 'text' | 'select' | 'textarea';
  ph?: string; opts?: string[];
};
type DQCheckDef = { label: string; col: boolean; params: DQParam[] };
type DQRule = { category: string; check: string; column: string; params: Record<string, string>; severity: 'CRITICAL' | 'ALERT' };
type DepTable = { table: string; contract_id: string };

const FIELD_TYPES = ['STRING','INTEGER','BIGINT','DECIMAL','FLOAT','BOOLEAN','DATE','TIMESTAMP','MAP','ARRAY'];
const PII_TYPES   = ['NONE','CPF','EMAIL','NAME','PHONE','IP','DATE'];

// ── DQ check catalogue ────────────────────────────────────────────────────────

const DQ: Record<string, Record<string, DQCheckDef>> = {
  'Volume': {
    'row_count': { label: 'Contagem de linhas', col: false, params: [
      { key: 'min', label: 'Mínimo', type: 'number', ph: '1000' },
      { key: 'max', label: 'Máximo', type: 'number', ph: 'opcional' },
    ]},
  },
  'Completude': {
    'missing_count':   { label: 'Qtd valores ausentes',     col: true, params: [{ key: 'max',     label: 'Máx ausentes',          type: 'number', ph: '0' }] },
    'missing_percent': { label: '% valores ausentes',       col: true, params: [{ key: 'max_pct', label: 'Máx % ausente (0-100)', type: 'number', ph: '5' }] },
    'missing_values':  { label: 'Valores tratados como nulo', col: true, params: [{ key: 'values', label: 'Valores (vírgula)',       type: 'text',   ph: 'N/A, null, -' }] },
    'missing_regex':   { label: 'Regex de ausência',        col: true, params: [{ key: 'regex',   label: 'Regex',                 type: 'text',   ph: '^\\s*$' }] },
  },
  'Unicidade': {
    'duplicate_count':   { label: 'Qtd duplicatas', col: true, params: [{ key: 'max',     label: 'Máx duplicatas', type: 'number', ph: '0' }] },
    'duplicate_percent': { label: '% duplicatas',   col: true, params: [{ key: 'max_pct', label: 'Máx % (0-100)', type: 'number', ph: '0' }] },
  },
  'Validade': {
    'valid_format':     { label: 'Formato padrão',           col: true, params: [{ key: 'format',     label: 'Formato',     type: 'select', opts: ['email','phone','uuid','ip_address','date','time','datetime','integer','decimal','credit_card','ssn'] }] },
    'valid_regex':      { label: 'Regex customizado',        col: true, params: [{ key: 'regex',      label: 'Regex válido', type: 'text',   ph: '' }] },
    'valid_values':     { label: 'Enum de valores aceitos',  col: true, params: [{ key: 'values',     label: 'Valores aceitos (vírgula)',   type: 'text', ph: 'ACTIVE, INACTIVE' }] },
    'invalid_values':   { label: 'Valores proibidos',        col: true, params: [{ key: 'values',     label: 'Valores proibidos (vírgula)', type: 'text', ph: 'NULL, N/A' }] },
    'valid_min':        { label: 'Valor mínimo numérico',    col: true, params: [{ key: 'min',        label: 'Mínimo',      type: 'number', ph: '0' }] },
    'valid_max':        { label: 'Valor máximo numérico',    col: true, params: [{ key: 'max',        label: 'Máximo',      type: 'number', ph: '' }] },
    'valid_min_length': { label: 'Tamanho mínimo (string)',  col: true, params: [{ key: 'min_length', label: 'Mínimo chars', type: 'number', ph: '1' }] },
    'valid_max_length': { label: 'Tamanho máximo (string)',  col: true, params: [{ key: 'max_length', label: 'Máximo chars', type: 'number', ph: '255' }] },
  },
  'Distribuição': {
    'min':        { label: 'Mínimo da coluna', col: true, params: [{ key: 'threshold', label: 'Threshold mínimo', type: 'number', ph: '' }] },
    'max':        { label: 'Máximo da coluna', col: true, params: [{ key: 'threshold', label: 'Threshold máximo', type: 'number', ph: '' }] },
    'avg':        { label: 'Média da coluna',  col: true, params: [{ key: 'min', label: 'Média mínima', type: 'number', ph: '' }, { key: 'max', label: 'Média máxima', type: 'number', ph: '' }] },
    'sum':        { label: 'Soma da coluna',   col: true, params: [{ key: 'min', label: 'Soma mínima',  type: 'number', ph: '' }, { key: 'max', label: 'Soma máxima',  type: 'number', ph: '' }] },
    'stddev':     { label: 'Desvio padrão',    col: true, params: [{ key: 'max', label: 'Desvio máximo',    type: 'number', ph: '' }] },
    'variance':   { label: 'Variância',        col: true, params: [{ key: 'max', label: 'Variância máxima', type: 'number', ph: '' }] },
    'percentile': { label: 'Percentil',        col: true, params: [
      { key: 'percentile', label: 'Percentil',       type: 'select', opts: ['p25','p50','p75','p95','p99'] },
      { key: 'threshold',  label: 'Valor threshold', type: 'number', ph: '' },
    ]},
  },
  'Frescor': {
    'freshness': { label: 'Frescor dos dados', col: true, params: [{ key: 'max_age', label: 'Idade máxima (ex: 8h, 1d, 7d)', type: 'text', ph: '24h' }] },
  },
  'Schema': {
    'schema_column_exists': { label: 'Colunas obrigatórias existem', col: false, params: [{ key: 'columns',       label: 'Colunas (vírgula)',          type: 'text', ph: 'id, name, created_at' }] },
    'schema_column_type':   { label: 'Tipo de coluna correto',       col: true,  params: [{ key: 'expected_type', label: 'Tipo esperado',              type: 'text', ph: 'STRING' }] },
    'schema_no_extra':      { label: 'Sem colunas extras',           col: false, params: [{ key: 'columns',       label: 'Colunas permitidas (vírgula)', type: 'text', ph: '' }] },
  },
  'Integridade Referencial': {
    'reference': { label: 'Integridade referencial', col: true, params: [
      { key: 'ref_dataset', label: 'Dataset referência', type: 'text', ph: 'harm.tb_customers' },
      { key: 'ref_column',  label: 'Coluna referência',  type: 'text', ph: 'customer_id' },
    ]},
  },
  'SQL Customizado': {
    'failed_rows':  { label: 'Linhas inválidas (SQL)',       col: false, params: [{ key: 'sql',       label: 'SQL (retorna linhas inválidas)',    type: 'textarea', ph: 'SELECT * FROM {table} WHERE amount < 0' }] },
    'user_defined': { label: 'Métrica customizada (SQL)',    col: false, params: [
      { key: 'sql',       label: 'SQL (retorna número)',  type: 'textarea', ph: "SELECT COUNT(*) FROM {table} WHERE status IS NULL" },
      { key: 'threshold', label: 'Threshold',            type: 'number',   ph: '0' },
    ]},
  },
};

const STEP_LABELS = ['Identificação', 'Localização & SLA', 'Schema', 'Data Quality', 'Lógica de Negócio'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function inferType(val: unknown): string {
  if (typeof val === 'boolean') return 'BOOLEAN';
  if (typeof val === 'number') return Number.isInteger(val) ? 'BIGINT' : 'DECIMAL';
  if (Array.isArray(val)) return 'ARRAY';
  if (typeof val === 'object' && val !== null) return 'MAP';
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T/.test(val)) return 'TIMESTAMP';
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return 'DATE';
  }
  return 'STRING';
}

function inferFields(obj: unknown): FieldDraft[] {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, unknown>).map(([k, v]) => ({
    name: k, type: inferType(v), nullable: true, pii: 'NONE', desc: '',
  }));
}

const inpCls = 'w-full bg-gray-50 border border-gray-300 text-gray-800 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500';
const selCls = `${inpCls} cursor-pointer`;

// ── Component ─────────────────────────────────────────────────────────────────

export function ContractCreatePage() {
  const { token } = useAuthStore();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [isSpec, setIsSpec] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [allContracts, setAllContracts] = useState<Contract[]>([]);

  const [form, setForm] = useState({
    name: '', description: '', domain: '', team: '', owner: '', source_system: '',
    data_classification: 'INTERNAL', tags: '',
    layer: 'RAW', fmt: 'PARQUET', bucket: '', path: '', compression: 'SNAPPY',
    freshness: 'daily', max_latency_minutes: 60, availability_percent: 99.0,
    retention_days: 365, alert_email: '',
    partition_strategy: 'DATE', partition_column: '',
    business_logic_sql: '',
  });

  const [fields, setFields] = useState<FieldDraft[]>([{ name: '', type: 'STRING', nullable: true, pii: 'NONE', desc: '' }]);
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [nameFromImport, setNameFromImport] = useState('');

  const [pairedContractId, setPairedContractId] = useState('');

  const [dqRules, setDqRules] = useState<DQRule[]>([]);
  const [showDQForm, setShowDQForm] = useState(false);
  const [dqCategory, setDqCategory] = useState('');
  const [dqCheck, setDqCheck] = useState('');
  const [dqColumn, setDqColumn] = useState('');
  const [dqParams, setDqParams] = useState<Record<string, string>>({});
  const [selectedSev, setSelectedSev] = useState<'CRITICAL' | 'ALERT'>('ALERT');

  const [depTables, setDepTables] = useState<DepTable[]>([]);

  useEffect(() => {
    if (!token) return;
    fetchContracts(token).then(d => setAllContracts(d.contracts)).catch(() => {});
  }, [token]);

  const update = (key: string, value: unknown) => setForm(f => ({ ...f, [key]: value }));

  const handleLayerChange = (val: string) => {
    update('layer', val);
    setIsSpec(val === 'SPEC');
    setPairedContractId('');
  };

  const totalSteps = isSpec ? 5 : 4;

  const goStep = (n: number) => setStep(n);

  // ── Event schema import ──

  const parseImport = () => {
    const raw = importJson.trim();
    if (!raw) return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { alert('JSON inválido. Verifique o conteúdo.'); return; }

    let payload: unknown = parsed;
    let metaSource = '';
    let metaName = '';

    if (typeof parsed === 'object' && parsed !== null && 'Records' in (parsed as object)) {
      const records = (parsed as { Records: unknown[] }).Records;
      if (records.length > 0) {
        const rec = records[0] as Record<string, unknown>;
        if (rec.Sns) {
          const sns = rec.Sns as Record<string, string>;
          metaSource = 'SNS';
          metaName = (sns.TopicArn || '').split(':').pop() || '';
          try { payload = JSON.parse(sns.Message || '{}'); } catch { payload = sns; }
        } else if (rec.body) {
          metaSource = 'SQS';
          try { payload = JSON.parse(rec.body as string); } catch { payload = { body: rec.body }; }
        }
      }
    } else if (typeof parsed === 'object' && parsed !== null && 'detail' in (parsed as object)) {
      const ev = parsed as Record<string, unknown>;
      metaSource = 'EventBridge';
      metaName = (ev['detail-type'] as string) || '';
      payload = ev.detail;
    }

    const inferred = inferFields(payload);
    setFields(inferred.length ? inferred : [{ name: '', type: 'STRING', nullable: true, pii: 'NONE', desc: '' }]);
    setImportNotice(`Schema importado: ${inferred.length} campo(s) inferido(s).`);
    setShowImport(false);
    if (metaSource && !form.source_system) update('source_system', metaSource);
    if (metaName) setNameFromImport(metaName.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    goStep(3);
  };

  // ── Schema rows ──

  const addRow = () => setFields(f => [...f, { name: '', type: 'STRING', nullable: true, pii: 'NONE', desc: '' }]);
  const removeRow = (i: number) => setFields(f => f.filter((_, j) => j !== i));
  const updateField = (i: number, key: keyof FieldDraft, val: unknown) =>
    setFields(f => f.map((fd, j) => j === i ? { ...fd, [key]: val } : fd));

  // ── DQ builder ──

  const dqCheckDef = dqCategory && dqCheck ? DQ[dqCategory]?.[dqCheck] : null;

  const handleDQCategoryChange = (cat: string) => {
    setDqCategory(cat);
    setDqCheck('');
    setDqColumn('');
    setDqParams({});
  };

  const handleDQCheckChange = (chk: string) => {
    setDqCheck(chk);
    setDqColumn('');
    setDqParams({});
  };

  const addDQRule = () => {
    if (!dqCategory || !dqCheck) { alert('Selecione categoria e check.'); return; }
    const def = DQ[dqCategory]?.[dqCheck];
    if (!def) return;
    if (def.col && !dqColumn) { alert('Selecione uma coluna. Se não há opções, defina os campos no Step 3 primeiro.'); return; }
    setDqRules(r => [...r, { category: dqCategory, check: dqCheck, column: dqColumn, params: { ...dqParams }, severity: selectedSev }]);
    setShowDQForm(false);
    setDqCategory(''); setDqCheck(''); setDqColumn(''); setDqParams({});
  };

  const removeDQRule = (i: number) => setDqRules(r => r.filter((_, j) => j !== i));

  const schemaFieldNames = fields.map(f => f.name.trim()).filter(Boolean);

  // ── Submit ──

  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const body = {
        name: form.name || nameFromImport,
        description: form.description,
        domain: form.domain,
        team: form.team,
        owner: form.owner,
        source_system: form.source_system,
        data_classification: form.data_classification,
        tags: form.tags,
        layer: form.layer as 'RAW' | 'BRONZE' | 'SILVER' | 'GOLD',
        bucket: form.bucket,
        path: form.path,
        fmt: form.fmt as 'PARQUET' | 'AVRO' | 'ORC' | 'JSON' | 'CSV' | 'DELTA',
        compression: form.compression as 'NONE' | 'SNAPPY' | 'ZSTD' | 'GZIP',
        freshness: form.freshness,
        max_latency_minutes: form.max_latency_minutes,
        availability_percent: form.availability_percent,
        retention_days: form.retention_days,
        alert_email: form.alert_email,
        partition_strategy: form.partition_strategy as 'NONE' | 'DATE' | 'HOUR' | 'CUSTOM',
        partition_column: form.partition_column,
        partition_format: 'YYYY-MM-DD',
        pruning_enabled: true,
        fields: fields.filter(f => f.name.trim()).map(f => ({
          name: f.name, type: f.type, nullable: f.nullable, pii: f.pii as 'NONE' | 'EMAIL' | 'PHONE' | 'CPF' | 'CNPJ' | 'ADDRESS' | 'FULL_NAME',
          description: f.desc, partition_key: false, business_key: false,
        })),
        dq_rules: dqRules,
        paired_contract_id: pairedContractId,
        business_logic_sql: form.business_logic_sql,
        dep_tables: depTables,
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await createContract(token!, body as any);
      showToast('Contrato criado com sucesso!');
      navigate(`/contracts/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao criar contrato');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 4 next: if SPEC go to 5, else submit ──
  const step4Next = () => {
    if (isSpec) goStep(5);
    else handleSubmit();
  };

  // ── Pairing candidates ──
  const pairingCandidates = allContracts.filter(c => {
    if (form.layer === 'RAW') return (c.location as { layer: string }).layer === 'HARM';
    if (form.layer === 'HARM') return (c.location as { layer: string }).layer === 'RAW';
    return false;
  });

  // ── Step indicator ──
  const StepIndicator = () => (
    <div className="flex items-center gap-1 mb-8 overflow-x-auto pb-1">
      {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => {
        const done = step > n, active = step === n;
        return (
          <div key={n} className="flex items-center gap-1.5 shrink-0">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
              done ? 'text-white' : active ? 'text-white' : 'bg-gray-200 text-gray-500'
            }`} style={done ? { background: '#16a34a' } : active ? { background: '#185FA5' } : {}}>
              {done ? '✓' : n}
            </div>
            <span className={`text-xs hidden sm:inline whitespace-nowrap ${active ? 'text-gray-800 font-semibold' : 'text-gray-400'}`}>
              {STEP_LABELS[n - 1]}
            </span>
            {n < totalSteps && <div className="flex-1 h-px bg-gray-200 min-w-3 w-6" />}
          </div>
        );
      })}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
        <Link to="/contracts" className="text-gray-500 hover:text-gray-900">Contratos</Link>
        <span className="text-gray-400"> / </span>
        <span className="text-gray-700">Novo Contrato</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Novo Contrato</h1>
        <p className="text-sm text-gray-500 mt-1">Preencha as informações em etapas</p>
      </div>

      <StepIndicator />

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">{error}</div>
      )}

      {/* ── STEP 1: Identificação ── */}
      {step === 1 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {/* Import banner */}
          <div className="bg-blue-50 border-b border-blue-100 px-6 py-3 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-blue-700">Importar schema de evento</span>
              <span className="text-xs text-blue-400 ml-2">SNS · SQS · EventBridge · JSON livre</span>
            </div>
            <button type="button" onClick={() => setShowImport(v => !v)}
              className="text-xs font-medium text-blue-600 border border-blue-300 bg-white hover:bg-blue-50 rounded-lg px-3 py-1.5 transition-colors">
              Importar evento →
            </button>
          </div>

          {showImport && (
            <div className="bg-blue-50/40 border-b border-blue-100 px-6 py-4">
              <p className="text-xs text-gray-500 mb-2">Cole o payload do evento. O schema é inferido e preenchido no Step 3.</p>
              <textarea value={importJson} onChange={e => setImportJson(e.target.value)} rows={7}
                placeholder='{"event_id": "uuid-123", "user_id": "456", "amount": 99.90, "created_at": "2024-01-01T00:00:00Z"}'
                className="w-full bg-white border border-gray-300 text-gray-800 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-blue-500 resize-none" />
              <div className="flex items-center gap-2 mt-2">
                <button type="button" onClick={parseImport}
                  className="text-xs font-medium text-white rounded-lg px-4 py-1.5" style={{ background: '#185FA5' }}>
                  Inferir schema
                </button>
                <button type="button" onClick={() => setShowImport(false)}
                  className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1.5">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <div className="p-6 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Etapa 1 — Identificação</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1.5">Nome da tabela *</label>
                <input value={form.name || nameFromImport} onChange={e => { update('name', e.target.value); setNameFromImport(''); }}
                  required placeholder="ex: tb_orders_raw" className={`${inpCls} font-mono`} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1.5">Descrição</label>
                <textarea value={form.description} onChange={e => update('description', e.target.value)} rows={2}
                  placeholder="Descreva o propósito desta tabela..."
                  className="w-full bg-gray-50 border border-gray-300 text-gray-800 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 resize-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Domínio</label>
                <input value={form.domain} onChange={e => update('domain', e.target.value)}
                  placeholder="ex: Commerce" className={inpCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Time</label>
                <input value={form.team} onChange={e => update('team', e.target.value)}
                  placeholder="ex: Data Engineering" className={inpCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Owner</label>
                <input value={form.owner} onChange={e => update('owner', e.target.value)}
                  placeholder="ex: ana.silva@empresa.com" className={`${inpCls} font-mono`} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Sistema de origem</label>
                <input value={form.source_system} onChange={e => update('source_system', e.target.value)}
                  placeholder="ex: OMS, ERP, SNS" className={inpCls} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Classificação</label>
                <select value={form.data_classification} onChange={e => update('data_classification', e.target.value)} className={selCls}>
                  {['PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED'].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Tags (separadas por vírgula)</label>
                <input value={form.tags} onChange={e => update('tags', e.target.value)}
                  placeholder="ex: raw, commerce, orders" className={`${inpCls} font-mono`} />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button type="button" onClick={() => goStep(2)}
                className="px-5 py-2 rounded-lg text-sm font-medium text-white" style={{ background: '#185FA5' }}>
                Próximo →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: Localização & SLA ── */}
      {step === 2 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Etapa 2 — Localização & SLA</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Layer</label>
              <select value={form.layer} onChange={e => handleLayerChange(e.target.value)} className={selCls}>
                <optgroup label="Arquitetura Medalhão">
                  <option value="RAW">SOR — RAW (Fonte bruta)</option>
                  <option value="HARM">SOT — HARM (Harmonizado)</option>
                  <option value="SPEC">SPEC (Especializado / Negócio)</option>
                </optgroup>
                <optgroup label="Outras camadas">
                  <option value="BRONZE">BRONZE</option>
                  <option value="SILVER">SILVER</option>
                  <option value="GOLD">GOLD</option>
                </optgroup>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Formato</label>
              <select value={form.fmt} onChange={e => update('fmt', e.target.value)} className={selCls}>
                {['PARQUET','DELTA','JSON','CSV','ORC','AVRO'].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>

            {/* Pairing section (RAW / HARM) */}
            {(form.layer === 'RAW' || form.layer === 'HARM') && (
              <div className="md:col-span-2">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
                    </svg>
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-amber-700 mb-1">
                        {form.layer === 'RAW' ? 'Vinculação SOR → SOT' : 'Vinculação SOT → SOR'}
                      </p>
                      <p className="text-xs text-amber-600 mb-2">
                        Selecione o contrato {form.layer === 'RAW' ? 'SOT (HARM)' : 'SOR (RAW)'} correspondente.
                      </p>
                      <select value={pairedContractId} onChange={e => setPairedContractId(e.target.value)}
                        className="w-full bg-white border border-amber-300 text-gray-800 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500">
                        <option value="">— Sem vinculação —</option>
                        {pairingCandidates.map(c => (
                          <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SPEC notice */}
            {form.layer === 'SPEC' && (
              <div className="md:col-span-2">
                <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-3 flex items-center gap-3">
                  <svg className="w-4 h-4 text-purple-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  <p className="text-xs text-purple-700">Camada <strong>SPEC</strong> — etapa extra de <strong>Lógica de Negócio</strong> habilitada no Step 5.</p>
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Bucket</label>
              <input value={form.bucket} onChange={e => update('bucket', e.target.value)}
                placeholder="ex: s3://datalake-prod" className={`${inpCls} font-mono`} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Path</label>
              <input value={form.path} onChange={e => update('path', e.target.value)}
                placeholder="ex: /raw/commerce/orders/" className={`${inpCls} font-mono`} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Compressão</label>
              <select value={form.compression} onChange={e => update('compression', e.target.value)} className={selCls}>
                {['SNAPPY','GZIP','ZSTD','NONE'].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Freshness</label>
              <select value={form.freshness} onChange={e => update('freshness', e.target.value)} className={selCls}>
                {['real-time','hourly','daily','weekly'].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Latência máxima (min)</label>
              <input type="number" value={form.max_latency_minutes} onChange={e => update('max_latency_minutes', Number(e.target.value))} className={inpCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Disponibilidade (%)</label>
              <input type="number" step="0.1" value={form.availability_percent} onChange={e => update('availability_percent', Number(e.target.value))} className={inpCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Retenção (dias)</label>
              <input type="number" value={form.retention_days} onChange={e => update('retention_days', Number(e.target.value))} className={inpCls} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">E-mail de alerta</label>
              <input type="email" value={form.alert_email} onChange={e => update('alert_email', e.target.value)}
                placeholder="team@empresa.com" className={`${inpCls} font-mono`} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Estratégia de particionamento</label>
              <select value={form.partition_strategy} onChange={e => update('partition_strategy', e.target.value)} className={selCls}>
                {['DATE','DATE_HOUR','MONTH','YEAR','NONE'].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Coluna de partição</label>
              <input value={form.partition_column} onChange={e => update('partition_column', e.target.value)}
                placeholder="ex: order_date" className={`${inpCls} font-mono`} />
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => goStep(1)}
              className="px-5 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-100">
              ← Anterior
            </button>
            <button type="button" onClick={() => goStep(3)}
              className="px-5 py-2 rounded-lg text-sm font-medium text-white" style={{ background: '#185FA5' }}>
              Próximo →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Schema ── */}
      {step === 3 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Etapa 3 — Schema</h2>

          {importNotice && (
            <div className="mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 flex items-center gap-2">
              <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/>
              </svg>
              <span className="text-xs text-green-700">{importNotice}</span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-200">
                  <th className="text-left py-2 pr-3">Nome</th>
                  <th className="text-left py-2 pr-3">Tipo</th>
                  <th className="text-left py-2 pr-3">Nullable</th>
                  <th className="text-left py-2 pr-3">PII</th>
                  <th className="text-left py-2 pr-3">Descrição</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 pr-2">
                      <input value={f.name} onChange={e => updateField(i, 'name', e.target.value)}
                        placeholder="campo_id"
                        className="w-32 bg-gray-50 border border-gray-300 text-gray-800 text-xs rounded px-2 py-1.5 font-mono focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="py-2 pr-2">
                      <select value={f.type} onChange={e => updateField(i, 'type', e.target.value)}
                        className="bg-gray-50 border border-gray-300 text-gray-800 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-blue-500">
                        {FIELD_TYPES.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <select value={String(f.nullable)} onChange={e => updateField(i, 'nullable', e.target.value === 'true')}
                        className="bg-gray-50 border border-gray-300 text-gray-800 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-blue-500">
                        <option value="true">NULL</option>
                        <option value="false">NOT NULL</option>
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <select value={f.pii} onChange={e => updateField(i, 'pii', e.target.value)}
                        className="bg-gray-50 border border-gray-300 text-gray-800 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-blue-500">
                        {PII_TYPES.map(p => <option key={p}>{p}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <input value={f.desc} onChange={e => updateField(i, 'desc', e.target.value)}
                        placeholder="descrição..."
                        className="w-48 bg-gray-50 border border-gray-300 text-gray-800 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-blue-500" />
                    </td>
                    <td className="py-2">
                      <button type="button" onClick={() => removeRow(i)}
                        className="text-gray-400 hover:text-red-500 text-xs px-1">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button type="button" onClick={addRow}
            className="mt-3 text-xs text-blue-600 hover:underline flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/>
            </svg>
            Adicionar campo
          </button>

          <div className="flex justify-between mt-6">
            <button type="button" onClick={() => goStep(2)}
              className="px-5 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-100">
              ← Anterior
            </button>
            <button type="button" onClick={() => goStep(4)}
              className="px-5 py-2 rounded-lg text-sm font-medium text-white" style={{ background: '#185FA5' }}>
              Próximo →
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 4: Data Quality ── */}
      {step === 4 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Etapa 4 — Data Quality</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                Regras SodaCore ·{' '}
                <span className="text-red-500 font-semibold">CRÍTICO</span> bloqueia o pipeline ·{' '}
                <span className="text-amber-500 font-semibold">ALERTA</span> só notifica
              </p>
            </div>
            <button type="button" onClick={() => setShowDQForm(v => !v)}
              className="text-xs font-medium text-white rounded-lg px-3 py-1.5 flex items-center gap-1 shrink-0" style={{ background: '#185FA5' }}>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/>
              </svg>
              Adicionar Regra
            </button>
          </div>

          {/* DQ add form */}
          {showDQForm && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Categoria</label>
                  <select value={dqCategory} onChange={e => handleDQCategoryChange(e.target.value)}
                    className="w-full bg-white border border-gray-300 text-gray-800 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
                    <option value="">Selecione...</option>
                    {Object.keys(DQ).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Check</label>
                  <select value={dqCheck} onChange={e => handleDQCheckChange(e.target.value)}
                    className="w-full bg-white border border-gray-300 text-gray-800 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
                    <option value="">Selecione a categoria...</option>
                    {dqCategory && Object.entries(DQ[dqCategory] || {}).map(([k, d]) => (
                      <option key={k} value={k}>{d.label || k}</option>
                    ))}
                  </select>
                </div>
                {dqCheckDef?.col && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Coluna</label>
                    <select value={dqColumn} onChange={e => setDqColumn(e.target.value)}
                      className="w-full bg-white border border-gray-300 text-gray-800 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
                      <option value="">{schemaFieldNames.length ? 'Selecione a coluna...' : '— Defina campos no Step 3 primeiro —'}</option>
                      {schemaFieldNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* DQ params */}
              {dqCheckDef && dqCheckDef.params.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {dqCheckDef.params.map(p => (
                    <div key={p.key}>
                      <label className="block text-xs text-gray-500 mb-1">{p.label}</label>
                      {p.type === 'select' ? (
                        <select value={dqParams[p.key] || ''} onChange={e => setDqParams(prev => ({ ...prev, [p.key]: e.target.value }))}
                          className="w-full bg-white border border-gray-300 text-gray-800 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
                          {p.opts?.map(o => <option key={o}>{o}</option>)}
                        </select>
                      ) : p.type === 'textarea' ? (
                        <textarea value={dqParams[p.key] || ''} onChange={e => setDqParams(prev => ({ ...prev, [p.key]: e.target.value }))}
                          rows={3} placeholder={p.ph || ''}
                          className="w-full bg-white border border-gray-300 text-gray-800 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-blue-500 resize-none" />
                      ) : (
                        <input type={p.type} value={dqParams[p.key] || ''} onChange={e => setDqParams(prev => ({ ...prev, [p.key]: e.target.value }))}
                          placeholder={p.ph || ''}
                          className="w-full bg-white border border-gray-300 text-gray-800 text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Severity */}
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Severidade</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSelectedSev('CRITICAL')}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold border-2 transition-colors"
                    style={selectedSev === 'CRITICAL'
                      ? { background: '#ef4444', color: '#fff', borderColor: '#ef4444' }
                      : { background: '#fff', color: '#6b7280', borderColor: '#d1d5db' }}>
                    CRÍTICO
                  </button>
                  <button type="button" onClick={() => setSelectedSev('ALERT')}
                    className="px-4 py-1.5 rounded-lg text-xs font-bold border-2 transition-colors"
                    style={selectedSev === 'ALERT'
                      ? { background: '#f59e0b', color: '#fff', borderColor: '#f59e0b' }
                      : { background: '#fff', color: '#6b7280', borderColor: '#d1d5db' }}>
                    ALERTA
                  </button>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button type="button" onClick={addDQRule}
                  className="px-4 py-1.5 rounded-lg text-xs font-medium text-white" style={{ background: '#185FA5' }}>
                  + Adicionar à lista
                </button>
                <button type="button" onClick={() => setShowDQForm(false)}
                  className="px-4 py-1.5 rounded-lg text-xs text-gray-500 border border-gray-300 hover:bg-gray-50">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* DQ rules list */}
          {dqRules.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm border border-dashed border-gray-200 rounded-lg">
              Nenhuma regra adicionada. Clique em "Adicionar Regra" para começar.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-200">
                    <th className="pb-2 pr-3 font-medium">Categoria</th>
                    <th className="pb-2 pr-3 font-medium">Check</th>
                    <th className="pb-2 pr-3 font-medium">Coluna</th>
                    <th className="pb-2 pr-3 font-medium">Parâmetros</th>
                    <th className="pb-2 pr-3 font-medium">Severidade</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {dqRules.map((r, i) => {
                    const ps = Object.entries(r.params).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(' · ');
                    const isCrit = r.severity === 'CRITICAL';
                    return (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="py-2 pr-3 text-gray-600">{r.category}</td>
                        <td className="py-2 pr-3 font-mono text-gray-800">{r.check}</td>
                        <td className="py-2 pr-3 font-mono text-gray-500">{r.column || '—'}</td>
                        <td className="py-2 pr-3 text-gray-400">{ps || '—'}</td>
                        <td className="py-2 pr-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold font-mono"
                            style={isCrit ? { color: '#dc2626', background: '#fef2f2' } : { color: '#d97706', background: '#fffbeb' }}>
                            {r.severity}
                          </span>
                        </td>
                        <td className="py-2">
                          <button type="button" onClick={() => removeDQRule(i)}
                            className="text-gray-400 hover:text-red-500">✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-between mt-6">
            <button type="button" onClick={() => goStep(3)}
              className="px-5 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-100">
              ← Anterior
            </button>
            <button type="button" onClick={step4Next} disabled={submitting}
              className="px-6 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ background: '#185FA5' }}>
              {submitting ? 'Criando...' : isSpec ? 'Próximo →' : 'Criar Contrato'}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 5: Lógica de Negócio (SPEC only) ── */}
      {step === 5 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Etapa 5 — Lógica de Negócio</h2>
            <p className="text-xs text-gray-400 mt-0.5">Exclusivo para camada SPEC. Defina o SQL de transformação e as dependências de tabelas.</p>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Script SQL</label>
            <textarea value={form.business_logic_sql} onChange={e => update('business_logic_sql', e.target.value)} rows={12}
              placeholder={'SELECT\n  o.order_id,\n  o.customer_id,\n  SUM(o.total_amount) AS revenue\nFROM harm.tb_orders_harm o\nWHERE o.status = \'COMPLETED\'\nGROUP BY 1, 2'}
              className="w-full bg-gray-50 border border-gray-300 text-gray-800 text-xs rounded-lg px-3 py-2.5 font-mono focus:outline-none focus:border-blue-500 resize-y" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">Tabelas dependência</label>
              <button type="button" onClick={() => setDepTables(d => [...d, { table: '', contract_id: '' }])}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/>
                </svg>
                Adicionar dependência
              </button>
            </div>
            {depTables.length === 0 ? (
              <p className="text-xs text-gray-400 italic py-1">Nenhuma dependência adicionada.</p>
            ) : (
              <div className="space-y-2">
                {depTables.map((d, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={d.table}
                      onChange={e => setDepTables(prev => prev.map((x, j) => j === i ? { ...x, table: e.target.value } : x))}
                      placeholder="schema.table_name"
                      className="flex-1 bg-gray-50 border border-gray-300 text-gray-800 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-blue-500" />
                    <select value={d.contract_id}
                      onChange={e => setDepTables(prev => prev.map((x, j) => j === i ? { ...x, contract_id: e.target.value } : x))}
                      className="flex-1 bg-gray-50 border border-gray-300 text-gray-800 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500">
                      <option value="">— Contrato (opcional) —</option>
                      {allContracts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button type="button" onClick={() => setDepTables(prev => prev.filter((_, j) => j !== i))}
                      className="text-gray-400 hover:text-red-500 text-xs shrink-0">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => goStep(4)}
              className="px-5 py-2 rounded-lg text-sm font-medium text-gray-600 border border-gray-300 hover:bg-gray-100">
              ← Anterior
            </button>
            <button type="button" onClick={handleSubmit} disabled={submitting}
              className="px-6 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50" style={{ background: '#185FA5' }}>
              {submitting ? 'Criando...' : 'Criar Contrato'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
