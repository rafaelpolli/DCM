import { useState, useMemo, Suspense, lazy } from 'react';
import type { TestPlanResult } from '../../../api/engine';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

interface Props {
  result: TestPlanResult;
  onClose: () => void;
}

function langFor(path: string): string {
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.yml') || path.endsWith('.yaml')) return 'yaml';
  if (path.endsWith('.md')) return 'markdown';
  return 'plaintext';
}

export function TestPlanModal({ result, onClose }: Props) {
  const paths = useMemo(() => Object.keys(result.files).sort(), [result.files]);
  const [active, setActive] = useState(paths[0] ?? '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900">Test Plan</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {paths.length} file{paths.length !== 1 ? 's' : ''} · {result.tool_count} tool{result.tool_count !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <aside className="w-64 shrink-0 bg-gray-50 border-r border-gray-200 overflow-y-auto">
            {paths.length === 0 ? (
              <div className="px-4 py-3 text-xs text-gray-400 italic">No test files generated.</div>
            ) : (
              <ul className="py-2">
                {paths.map(p => (
                  <li key={p}>
                    <button
                      onClick={() => setActive(p)}
                      className={`w-full text-left px-4 py-1.5 text-xs font-mono truncate transition-colors ${
                        active === p ? 'bg-orange-50 text-orange-700 border-l-2 border-orange-500' : 'text-gray-600 hover:bg-gray-100'
                      }`}
                      title={p}
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <div className="flex-1 overflow-hidden">
            {active ? (
              <Suspense fallback={<div className="p-4 text-xs text-gray-400">Loading editor...</div>}>
                <MonacoEditor
                  height="100%"
                  language={langFor(active)}
                  theme="vs"
                  value={result.files[active]}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    padding: { top: 8 },
                    automaticLayout: true,
                  }}
                />
              </Suspense>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-gray-400">No file selected.</div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center shrink-0">
          <p className="text-xs text-gray-500">
            Run locally: <span className="font-mono text-gray-700">uv run pytest tests/ -v</span>
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
