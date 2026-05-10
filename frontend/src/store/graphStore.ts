import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge as rfAddEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type Node as FlowNode,
  type Edge as FlowEdge,
} from '@xyflow/react';
import type { AgentNode, DataType, Project, ValidationError } from '../types/graph';

export type NodeData = { node: AgentNode; validationErrors: ValidationError[] };
export type AppFlowNode = FlowNode<NodeData>;
export type AppFlowEdge = FlowEdge<{ data_type: DataType }>;

interface GraphStore {
  nodes: AppFlowNode[];
  edges: AppFlowEdge[];
  selectedNodeId: string | null;
  projectName: string;
  validationErrors: ValidationError[];
  canvasReady: boolean;

  onNodesChange: (changes: NodeChange<AppFlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection, dataType?: DataType) => void;

  addAgentNode: (agentNode: AgentNode) => void;
  updateNodeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  updateNodeLabel: (nodeId: string, label: string) => void;
  removeNode: (nodeId: string) => void;

  selectNode: (id: string | null) => void;
  setProjectName: (name: string) => void;
  setValidationErrors: (errors: ValidationError[]) => void;
  clearValidation: () => void;

  getProject: () => Project;
  getSelectedAgentNode: () => AgentNode | null;

  loadProject: (project: Project) => void;
  resetCanvas: () => void;
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  projectName: 'my-agent',
  validationErrors: [],
  canvasReady: false,

  onNodesChange: (changes) => {
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) }));
  },

  onEdgesChange: (changes) => {
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) as AppFlowEdge[] }));
  },

  onConnect: (connection, dataType = 'any') => {
    const edge: AppFlowEdge = {
      id: `e-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}`,
      source: connection.source,
      sourceHandle: connection.sourceHandle ?? null,
      target: connection.target,
      targetHandle: connection.targetHandle ?? null,
      type: 'default',
      data: { data_type: dataType },
      style: { stroke: '#9ca3af', strokeWidth: 2 },
      animated: false,
    };
    set((s) => ({ edges: rfAddEdge(edge, s.edges) as AppFlowEdge[] }));
  },

  addAgentNode: (agentNode) => {
    const flowNode: AppFlowNode = {
      id: agentNode.id,
      type: 'customNode',
      position: agentNode.position,
      data: { node: agentNode, validationErrors: [] },
    };
    set((s) => ({ nodes: [...s.nodes, flowNode] }));
  },

  updateNodeConfig: (nodeId, config) => {
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, node: { ...n.data.node, config } } }
          : n,
      ),
    }));
  },

  updateNodeLabel: (nodeId, label) => {
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, node: { ...n.data.node, label } } }
          : n,
      ),
    }));
  },

  removeNode: (nodeId) => {
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== nodeId),
      edges: s.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      selectedNodeId: s.selectedNodeId === nodeId ? null : s.selectedNodeId,
    }));
  },

  selectNode: (id) => set({ selectedNodeId: id }),

  setProjectName: (name) => set({ projectName: name }),

  setValidationErrors: (errors) => {
    set((s) => ({
      validationErrors: errors,
      nodes: s.nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          validationErrors: errors.filter((e) => e.node_id === n.id),
        },
      })),
    }));
  },

  clearValidation: () => {
    set((s) => ({
      validationErrors: [],
      nodes: s.nodes.map((n) => ({ ...n, data: { ...n.data, validationErrors: [] } })),
    }));
  },

  getProject: () => {
    const { nodes, edges, projectName } = get();
    return {
      name: projectName,
      nodes: nodes.map((n) => n.data.node),
      edges: edges.map((e) => ({
        id: e.id,
        source_node_id: e.source,
        source_port_id: e.sourceHandle ?? '',
        target_node_id: e.target,
        target_port_id: e.targetHandle ?? '',
        data_type: e.data?.data_type ?? 'any',
      })),
    };
  },

  getSelectedAgentNode: () => {
    const { nodes, selectedNodeId } = get();
    const found = nodes.find((n) => n.id === selectedNodeId);
    return found ? found.data.node : null;
  },

  loadProject: (project) => {
    const flowNodes: AppFlowNode[] = project.nodes.map((agentNode) => ({
      id: agentNode.id,
      type: 'customNode',
      position: agentNode.position,
      data: { node: agentNode, validationErrors: [] },
    }));

    const flowEdges: AppFlowEdge[] = project.edges.map((e) => ({
      id: e.id,
      source: e.source_node_id,
      sourceHandle: e.source_port_id,
      target: e.target_node_id,
      targetHandle: e.target_port_id,
      type: 'default',
      data: { data_type: e.data_type },
      style: { stroke: '#9ca3af', strokeWidth: 2 },
      animated: false,
    }));

    set({
      nodes: flowNodes,
      edges: flowEdges,
      projectName: project.name,
      selectedNodeId: null,
      validationErrors: [],
      canvasReady: true,
    });
  },

  resetCanvas: () => {
    set({
      nodes: [],
      edges: [],
      projectName: 'untitled-agent',
      selectedNodeId: null,
      validationErrors: [],
      canvasReady: false,
    });
  },
}));
