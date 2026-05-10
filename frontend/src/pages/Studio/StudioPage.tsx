import { useGraphStore } from '../../store/graphStore';
import { useAuthStore } from '../../store/authStore';
import { Toolbar } from './Toolbar/Toolbar';
import { NodePanel } from './NodePanel/NodePanel';
import { Canvas } from './Canvas/Canvas';
import { ConfigPanel } from './ConfigPanel/ConfigPanel';
import { TemplateGallery } from './TemplateGallery/TemplateGallery';

export function StudioPage() {
  const { token } = useAuthStore();
  const canvasReady = useGraphStore(s => s.canvasReady);

  return (
    <div className="flex flex-col h-full bg-surface">
      <Toolbar />
      {canvasReady ? (
        <div className="flex flex-1 overflow-hidden">
          <NodePanel />
          <Canvas />
          <ConfigPanel />
        </div>
      ) : (
        <TemplateGallery />
      )}
    </div>
  );
}
