import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGraphStore } from '../../../store/graphStore';
import { useAuthStore } from '../../../store/authStore';
import { validateGraph, generateZip, checkEngineHealth, getTestPlan, type TestPlanResult } from '../../../api/engine';
import { importAgentZip, ImportError } from '../../../api/import';
import { HelpPanel } from '../Help/HelpPanel';
import { GitPanel } from '../GitPanel/GitPanel';
import { CostEstimatorPanel } from '../CostEstimator/CostEstimatorPanel';
import { TestPlanModal } from '../TestPlan/TestPlanModal';

type EngineHealth = 'unknown' | 'ok' | 'down';

function HealthDot({ status, lastError }: { status: EngineHealth; lastError: string }) {
  const map: Record<EngineHealth, { cls: string; label: string; title: string }> = {
    unknown: { cls: 'bg-gray-400', label: 'Engine ?', title: 'Checking engine...' },
    ok:      { cls: 'bg-green-500', label: 'Engine', title: 'Engine reachable at /api/health' },
    down:    { cls: 'bg-red-500',   label: 'Engine offline', title: lastError || 'Engine /api/health failed' },
  };
  const { cls, label, title } = map[status];
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500" title={title}>
      <span className={`w-2 h-2 rounded-full ${cls}`} />
      <span>{label}</span>
    </div>
  );
}

type Status = 'idle' | 'validating' | 'valid' | 'invalid' | 'generating' | 'error';

function StatusBadge({ status, errorCount }: { status: Status; errorCount: number }) {
  if (status === 'idle') return null;
  const map: Record<Status, { label: string; cls: string }> = {
    idle: { label: '', cls: '' },
    validating: { label: 'Validating...', cls: 'text-blue-600' },
    generating: { label: 'Generating...', cls: 'text-blue-600' },
    valid: { label: '✓ Valid', cls: 'text-green-600' },
    invalid: { label: `✗ ${errorCount} error${errorCount !== 1 ? 's' : ''}`, cls: 'text-red-600' },
    error: { label: '⚠ Error', cls: 'text-amber-600' },
  };
  const { label, cls } = map[status];
  return <span className={`text-sm font-medium ${cls}`}>{label}</span>;
}

export function Toolbar() {
  const token = useAuthStore((s) => s.token);
  const projectName = useGraphStore((s) => s.projectName);
  const setProjectName = useGraphStore((s) => s.setProjectName);
  const getProject = useGraphStore((s) => s.getProject);
  const loadProject = useGraphStore((s) => s.loadProject);
  const setValidationErrors = useGraphStore((s) => s.setValidationErrors);
  const clearValidation = useGraphStore((s) => s.clearValidation);
  const validationErrors = useGraphStore((s) => s.validationErrors);
  const hasContent = useGraphStore((s) => s.nodes.length > 0 || s.edges.length > 0);

  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [gitOpen, setGitOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [testPlan, setTestPlan] = useState<TestPlanResult | null>(null);
  const navigate = useNavigate();
  const [engineHealth, setEngineHealth] = useState<EngineHealth>('unknown');
  const [healthError, setHealthError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let stopped = false;
    const ctl = new AbortController();
    const tick = async () => {
      const result = await checkEngineHealth(ctl.signal);
      if (stopped) return;
      setEngineHealth(result.ok ? 'ok' : 'down');
      setHealthError(result.error ?? '');
    };
    tick();
    const id = window.setInterval(tick, 15000);
    return () => {
      stopped = true;
      window.clearInterval(id);
      ctl.abort();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (!inField && e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onValidate = useCallback(async () => {
    setStatus('validating');
    clearValidation();
    try {
      const result = await validateGraph(getProject(), token!);
      setValidationErrors(result.errors);
      setStatus(result.valid ? 'valid' : 'invalid');
    } catch (e) {
      setStatus('error');
      setErrorMsg(String(e));
    }
  }, [getProject, setValidationErrors, clearValidation, token]);

  const onImportClick = useCallback(() => {
    if (hasContent) {
      const ok = window.confirm('Importing a ZIP will replace the current canvas. Continue?');
      if (!ok) return;
    }
    fileInputRef.current?.click();
  }, [hasContent]);

  const onFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;

      setStatus('idle');
      setErrorMsg('');
      try {
        const project = await importAgentZip(file);
        loadProject(project);
        setStatus('valid');
      } catch (err) {
        setStatus('error');
        setErrorMsg(err instanceof ImportError ? err.message : `Import failed: ${String(err)}`);
      }
    },
    [loadProject],
  );

  const onTestPlan = useCallback(async () => {
    setStatus('validating');
    setErrorMsg('');
    try {
      const result = await getTestPlan(getProject(), token!);
      setTestPlan(result);
      setStatus('valid');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus('error');
      setErrorMsg(msg);
    }
  }, [getProject, token]);

  const onGenerate = useCallback(async () => {
    setStatus('validating');
    clearValidation();
    try {
      const project = getProject();
      const validation = await validateGraph(project, token!);
      setValidationErrors(validation.errors);
      if (!validation.valid) {
        setStatus('invalid');
        return;
      }
      setStatus('generating');
      await generateZip(project, token!);
      setStatus('valid');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus('error');
      setErrorMsg(msg);
    }
  }, [getProject, clearValidation, setValidationErrors, token]);

  const btnCls = 'flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg disabled:opacity-50 transition-colors';
  const primaryBtnCls = 'flex items-center gap-1.5 px-3 py-1.5 text-sm btn-primary rounded-lg disabled:opacity-50 font-medium';

  return (
    <header className="h-12 bg-white border-b border-gray-200 flex items-center px-4 gap-3 flex-shrink-0">
      {/* Logo / brand */}
      <div className="flex items-center gap-2 mr-2">
        <span className="text-lg">🤖</span>
        <span className="text-gray-900 font-semibold text-sm hidden sm:block">Agents Studio</span>
      </div>

      <div className="w-px h-6 bg-gray-200" />

      {/* Project name */}
      <input
        type="text"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1 text-sm text-gray-900 focus:outline-none focus:border-brand w-48 placeholder-gray-400"
        placeholder="project-name"
      />

      <div className="flex-1" />

      {/* Engine health */}
      <HealthDot status={engineHealth} lastError={healthError} />

      <div className="w-px h-6 bg-gray-200" />

      {/* Status */}
      <StatusBadge status={status} errorCount={validationErrors.length} />
      {status === 'error' && errorMsg && (
        <span className="text-xs text-amber-600 max-w-xs truncate" title={errorMsg}>
          {errorMsg}
        </span>
      )}

      <div className="w-px h-6 bg-gray-200" />

      {/* Actions */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={onFileSelected}
      />

      <button onClick={onImportClick} disabled={status === 'validating' || status === 'generating'}
        title="Import a previously generated agent ZIP and edit its graph" className={btnCls}>
        <span>⬆</span> Import ZIP
      </button>

      <button onClick={() => navigate('/eval')} title="Evaluate agent outputs with metrics"
        className={btnCls}>
        <span>📊</span> Eval
      </button>

      <button onClick={onTestPlan} disabled={status === 'validating' || status === 'generating' || engineHealth === 'down'}
        title={engineHealth === 'down' ? 'Engine offline' : 'Generate pytest files for tools (preview)'}
        className={btnCls}>
        <span>🧪</span> Test Plan
      </button>

      <button onClick={() => setCostOpen(true)} title="Estimate monthly AWS cost for this graph"
        className={btnCls}>
        <span>💰</span> Cost
      </button>

      <button onClick={() => setGitOpen(true)} disabled={status === 'validating' || status === 'generating'}
        title="Push generated repo to GitHub/GitLab, or pull project.json back" className={btnCls}>
        <span>🔀</span> Git
      </button>

      <button onClick={onValidate} disabled={status === 'validating' || status === 'generating' || engineHealth === 'down'}
        title={engineHealth === 'down' ? 'Engine offline' : 'Validate graph'}
        className={btnCls}>
        <span>✓</span> Validate
      </button>

      <button onClick={onGenerate} disabled={status === 'validating' || status === 'generating' || engineHealth === 'down'}
        title={engineHealth === 'down' ? 'Engine offline — cannot generate' : 'Validate then generate ZIP'}
        className={primaryBtnCls}>
        <span>⬇</span> Generate ZIP
      </button>

      <button onClick={() => setHelpOpen(true)} title="Help (?)" aria-label="Open help"
        className="flex items-center justify-center w-8 h-8 text-sm bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-full transition-colors">
        ?
      </button>

      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
      {gitOpen && <GitPanel onClose={() => setGitOpen(false)} />}
      {costOpen && <CostEstimatorPanel onClose={() => setCostOpen(false)} />}
      {testPlan && <TestPlanModal result={testPlan} onClose={() => setTestPlan(null)} />}
    </header>
  );
}
