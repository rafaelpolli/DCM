import { memo, useCallback, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NODE_CATALOG, PORT_COLORS } from '../../../nodes/catalog';
import { useGraphStore, type AppFlowNode } from '../../../store/graphStore';
import { NodeHelpModal } from '../NodeHelp/NodeHelpModal';
import type { Port } from '../../../types/graph';

const HEADER_H = 48;
const PORT_ROW_H = 26;
const PORTS_TOP = HEADER_H + 8;

function portTop(i: number): number {
  return PORTS_TOP + i * PORT_ROW_H + PORT_ROW_H / 2;
}

function PortDot({ port }: { port: Port }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${PORT_COLORS[port.data_type] ?? 'bg-gray-400'}`}
      title={port.data_type}
    />
  );
}

function CustomNodeInner({ data, selected, id }: NodeProps<AppFlowNode>) {
  const { node, validationErrors } = data;
  const def = NODE_CATALOG[node.type];
  const removeNode = useGraphStore((s) => s.removeNode);
  const [showHelp, setShowHelp] = useState(false);

  const hasErrors = validationErrors.length > 0;
  const borderColor = hasErrors
    ? 'border-red-500'
    : selected
    ? 'border-brand'
    : def.categoryColor;

  const onDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      removeNode(id);
    },
    [id, removeNode],
  );

  const onHelp = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowHelp(true);
  }, []);

  const onCloseHelp = useCallback(() => setShowHelp(false), []);

  const maxPorts = Math.max(node.ports.inputs.length, node.ports.outputs.length);
  const bodyHeight = Math.max(maxPorts * PORT_ROW_H + 16, 40);

  return (
    <>
      <div
        className={`relative bg-white border-2 rounded-xl shadow-md select-none ${borderColor}`}
        style={{ minWidth: 220 }}
      >
        {/* Input handles */}
        {node.ports.inputs.map((port, i) => (
          <Handle
            key={port.id}
            id={port.id}
            type="target"
            position={Position.Left}
            style={{ top: portTop(i), background: 'transparent' }}
            className={`!border-2 !border-white !w-3 !h-3 ${PORT_COLORS[port.data_type] ?? 'bg-gray-400'}`}
          />
        ))}

        {/* Output handles */}
        {node.ports.outputs.map((port, i) => (
          <Handle
            key={port.id}
            id={port.id}
            type="source"
            position={Position.Right}
            style={{ top: portTop(i), background: 'transparent' }}
            className={`!border-2 !border-white !w-3 !h-3 ${PORT_COLORS[port.data_type] ?? 'bg-gray-400'}`}
          />
        ))}

        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 border-b border-gray-200"
          style={{ height: HEADER_H }}
        >
          <span className="text-xl leading-none">{def.icon}</span>
          <div className="flex-1 overflow-hidden">
            <div className="text-gray-900 text-sm font-semibold truncate leading-tight">{node.label}</div>
            <div className="text-gray-500 text-xs truncate">{def.label}</div>
          </div>

          {/* Help button */}
          <button
            onClick={onHelp}
            className="flex-shrink-0 w-5 h-5 rounded-full border border-gray-200 text-gray-400 hover:text-brand hover:border-brand text-xs font-bold flex items-center justify-center transition-colors"
            title="Show help"
          >
            ?
          </button>

          {selected && (
            <button
              onClick={onDelete}
              className="text-gray-400 hover:text-red-500 text-xs leading-none ml-0.5"
              title="Delete node"
            >
              ✕
            </button>
          )}
        </div>

        {/* Ports body */}
        <div className="flex px-3 py-2 gap-2" style={{ minHeight: bodyHeight }}>
          <div className="flex flex-col gap-0.5 flex-1">
            {node.ports.inputs.map((port) => (
              <div key={port.id} className="flex items-center gap-1.5" style={{ height: PORT_ROW_H }}>
                <PortDot port={port} />
                <span className="text-xs text-gray-600 truncate">
                  {port.name}
                  {port.required && (
                    <span className="text-red-500 ml-0.5" title="Required input">*</span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-0.5 flex-1 items-end">
            {node.ports.outputs.map((port) => (
              <div key={port.id} className="flex items-center gap-1.5 justify-end" style={{ height: PORT_ROW_H }}>
                <span className="text-xs text-gray-600 truncate">{port.name}</span>
                <PortDot port={port} />
              </div>
            ))}
          </div>
        </div>

        {/* Validation errors badge */}
        {hasErrors && (
          <div className="px-3 pb-2">
            {validationErrors.map((e, i) => (
              <div key={i} className="text-xs text-red-500 truncate">
                ⚠ {e.message}
              </div>
            ))}
          </div>
        )}
      </div>

      {showHelp && <NodeHelpModal node={node} onClose={onCloseHelp} />}
    </>
  );
}

export const CustomNode = memo(CustomNodeInner);
