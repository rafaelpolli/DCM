import { useGraphStore } from '../../../store/graphStore';
import type { AgentNode } from '../../../types/graph';

// Approximate Bedrock pricing (USD per 1M tokens, May 2026)
const BEDROCK_PRICING: Record<string, { input: number; output: number }> = {
  'anthropic.claude-3-5-sonnet-20241022-v2:0': { input: 3.0,  output: 15.0 },
  'anthropic.claude-3-5-haiku-20241022-v1:0':  { input: 0.8,  output: 4.0  },
  'anthropic.claude-3-opus-20240229-v1:0':      { input: 15.0, output: 75.0 },
  'amazon.titan-embed-text-v2:0':               { input: 0.02, output: 0.0  },
};

const DEFAULT_MODEL_PRICE = { input: 3.0, output: 15.0 };

// Assumptions (customisable later)
const MONTHLY_INVOCATIONS = 10_000;
const AVG_INPUT_TOKENS    = 1_000;
const AVG_OUTPUT_TOKENS   = 500;
const AVG_LAMBDA_DURATION = 1.0; // seconds
const LAMBDA_MEMORY_MB    = 256;

function getModelPrice(modelId: string) {
  return BEDROCK_PRICING[modelId] ?? DEFAULT_MODEL_PRICE;
}

interface LineItem { label: string; detail: string; cost: number }

function estimateCost(nodes: AgentNode[]): LineItem[] {
  const items: LineItem[] = [];

  // AgentCore Runtime (~$0.04/hour × 730h/month when running)
  const agentNodes = nodes.filter(n => n.type === 'agent' || n.type === 'multi_agent_coordinator');
  if (agentNodes.length > 0) {
    items.push({
      label: 'AgentCore Runtime',
      detail: `${agentNodes.length} runtime instance(s) × 730h`,
      cost: agentNodes.length * 0.04 * 730,
    });
  }

  // Bedrock LLM calls
  for (const n of agentNodes) {
    const modelId = (n.config.model_id as string | undefined) ?? '';
    const p = getModelPrice(modelId);
    const inputCost  = (MONTHLY_INVOCATIONS * AVG_INPUT_TOKENS  / 1_000_000) * p.input;
    const outputCost = (MONTHLY_INVOCATIONS * AVG_OUTPUT_TOKENS / 1_000_000) * p.output;
    items.push({
      label: `Bedrock — ${n.label}`,
      detail: `${MONTHLY_INVOCATIONS.toLocaleString()} inv × ${AVG_INPUT_TOKENS}↑/${AVG_OUTPUT_TOKENS}↓ tokens`,
      cost: inputCost + outputCost,
    });
  }

  // Per-tool Lambda
  const toolNodes = nodes.filter(n => ['tool_custom','tool_athena','tool_s3','tool_http','tool_bedrock'].includes(n.type));
  for (const n of toolNodes) {
    const memGB   = ((n.config.memory_mb as number | undefined) ?? LAMBDA_MEMORY_MB) / 1024;
    const invCost = MONTHLY_INVOCATIONS * 0.0000002;
    const durCost = MONTHLY_INVOCATIONS * AVG_LAMBDA_DURATION * memGB * 0.0000166667;
    items.push({
      label: `Lambda — ${n.label}`,
      detail: `${MONTHLY_INVOCATIONS.toLocaleString()} inv × ${AVG_LAMBDA_DURATION}s`,
      cost: invCost + durCost,
    });
  }

  // Athena scans ($5/TB)
  const athenaNodes = nodes.filter(n => n.type === 'tool_athena');
  if (athenaNodes.length > 0) {
    items.push({
      label: 'Athena Scans',
      detail: `${athenaNodes.length} query node(s) × estimated 10 GB/query`,
      cost: athenaNodes.length * MONTHLY_INVOCATIONS * 0.01 * 0.005,
    });
  }

  // S3 Vectors queries ($0.04/M queries)
  const vectorNodes = nodes.filter(n => n.type === 'kb_s3_vector');
  if (vectorNodes.length > 0) {
    items.push({
      label: 'S3 Vectors Queries',
      detail: `${vectorNodes.length} index × ${MONTHLY_INVOCATIONS.toLocaleString()} queries`,
      cost: vectorNodes.length * MONTHLY_INVOCATIONS * 0.00000004,
    });
  }

  // DynamoDB (cache + HITL)
  const dynNodes = nodes.filter(n => n.type === 'cache' || n.type === 'human_in_the_loop');
  if (dynNodes.length > 0) {
    items.push({
      label: 'DynamoDB (cache/HITL)',
      detail: `${dynNodes.length} node(s) × read+write`,
      cost: dynNodes.length * MONTHLY_INVOCATIONS * 0.000000625,
    });
  }

  return items;
}

export function CostEstimatorPanel({ onClose }: { onClose: () => void }) {
  const nodes = useGraphStore(s => s.nodes.map(n => n.data.node));
  const projectName = useGraphStore(s => s.projectName);

  const items = estimateCost(nodes);
  const total = items.reduce((s, i) => s + i.cost, 0);

  const fmt = (n: number) =>
    n < 0.01 ? '< $0.01' : `$${n.toFixed(2)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Cost Estimator</h2>
            <p className="text-xs text-gray-400 mt-0.5">{projectName} · {MONTHLY_INVOCATIONS.toLocaleString()} invocations/month</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg">✕</button>
        </div>

        <div className="px-6 py-4 max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Add nodes to the canvas to see cost estimates.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left text-xs font-bold text-gray-400 uppercase pb-2">Service</th>
                  <th className="text-left text-xs font-bold text-gray-400 uppercase pb-2">Basis</th>
                  <th className="text-right text-xs font-bold text-gray-400 uppercase pb-2">Est./mo</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="border-t border-gray-50">
                    <td className="py-2 text-sm font-medium text-gray-800">{item.label}</td>
                    <td className="py-2 text-xs text-gray-400">{item.detail}</td>
                    <td className="py-2 text-sm font-mono text-right text-gray-700">{fmt(item.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50">
          <div className="text-xs text-gray-400">Estimates only. Actual costs vary by usage.</div>
          <div className="text-right">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-bold">Total</div>
            <div className="text-2xl font-extrabold text-gray-900">{fmt(total)}<span className="text-sm text-gray-400 font-normal">/mo</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
