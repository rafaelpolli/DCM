import { useState, useRef } from 'react';
import { runEval, type EvalRow, type EvalResult } from '../../api/eval';
import { useAuthStore } from '../../store/authStore';

const METRIC_LABELS: Record<string, string> = {
  exact_match: 'Exact Match',
  token_f1: 'Token F1',
  context_relevance: 'Context Relevance',
  answer_faithfulness: 'Answer Faithfulness',
};

const METRIC_COLORS: Record<string, string> = {
  exact_match: '#22c55e',
  token_f1: '#3b82f6',
  context_relevance: '#f59e0b',
  answer_faithfulness: '#a855f7',
};

const EMPTY_ROW = (): EvalRow => ({ question: '', contexts: [''], answer: '', ground_truth: '' });

const CSV_HEADER = 'question,answer,ground_truth,contexts';
const CSV_TEMPLATE = `${CSV_HEADER}\n"What is the capital of France?","The capital of France is Paris.","Paris","Paris is the capital and most populous city of France|France is a country in Western Europe"\n"Who wrote Hamlet?","William Shakespeare wrote Hamlet.","William Shakespeare",""`;

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === ',' && !inQuote) {
      fields.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCSV(text: string): EvalRow[] | string {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return 'CSV must have a header row and at least one data row.';
  const header = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
  const qi = header.indexOf('question');
  const ai = header.indexOf('answer');
  const gi = header.indexOf('ground_truth');
  const ci = header.indexOf('contexts');
  if (qi === -1 || ai === -1 || gi === -1) return 'CSV must have columns: question, answer, ground_truth (and optionally contexts).';
  const rows: EvalRow[] = [];
  for (let r = 1; r < lines.length; r++) {
    if (!lines[r].trim()) continue;
    const cols = parseCSVLine(lines[r]);
    const contexts = ci !== -1 && cols[ci]?.trim()
      ? cols[ci].split('|').map(s => s.trim()).filter(Boolean)
      : [''];
    rows.push({
      question: cols[qi]?.trim() ?? '',
      answer: cols[ai]?.trim() ?? '',
      ground_truth: cols[gi]?.trim() ?? '',
      contexts,
    });
  }
  return rows.length ? rows : 'No valid rows found in CSV.';
}

function ScoreBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${value * 100}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono w-10 text-right text-gray-700">{(value * 100).toFixed(1)}%</span>
    </div>
  );
}

export function EvalPage() {
  const { token } = useAuthStore();
  const [rows, setRows] = useState<EvalRow[]>([EMPTY_ROW()]);
  const [result, setResult] = useState<EvalResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleCSVLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const parsed = parseCSV(text);
      if (typeof parsed === 'string') { setError(parsed); }
      else { setRows(parsed); setResult(null); setError(''); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'eval_template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const updateRow = (i: number, field: keyof EvalRow, value: string | string[]) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  };

  const addRow = () => setRows(prev => [...prev, EMPTY_ROW()]);
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    const valid = rows.filter(r => r.question.trim() && r.answer.trim());
    if (!valid.length) { setError('Add at least one row with question and answer.'); return; }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await runEval(valid, token!);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const metricKeys = ['exact_match', 'token_f1', 'context_relevance', 'answer_faithfulness'];

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">Agent Evaluation</h1>
          <p className="text-sm text-gray-400 mt-1">Measure answer quality against ground truth</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleCSVLoad} />
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-gray-600 border border-gray-200 hover:border-gray-300 hover:text-gray-900 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Carregar CSV
          </button>
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-gray-400 hover:text-gray-600 transition-colors"
            title="Download CSV template"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Template
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="btn-primary"
          >
            {loading ? 'Running...' : '▶ Run Evaluation'}
          </button>
        </div>
      </div>

      {error && (
        <div className="card p-4 mb-6 border-red-200 bg-red-50">
          <p className="text-sm text-red-700 font-mono">{error}</p>
        </div>
      )}

      {/* Aggregate results */}
      {result && (
        <div className="card p-6 mb-8">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Aggregate Scores — {result.rows.length} row{result.rows.length !== 1 ? 's' : ''}</h2>
          <div className="grid grid-cols-2 gap-6">
            {metricKeys.map(k => (
              <div key={k}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs font-semibold text-gray-600">{METRIC_LABELS[k]}</span>
                  <span className="text-xs font-mono font-bold" style={{ color: METRIC_COLORS[k] }}>
                    {((result.aggregate[k] ?? 0) * 100).toFixed(1)}%
                  </span>
                </div>
                <ScoreBar value={result.aggregate[k] ?? 0} color={METRIC_COLORS[k]} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input rows */}
      <div className="space-y-4 mb-6">
        {rows.map((row, i) => (
          <div key={i} className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Row {i + 1}</span>
              {rows.length > 1 && (
                <button onClick={() => removeRow(i)} className="text-xs text-red-400 hover:text-red-600">Remove</button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Question</label>
                <textarea
                  rows={2}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-brand resize-none"
                  value={row.question}
                  onChange={e => updateRow(i, 'question', e.target.value)}
                  placeholder="What is the capital of France?"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ground Truth</label>
                <textarea
                  rows={2}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-brand resize-none"
                  value={row.ground_truth}
                  onChange={e => updateRow(i, 'ground_truth', e.target.value)}
                  placeholder="Paris"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Answer (from agent)</label>
                <textarea
                  rows={3}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-brand resize-none"
                  value={row.answer}
                  onChange={e => updateRow(i, 'answer', e.target.value)}
                  placeholder="The capital of France is Paris."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Retrieved Context <span className="text-gray-400 font-normal">(optional, one chunk per line)</span></label>
                <textarea
                  rows={3}
                  className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-brand resize-none font-mono text-xs"
                  value={row.contexts.join('\n')}
                  onChange={e => updateRow(i, 'contexts', e.target.value.split('\n'))}
                  placeholder="Paris is the capital and most populous city of France..."
                />
              </div>
            </div>

            {/* Per-row results */}
            {result?.rows[i] && (
              <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-4 gap-3">
                {metricKeys.map(k => (
                  <div key={k}>
                    <div className="text-xs text-gray-400 mb-1">{METRIC_LABELS[k]}</div>
                    <ScoreBar value={(result.rows[i] as unknown as Record<string, number>)[k] ?? 0} color={METRIC_COLORS[k]} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <button onClick={addRow} className="text-sm text-brand hover:underline font-semibold">
        + Add row
      </button>

      {/* Metric legend */}
      <div className="mt-8 card p-5">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Metric Definitions</h3>
        <dl className="grid grid-cols-2 gap-3">
          {metricKeys.map(k => (
            <div key={k} className="flex gap-3">
              <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: METRIC_COLORS[k] }} />
              <div>
                <dt className="text-xs font-semibold text-gray-700">{METRIC_LABELS[k]}</dt>
                <dd className="text-xs text-gray-400">
                  {k === 'exact_match' && 'Answer matches ground truth exactly (case-insensitive).'}
                  {k === 'token_f1' && 'F1 score on token overlap between answer and ground truth.'}
                  {k === 'context_relevance' && 'Jaccard similarity between question tokens and retrieved context.'}
                  {k === 'answer_faithfulness' && 'Fraction of answer tokens that appear in the retrieved context.'}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
