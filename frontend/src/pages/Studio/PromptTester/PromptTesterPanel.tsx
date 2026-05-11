import { useState } from 'react';
import { previewNode } from '../../../api/engine';
import { useAuthStore } from '../../../store/authStore';
import type { AgentNode } from '../../../types/graph';

interface Props {
  node: AgentNode;
}

export function PromptTesterPanel({ node }: Props) {
  const { token } = useAuthStore();
  const [input, setInput] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [result, setResult] = useState<{ response: string; input_tokens: number; output_tokens: number; latency_ms: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const modelId = (node.config.model_id as string | undefined) ?? 'anthropic.claude-3-5-haiku-20241022-v1:0';
  const systemPrompt = (node.config.system_prompt as string | undefined) ?? '';
  const temperature = (node.config.temperature as number | undefined) ?? 0.7;
  const maxTokens = Math.min((node.config.max_tokens as number | undefined) ?? 1024, 2048);
  const guardrails = (node.config.guardrails as { guardrail_id?: string; guardrail_version?: string } | undefined);
  const guardrailId = guardrails?.guardrail_id || undefined;
  const guardrailVersion = guardrails?.guardrail_version || undefined;

  const handleRun = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await previewNode({
        model_id: modelId,
        system_prompt: systemPrompt,
        temperature,
        max_tokens: maxTokens,
        input_text: input,
        aws_region: region,
        guardrail_id: guardrailId,
        guardrail_version: guardrailVersion,
      }, token!);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-t border-gray-200 pt-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">🧪</span>
        <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">Prompt Tester</h3>
      </div>
      <div className="text-xs text-gray-400 mb-3 font-mono truncate" title={modelId}>
        {modelId}
      </div>

      <div className="mb-2">
        <label className="block text-xs font-medium text-gray-600 mb-1">AWS Region</label>
        <input
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-mono text-gray-900 focus:outline-none focus:border-brand"
          value={region}
          onChange={e => setRegion(e.target.value)}
          placeholder="us-east-1"
        />
      </div>

      <div className="mb-2">
        <label className="block text-xs font-medium text-gray-600 mb-1">Input</label>
        <textarea
          rows={3}
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:border-brand resize-none"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type a test message..."
          onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleRun(); }}
        />
      </div>

      <button
        onClick={handleRun}
        disabled={loading || !input.trim()}
        className="w-full py-1.5 text-xs font-semibold rounded-lg border border-brand text-brand hover:bg-orange-50 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Running...' : '▶ Run  ⌘↵'}
      </button>

      {error && (
        <div className="mt-2 p-2 bg-red-50 rounded text-xs text-red-600 font-mono">{error}</div>
      )}

      {result && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-gray-600">Response</span>
            <span className="text-xs text-gray-400 font-mono">
              {result.input_tokens}↑ {result.output_tokens}↓ {result.latency_ms}ms
            </span>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">
            {result.response}
          </div>
        </div>
      )}
    </div>
  );
}
