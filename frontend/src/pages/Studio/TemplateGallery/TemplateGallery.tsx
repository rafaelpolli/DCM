import { TEMPLATES, type Template } from '../../../data/templates';
import { useGraphStore } from '../../../store/graphStore';

const TAG_COLORS: Record<string, string> = {
  beginner: 'bg-green-50 text-green-700',
  chat: 'bg-blue-50 text-blue-700',
  rag: 'bg-purple-50 text-purple-700',
  'knowledge-base': 'bg-purple-50 text-purple-700',
  's3-vectors': 'bg-teal-50 text-teal-700',
  hitl: 'bg-red-50 text-red-700',
  approval: 'bg-orange-50 text-orange-700',
  governance: 'bg-orange-50 text-orange-700',
  'multi-agent': 'bg-indigo-50 text-indigo-700',
  orchestration: 'bg-indigo-50 text-indigo-700',
  ingestion: 'bg-yellow-50 text-yellow-700',
  pipeline: 'bg-yellow-50 text-yellow-700',
  tools: 'bg-orange-50 text-orange-700',
  'function-calling': 'bg-orange-50 text-orange-700',
  sql: 'bg-cyan-50 text-cyan-700',
};

const TEMPLATE_ICONS: Record<string, string> = {
  'simple-chatbot': '💬',
  'rag-agent': '📚',
  'hitl-approval': '👤',
  'multi-agent': '🎯',
  'agent-with-tools': '🛠️',
  'data-ingestion': '🔄',
};

function TemplateCard({ template, onSelect }: { template: Template; onSelect: () => void }) {
  return (
    <div
      className="card card-hover p-5 cursor-pointer transition-all"
      onClick={onSelect}
    >
      <div className="flex items-start gap-3 mb-3">
        <span className="text-3xl">{TEMPLATE_ICONS[template.id] ?? '🤖'}</span>
        <div>
          <h3 className="font-bold text-gray-900 text-sm">{template.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{template.nodeCount} nodes</p>
        </div>
      </div>
      <p className="text-xs text-gray-600 mb-3 leading-relaxed">{template.description}</p>
      <div className="flex flex-wrap gap-1.5">
        {template.tags.map(tag => (
          <span
            key={tag}
            className={`text-xs px-2 py-0.5 rounded-full font-mono ${TAG_COLORS[tag] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {tag}
          </span>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-gray-100">
        <span className="text-xs font-semibold text-brand hover:underline">Use template →</span>
      </div>
    </div>
  );
}

export function TemplateGallery() {
  const loadProject = useGraphStore(s => s.loadProject);
  const setProjectName = useGraphStore(s => s.setProjectName);

  const handleSelect = (template: Template) => {
    loadProject(template.project);
    setProjectName(template.project.name);
  };

  return (
    <div className="flex-1 overflow-auto p-8 bg-surface">
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div className="text-center mb-8">
          <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Start from a Template</h2>
          <p className="text-sm text-gray-500">Choose a pre-built agent graph or start with a blank canvas below.</p>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          {TEMPLATES.map(t => (
            <TemplateCard key={t.id} template={t} onSelect={() => handleSelect(t)} />
          ))}
        </div>

        <div className="text-center">
          <button
            onClick={() => {
              loadProject({ name: 'my-agent', nodes: [], edges: [] });
              setProjectName('my-agent');
            }}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Start with blank canvas
          </button>
        </div>
      </div>
    </div>
  );
}
