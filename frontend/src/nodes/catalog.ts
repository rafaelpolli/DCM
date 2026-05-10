import type { DataType, NodePorts, NodeType } from '../types/graph';

export type NodeCategory =
  | 'Input / Output'
  | 'Agents & Orchestration'
  | 'Tools'
  | 'MCP'
  | 'Knowledge Base / RAG'
  | 'Ingestion Pipelines'
  | 'Flow Control';

export type FieldType = 'string' | 'textarea' | 'code' | 'enum' | 'boolean' | 'number' | 'secret_ref' | 'node_ref_list';

export type NodeRefFilter = 'tool' | 'agent' | 'worker_agent';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  language?: string;
  nodeFilter?: NodeRefFilter;
  showIf?: (config: Record<string, unknown>) => boolean;
}

export interface NodeDefinition {
  type: NodeType;
  label: string;
  description: string;
  category: NodeCategory;
  icon: string;
  categoryColor: string;
  defaultConfig: Record<string, unknown>;
  configSchema: FieldDef[];
  defaultPorts: NodePorts;
}

export const NODE_CATEGORIES: NodeCategory[] = [
  'Input / Output',
  'Agents & Orchestration',
  'Tools',
  'MCP',
  'Knowledge Base / RAG',
  'Ingestion Pipelines',
  'Flow Control',
];

const p = (id: string, name: string, data_type: DataType, required = false) => ({
  id, name, data_type, required,
});

function cfgValue(cfg: Record<string, unknown>, key: string): unknown {
  const parts = key.split('.');
  let cur: unknown = cfg;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const eq = (key: string, val: unknown) => (cfg: Record<string, unknown>) => cfgValue(cfg, key) === val;
const oneOf = (key: string, vals: unknown[]) => (cfg: Record<string, unknown>) => vals.includes(cfgValue(cfg, key));
const truthy = (key: string) => (cfg: Record<string, unknown>) => Boolean(cfgValue(cfg, key));

export const NODE_CATALOG: Record<NodeType, NodeDefinition> = {
  input: {
    type: 'input', label: 'Input', description: 'Entry point for agent workflow.',
    category: 'Input / Output', icon: '\u2b07\ufe0f', categoryColor: 'border-blue-500',
    defaultConfig: { trigger: 'http' },
    configSchema: [
      { key: 'trigger', label: 'Trigger type', type: 'enum', required: true, options: ['http', 's3_event', 'sqs', 'schedule'] },
      { key: 'http.method', label: 'HTTP method', type: 'enum', options: ['GET', 'POST', 'PUT', 'DELETE'], showIf: eq('trigger', 'http') },
      { key: 'http.path', label: 'HTTP path', type: 'string', placeholder: '/invoke', showIf: eq('trigger', 'http') },
      { key: 'http.auth', label: 'Auth', type: 'enum', options: ['none', 'jwt', 'api_key'], showIf: eq('trigger', 'http') },
      { key: 'schedule.expression', label: 'Cron / rate expression', type: 'string', placeholder: 'rate(5 minutes)', required: true, showIf: eq('trigger', 'schedule') },
      { key: 's3_event.bucket', label: 'S3 bucket', type: 'string', required: true, showIf: eq('trigger', 's3_event') },
      { key: 's3_event.prefix', label: 'S3 key prefix', type: 'string', showIf: eq('trigger', 's3_event') },
      { key: 'sqs.queue_url', label: 'SQS queue URL', type: 'string', required: true, showIf: eq('trigger', 'sqs') },
      { key: 'sqs.batch_size', label: 'Batch size', type: 'number', min: 1, max: 10, showIf: eq('trigger', 'sqs') },
    ],
    defaultPorts: { inputs: [], outputs: [p('payload', 'Payload', 'json')] },
  },
  output: {
    type: 'output', label: 'Output', description: 'Terminal node — defines workflow response format.',
    category: 'Input / Output', icon: '\u2b06\ufe0f', categoryColor: 'border-blue-500',
    defaultConfig: { mode: 'json', status_code: 200 },
    configSchema: [
      { key: 'mode', label: 'Mode', type: 'enum', required: true, options: ['json', 'stream', 's3_file'] },
      { key: 'status_code', label: 'HTTP status code', type: 'number', min: 100, max: 599 },
      { key: 's3.bucket', label: 'S3 bucket', type: 'string', required: true, showIf: eq('mode', 's3_file') },
      { key: 's3.key_template', label: 'S3 key template', type: 'string', placeholder: 'output/{{run_id}}.json', required: true, showIf: eq('mode', 's3_file') },
    ],
    defaultPorts: { inputs: [p('payload', 'Payload', 'any', true)], outputs: [] },
  },
  agent: {
    type: 'agent', label: 'Agent', description: 'LangGraph ReAct agent backed by Amazon Bedrock.',
    category: 'Agents & Orchestration', icon: '\ud83e\udd16', categoryColor: 'border-purple-500',
    defaultConfig: {
      model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', inference_profile_arn: '',
      system_prompt: 'You are a helpful AI assistant.', temperature: 0.7, max_tokens: 4096,
      streaming: false, tools: [], memory: { enabled: false, namespace: 'default', top_k: 5, ttl_seconds: 3600 },
    },
    configSchema: [
      { key: 'model_id', label: 'Bedrock model ID', type: 'string', required: true, placeholder: 'anthropic.claude-3-5-sonnet-20241022-v2:0', hint: 'Required unless an inference profile ARN is set.' },
      { key: 'inference_profile_arn', label: 'Inference profile ARN', type: 'string', hint: 'Takes precedence over model ID. Required for cross-region inference.' },
      { key: 'system_prompt', label: 'System prompt', type: 'textarea', required: true },
      { key: 'temperature', label: 'Temperature', type: 'number', min: 0, max: 1, step: 0.1 },
      { key: 'max_tokens', label: 'Max tokens', type: 'number', min: 1, max: 200000 },
      { key: 'streaming', label: 'Streaming', type: 'boolean' },
      { key: 'guardrails.guardrail_id', label: 'Guardrail ID', type: 'string' },
      { key: 'guardrails.guardrail_version', label: 'Guardrail version', type: 'string', required: true, showIf: truthy('guardrails.guardrail_id') },
      { key: 'memory.enabled', label: 'AgentCore Memory enabled', type: 'boolean' },
      { key: 'memory.namespace', label: 'Memory namespace', type: 'string', placeholder: 'default', showIf: truthy('memory.enabled') },
      { key: 'memory.top_k', label: 'Memory recall top_k', type: 'number', min: 1, max: 50, showIf: truthy('memory.enabled') },
      { key: 'memory.ttl_seconds', label: 'Memory event expiry (seconds)', type: 'number', min: 60, max: 2592000, hint: 'Max 30 days (2592000s).', showIf: truthy('memory.enabled') },
      { key: 'tools', label: 'Attached tools', type: 'node_ref_list', nodeFilter: 'tool' },
    ],
    defaultPorts: {
      inputs: [p('message', 'User message', 'any', true), p('context', 'Context', 'any')],
      outputs: [p('response', 'Agent response', 'string'), p('tool_calls', 'Tool calls log', 'json')],
    },
  },
  multi_agent_coordinator: {
    type: 'multi_agent_coordinator', label: 'Multi-Agent', description: 'Supervisor agent routing tasks to sub-agents.',
    category: 'Agents & Orchestration', icon: '\ud83c\udfaf', categoryColor: 'border-purple-500',
    defaultConfig: { model_id: '', system_prompt: '', routing_strategy: 'llm_based', max_iterations: 10, workers: [] },
    configSchema: [
      { key: 'model_id', label: 'Bedrock model ID', type: 'string', required: true },
      { key: 'system_prompt', label: 'System prompt', type: 'textarea', required: true },
      { key: 'routing_strategy', label: 'Routing strategy', type: 'enum', options: ['llm_based', 'rule_based'] },
      { key: 'max_iterations', label: 'Max iterations', type: 'number', min: 1, max: 100 },
      { key: 'workers', label: 'Worker agents', type: 'node_ref_list', nodeFilter: 'worker_agent', required: true },
    ],
    defaultPorts: {
      inputs: [p('task', 'Task', 'any', true)],
      outputs: [p('result', 'Result', 'json')],
    },
  },
  human_in_the_loop: {
    type: 'human_in_the_loop', label: 'Human in the Loop', description: 'Pauses workflow awaiting human approval.',
    category: 'Agents & Orchestration', icon: '\ud83d\udc64', categoryColor: 'border-purple-500',
    defaultConfig: { notification: 'email', notification_target: '', timeout_seconds: 86400, timeout_action: 'reject' },
    configSchema: [
      { key: 'notification', label: 'Notification method', type: 'enum', required: true, options: ['email', 'sns', 'slack_webhook'] },
      { key: 'notification_target', label: 'Notification target', type: 'string', required: true },
      { key: 'timeout_seconds', label: 'Timeout (seconds)', type: 'number', min: 60 },
      { key: 'timeout_action', label: 'Timeout action', type: 'enum', options: ['reject', 'approve'] },
    ],
    defaultPorts: {
      inputs: [p('payload', 'Payload for review', 'any', true)],
      outputs: [p('approved', 'Approved', 'json'), p('rejected', 'Rejected', 'string')],
    },
  },
  tool_custom: {
    type: 'tool_custom', label: 'Custom Tool', description: 'Custom Python function in a Lambda.',
    category: 'Tools', icon: '\u26a1', categoryColor: 'border-orange-500',
    defaultConfig: { name: '', description: '', runtime: 'inline', inline_code: 'def handler(input):\n    return {"result": input}', timeout_seconds: 30, memory_mb: 256 },
    configSchema: [
      { key: 'name', label: 'Function name', type: 'string', required: true },
      { key: 'description', label: 'Description', type: 'textarea', required: true },
      { key: 'runtime', label: 'Runtime', type: 'enum', required: true, options: ['inline', 'lambda_arn'] },
      { key: 'inline_code', label: 'Inline code (Python)', type: 'code', language: 'python', required: true, showIf: eq('runtime', 'inline') },
      { key: 'lambda_arn', label: 'Lambda ARN', type: 'string', required: true, showIf: eq('runtime', 'lambda_arn') },
      { key: 'timeout_seconds', label: 'Timeout (seconds)', type: 'number', min: 1, max: 900 },
      { key: 'memory_mb', label: 'Memory (MB)', type: 'number', min: 128, max: 10240 },
    ],
    defaultPorts: {
      inputs: [p('input', 'Input', 'json')],
      outputs: [p('output', 'Output', 'json')],
    },
  },
  tool_athena: {
    type: 'tool_athena', label: 'Athena Query', description: 'Parameterized SQL query on Amazon Athena.',
    category: 'Tools', icon: '\ud83d\udd0d', categoryColor: 'border-orange-500',
    defaultConfig: { name: '', description: '', database: '', workgroup: 'primary', query_template: '', output_location: '', max_rows: 100 },
    configSchema: [
      { key: 'name', label: 'Tool name', type: 'string', required: true },
      { key: 'description', label: 'Description', type: 'textarea', required: true },
      { key: 'database', label: 'Database', type: 'string', required: true },
      { key: 'workgroup', label: 'Workgroup', type: 'string' },
      { key: 'query_template', label: 'SQL query (use ? for params)', type: 'code', required: true, language: 'sql' },
      { key: 'output_location', label: 'S3 output location', type: 'string', required: true },
      { key: 'max_rows', label: 'Max rows', type: 'number', min: 1, max: 10000 },
    ],
    defaultPorts: {
      inputs: [p('params', 'Query parameters', 'json')],
      outputs: [p('results', 'Query results', 'json')],
    },
  },
  tool_s3: {
    type: 'tool_s3', label: 'S3 Tool', description: 'Read/write S3 bucket.',
    category: 'Tools', icon: '\ud83e\udea3', categoryColor: 'border-orange-500',
    defaultConfig: { name: '', description: '', operation: 'read', bucket: '', key_template: '' },
    configSchema: [
      { key: 'name', label: 'Tool name', type: 'string', required: true },
      { key: 'description', label: 'Description', type: 'textarea', required: true },
      { key: 'operation', label: 'Operation', type: 'enum', required: true, options: ['read', 'write', 'list'] },
      { key: 'bucket', label: 'S3 bucket', type: 'string', required: true },
      { key: 'key_template', label: 'Key template', type: 'string', placeholder: 'data/{{variable}}.json' },
    ],
    defaultPorts: {
      inputs: [p('input', 'Input', 'any')],
      outputs: [p('output', 'Output', 'any')],
    },
  },
  tool_http: {
    type: 'tool_http', label: 'HTTP Tool', description: 'Call an external HTTP API.',
    category: 'Tools', icon: '\ud83c\udf10', categoryColor: 'border-orange-500',
    defaultConfig: { name: '', description: '', base_url: '', method: 'POST', auth: { type: 'none' }, timeout_seconds: 30 },
    configSchema: [
      { key: 'name', label: 'Tool name', type: 'string', required: true },
      { key: 'description', label: 'Description', type: 'textarea', required: true },
      { key: 'base_url', label: 'Base URL', type: 'string', required: true },
      { key: 'method', label: 'HTTP method', type: 'enum', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      { key: 'auth.type', label: 'Auth type', type: 'enum', options: ['none', 'api_key', 'bearer', 'oauth2_client_credentials'] },
      { key: 'auth.secret_ref', label: 'Secret reference', type: 'secret_ref', required: true, showIf: oneOf('auth.type', ['api_key', 'bearer', 'oauth2_client_credentials']) },
      { key: 'auth.oauth2.token_url', label: 'OAuth2 token URL', type: 'string', required: true, showIf: eq('auth.type', 'oauth2_client_credentials') },
      { key: 'auth.oauth2.scope', label: 'OAuth2 scope', type: 'string', showIf: eq('auth.type', 'oauth2_client_credentials') },
      { key: 'timeout_seconds', label: 'Timeout (seconds)', type: 'number', min: 1, max: 900 },
    ],
    defaultPorts: {
      inputs: [p('request', 'Request', 'json')],
      outputs: [p('response', 'Response', 'json'), p('status_code', 'Status code', 'string')],
    },
  },
  tool_bedrock: {
    type: 'tool_bedrock', label: 'Bedrock Tool', description: 'Direct Bedrock API call.',
    category: 'Tools', icon: '\ud83e\udde0', categoryColor: 'border-orange-500',
    defaultConfig: { name: '', description: '', operation: 'invoke_model', model_id: '', inference_profile_arn: '', timeout_seconds: 30 },
    configSchema: [
      { key: 'name', label: 'Tool name', type: 'string', required: true },
      { key: 'description', label: 'Description', type: 'textarea', required: true },
      { key: 'operation', label: 'Operation', type: 'enum', required: true, options: ['invoke_model', 'invoke_agent', 'invoke_model_with_response_stream'] },
      { key: 'model_id', label: 'Bedrock model ID', type: 'string', hint: 'Required unless inference profile ARN is set.', showIf: oneOf('operation', ['invoke_model', 'invoke_model_with_response_stream']) },
      { key: 'inference_profile_arn', label: 'Inference profile ARN', type: 'string', hint: 'Takes precedence over model ID.', showIf: oneOf('operation', ['invoke_model', 'invoke_model_with_response_stream']) },
      { key: 'agent_id', label: 'Bedrock Agent ID', type: 'string', required: true, showIf: eq('operation', 'invoke_agent') },
      { key: 'agent_alias_id', label: 'Agent alias ID', type: 'string', required: true, showIf: eq('operation', 'invoke_agent') },
      { key: 'timeout_seconds', label: 'Timeout (seconds)', type: 'number', min: 1, max: 900 },
    ],
    defaultPorts: {
      inputs: [p('input', 'Input', 'json')],
      outputs: [p('output', 'Output', 'json')],
    },
  },
  code_interpreter: {
    type: 'code_interpreter', label: 'Code Interpreter', description: 'Python code in AgentCore managed sandbox.',
    category: 'Agents & Orchestration', icon: '\ud83d\udc0d', categoryColor: 'border-purple-500',
    defaultConfig: { timeout_seconds: 30 },
    configSchema: [
      { key: 'timeout_seconds', label: 'Timeout (seconds)', type: 'number', min: 1, max: 900 },
    ],
    defaultPorts: {
      inputs: [p('input', 'Code + context', 'json', true)],
      outputs: [p('result', 'Execution result', 'json'), p('error', 'Error', 'string')],
    },
  },
  browser_tool: {
    type: 'browser_tool', label: 'Browser Tool', description: 'Headless browser via AgentCore.',
    category: 'Agents & Orchestration', icon: '\ud83c\udf0d', categoryColor: 'border-purple-500',
    defaultConfig: {},
    configSchema: [],
    defaultPorts: {
      inputs: [p('input', 'URL + action', 'json', true)],
      outputs: [p('result', 'Page result', 'json')],
    },
  },
  mcp_server: {
    type: 'mcp_server', label: 'MCP Server', description: 'MCP server on AgentCore Runtime.',
    category: 'MCP', icon: '\ud83d\udce1', categoryColor: 'border-yellow-500',
    defaultConfig: { name: '', transport: 'stdio' },
    configSchema: [
      { key: 'name', label: 'Server name', type: 'string', required: true },
      { key: 'transport', label: 'Transport', type: 'enum', required: true, options: ['stdio', 'sse'] },
    ],
    defaultPorts: { inputs: [], outputs: [p('server_url', 'Server URL', 'string')] },
  },
  mcp_client: {
    type: 'mcp_client', label: 'MCP Client', description: 'Connect to external MCP server.',
    category: 'MCP', icon: '\ud83d\udd17', categoryColor: 'border-yellow-500',
    defaultConfig: { server_url: '', transport: 'sse', auth: { type: 'none' } },
    configSchema: [
      { key: 'server_url', label: 'Server URL', type: 'string', required: true },
      { key: 'transport', label: 'Transport', type: 'enum', options: ['stdio', 'sse'] },
      { key: 'auth.type', label: 'Auth type', type: 'enum', options: ['none', 'bearer'] },
      { key: 'auth.secret_ref', label: 'Secret reference', type: 'secret_ref', required: true, showIf: eq('auth.type', 'bearer') },
    ],
    defaultPorts: { inputs: [], outputs: [p('tools', 'Available tools', 'json')] },
  },
  kb_s3_vector: {
    type: 'kb_s3_vector', label: 'S3 Vector Store', description: 'Amazon S3 Vectors vector store.',
    category: 'Knowledge Base / RAG', icon: '\ud83d\udcda', categoryColor: 'border-green-500',
    defaultConfig: { bucket: '', index_name: '', embedding_model_id: 'amazon.titan-embed-text-v2:0' },
    configSchema: [
      { key: 'bucket', label: 'S3 Vectors bucket', type: 'string', required: true },
      { key: 'index_name', label: 'Index name', type: 'string', required: true },
      { key: 'embedding_model_id', label: 'Embedding model ID', type: 'string', required: true },
    ],
    defaultPorts: { inputs: [], outputs: [p('retriever', 'Retriever', 'retriever')] },
  },
  kb_bedrock: {
    type: 'kb_bedrock', label: 'Bedrock KB', description: 'Amazon Bedrock managed Knowledge Base.',
    category: 'Knowledge Base / RAG', icon: '\ud83d\udcd6', categoryColor: 'border-green-500',
    defaultConfig: { knowledge_base_id: '', retrieval_config: { number_of_results: 5, search_type: 'SEMANTIC' } },
    configSchema: [
      { key: 'knowledge_base_id', label: 'Knowledge Base ID', type: 'string', required: true },
      { key: 'retrieval_config.number_of_results', label: 'Number of results', type: 'number', min: 1, max: 100 },
      { key: 'retrieval_config.search_type', label: 'Search type', type: 'enum', options: ['SEMANTIC', 'HYBRID'] },
    ],
    defaultPorts: { inputs: [], outputs: [p('retriever', 'Retriever', 'retriever')] },
  },
  chunking: {
    type: 'chunking', label: 'Chunking', description: 'Split documents into chunks.',
    category: 'Knowledge Base / RAG', icon: '\u2702\ufe0f', categoryColor: 'border-green-500',
    defaultConfig: { strategy: 'fixed_size', chunk_size: 512, chunk_overlap: 50 },
    configSchema: [
      { key: 'strategy', label: 'Strategy', type: 'enum', options: ['fixed_size', 'semantic', 'by_section'] },
      { key: 'chunk_size', label: 'Chunk size (tokens)', type: 'number', min: 64, max: 8192 },
      { key: 'chunk_overlap', label: 'Chunk overlap (tokens)', type: 'number', min: 0, max: 512 },
    ],
    defaultPorts: {
      inputs: [p('documents', 'Documents', 'document', true)],
      outputs: [p('chunks', 'Chunks', 'document')],
    },
  },
  embedding: {
    type: 'embedding', label: 'Embedding', description: 'Vectorize chunks via Bedrock embedding model.',
    category: 'Knowledge Base / RAG', icon: '\ud83d\udd22', categoryColor: 'border-green-500',
    defaultConfig: { model_id: 'amazon.titan-embed-text-v2:0', batch_size: 100 },
    configSchema: [
      { key: 'model_id', label: 'Embedding model ID', type: 'string', required: true },
      { key: 'batch_size', label: 'Batch size', type: 'number', min: 1, max: 500 },
    ],
    defaultPorts: {
      inputs: [p('chunks', 'Chunks', 'document', true)],
      outputs: [p('vectors', 'Vectors', 'vector')],
    },
  },
  retriever: {
    type: 'retriever', label: 'Retriever', description: 'Semantic query against vector store.',
    category: 'Knowledge Base / RAG', icon: '\ud83d\udd0e', categoryColor: 'border-green-500',
    defaultConfig: { top_k: 5, search_type: 'similarity' },
    configSchema: [
      { key: 'top_k', label: 'Top K results', type: 'number', required: true, min: 1, max: 100 },
      { key: 'search_type', label: 'Search type', type: 'enum', required: true, options: ['similarity', 'mmr', 'similarity_score_threshold'] },
      { key: 'score_threshold', label: 'Score threshold', type: 'number', min: 0, max: 1, step: 0.01 },
    ],
    defaultPorts: {
      inputs: [p('query', 'Query', 'any', true), p('retriever', 'Retriever', 'retriever', true)],
      outputs: [p('documents', 'Documents', 'document')],
    },
  },
  s3_source: {
    type: 's3_source', label: 'S3 Source', description: 'Load documents from S3 bucket.',
    category: 'Ingestion Pipelines', icon: '\ud83d\udcc2', categoryColor: 'border-teal-500',
    defaultConfig: { bucket: '', prefix: '', file_types: ['pdf', 'txt', 'docx'] },
    configSchema: [
      { key: 'bucket', label: 'S3 bucket', type: 'string', required: true },
      { key: 'prefix', label: 'Key prefix', type: 'string' },
    ],
    defaultPorts: { inputs: [], outputs: [p('documents', 'Documents', 'document')] },
  },
  document_parser: {
    type: 'document_parser', label: 'Document Parser', description: 'Parse raw bytes into structured documents.',
    category: 'Ingestion Pipelines', icon: '\ud83d\udcc4', categoryColor: 'border-teal-500',
    defaultConfig: { strategy: 'auto' },
    configSchema: [
      { key: 'strategy', label: 'Parse strategy', type: 'enum', options: ['auto', 'fast', 'hi_res'] },
    ],
    defaultPorts: {
      inputs: [p('raw', 'Raw document', 'any', true)],
      outputs: [p('document', 'Parsed document', 'document')],
    },
  },
  ingest_pipeline: {
    type: 'ingest_pipeline', label: 'Ingest Pipeline', description: 'End-to-end ingestion pipeline.',
    category: 'Ingestion Pipelines', icon: '\ud83d\udd04', categoryColor: 'border-teal-500',
    defaultConfig: { chunk_size: 512, embedding_model_id: 'amazon.titan-embed-text-v2:0' },
    configSchema: [
      { key: 'chunk_size', label: 'Chunk size', type: 'number', min: 64, max: 8192 },
      { key: 'embedding_model_id', label: 'Embedding model ID', type: 'string', required: true },
    ],
    defaultPorts: {
      inputs: [p('documents', 'Documents', 'document', true)],
      outputs: [p('vectors', 'Vectors', 'vector')],
    },
  },
  condition: {
    type: 'condition', label: 'Condition', description: 'Route flow based on JMESPath or CEL expression.',
    category: 'Flow Control', icon: '\ud83d\udd00', categoryColor: 'border-pink-500',
    defaultConfig: { expression: '', expression_language: 'jmespath' },
    configSchema: [
      { key: 'expression_language', label: 'Expression language', type: 'enum', required: true, options: ['jmespath', 'cel'] },
      { key: 'expression', label: 'Expression', type: 'string', required: true, placeholder: 'response == `yes`' },
    ],
    defaultPorts: {
      inputs: [p('payload', 'Payload', 'any', true)],
      outputs: [p('true', 'True', 'any'), p('false', 'False', 'any')],
    },
  },
  loop: {
    type: 'loop', label: 'Loop', description: 'Fan-out iteration via LangGraph Send API.',
    category: 'Flow Control', icon: '\ud83d\udd01', categoryColor: 'border-pink-500',
    defaultConfig: { max_concurrency: 10 },
    configSchema: [
      { key: 'max_concurrency', label: 'Max concurrency', type: 'number', min: 1, max: 100 },
    ],
    defaultPorts: {
      inputs: [p('items', 'Items', 'json', true)],
      outputs: [p('item', 'Item (per-iteration)', 'any'), p('results', 'Results (post-loop)', 'json')],
    },
  },
  cache: {
    type: 'cache', label: 'Cache', description: 'DynamoDB-backed cache.',
    category: 'Flow Control', icon: '\ud83d\udcbe', categoryColor: 'border-pink-500',
    defaultConfig: { backend: 'dynamodb', key_expression: '', ttl_seconds: 3600, table_name: '' },
    configSchema: [
      { key: 'backend', label: 'Backend', type: 'enum', required: true, options: ['dynamodb'] },
      { key: 'key_expression', label: 'Cache key expression', type: 'string', required: true },
      { key: 'ttl_seconds', label: 'TTL (seconds)', type: 'number', min: 60 },
      { key: 'table_name', label: 'DynamoDB table name', type: 'string', required: true },
    ],
    defaultPorts: {
      inputs: [p('input', 'Input', 'any', true)],
      outputs: [p('output', 'Output', 'any'), p('cache_hit', 'Cache hit', 'boolean')],
    },
  },
  logger: {
    type: 'logger', label: 'Logger', description: 'CloudWatch log entry pass-through.',
    category: 'Flow Control', icon: '\ud83d\udcdd', categoryColor: 'border-pink-500',
    defaultConfig: { level: 'INFO', message_template: '{{payload}}', include_payload: false },
    configSchema: [
      { key: 'level', label: 'Log level', type: 'enum', options: ['DEBUG', 'INFO', 'WARNING', 'ERROR'] },
      { key: 'message_template', label: 'Message template', type: 'string' },
      { key: 'include_payload', label: 'Include payload in log', type: 'boolean' },
    ],
    defaultPorts: {
      inputs: [p('payload', 'Payload', 'any', true)],
      outputs: [p('payload', 'Payload (pass-through)', 'any')],
    },
  },
};

export const CATEGORY_NODES: Record<NodeCategory, NodeType[]> = {
  'Input / Output': ['input', 'output'],
  'Agents & Orchestration': ['agent', 'multi_agent_coordinator', 'human_in_the_loop', 'code_interpreter', 'browser_tool'],
  'Tools': ['tool_custom', 'tool_athena', 'tool_s3', 'tool_http', 'tool_bedrock'],
  'MCP': ['mcp_server', 'mcp_client'],
  'Knowledge Base / RAG': ['kb_s3_vector', 'kb_bedrock', 'chunking', 'embedding', 'retriever'],
  'Ingestion Pipelines': ['s3_source', 'document_parser', 'ingest_pipeline'],
  'Flow Control': ['condition', 'loop', 'cache', 'logger'],
};

export const PORT_COLORS: Record<string, string> = {
  any: 'bg-gray-400', string: 'bg-blue-400', json: 'bg-orange-400',
  document: 'bg-purple-400', vector: 'bg-teal-400', retriever: 'bg-pink-400',
  control: 'bg-yellow-400', boolean: 'bg-green-400',
};

export const DATA_TYPE_COMPATIBLE = (source: string, target: string): boolean => {
  if (target === 'any' || source === 'any') return true;
  return source === target;
};
