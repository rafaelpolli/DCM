export type DataType = 'any' | 'string' | 'json' | 'document' | 'vector' | 'retriever' | 'control' | 'boolean';

export type NodeType =
  | 'input'
  | 'output'
  | 'agent'
  | 'multi_agent_coordinator'
  | 'human_in_the_loop'
  | 'tool_custom'
  | 'tool_athena'
  | 'tool_s3'
  | 'tool_http'
  | 'tool_bedrock'
  | 'mcp_server'
  | 'mcp_client'
  | 'code_interpreter'
  | 'browser_tool'
  | 'kb_s3_vector'
  | 'kb_bedrock'
  | 'chunking'
  | 'embedding'
  | 'retriever'
  | 's3_source'
  | 'document_parser'
  | 'ingest_pipeline'
  | 'condition'
  | 'loop'
  | 'cache'
  | 'logger'
  | 'output_validator'
  | 'pii_filter'
  | 'prompt_firewall';

export interface Port {
  id: string;
  name: string;
  data_type: DataType;
  required?: boolean;
}

export interface NodePorts {
  inputs: Port[];
  outputs: Port[];
}

export interface Position {
  x: number;
  y: number;
}

export interface AgentNode {
  id: string;
  type: NodeType;
  label: string;
  position: Position;
  config: Record<string, unknown>;
  ports: NodePorts;
}

export interface AgentEdge {
  id: string;
  source_node_id: string;
  source_port_id: string;
  target_node_id: string;
  target_port_id: string;
  data_type: DataType;
}

export interface Project {
  name: string;
  nodes: AgentNode[];
  edges: AgentEdge[];
}

export interface ValidationError {
  node_id: string | null;
  field: string | null;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
