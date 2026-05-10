import type { Project } from '../types/graph';

export interface Template {
  id: string;
  name: string;
  description: string;
  tags: string[];
  nodeCount: number;
  project: Project;
}

export const TEMPLATES: Template[] = [
  {
    id: 'simple-chatbot',
    name: 'Simple Chatbot',
    description: 'Basic conversational agent with a single Claude model. Good starting point.',
    tags: ['beginner', 'chat'],
    nodeCount: 3,
    project: {
      name: 'simple-chatbot',
      nodes: [
        {
          id: 'input-1',
          type: 'input',
          label: 'User Input',
          position: { x: 80, y: 200 },
          config: { trigger: 'http', 'http.method': 'POST', 'http.path': '/invoke', 'http.auth': 'none' },
          ports: { inputs: [], outputs: [{ id: 'payload', name: 'Payload', data_type: 'json' }] },
        },
        {
          id: 'agent-1',
          type: 'agent',
          label: 'Chat Agent',
          position: { x: 320, y: 200 },
          config: {
            model_id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
            system_prompt: 'You are a helpful AI assistant. Respond clearly and concisely.',
            temperature: 0.7,
            max_tokens: 2048,
            streaming: false,
            tools: [],
            memory: { enabled: false, namespace: 'default', top_k: 5, ttl_seconds: 3600 },
          },
          ports: {
            inputs: [{ id: 'message', name: 'User message', data_type: 'any', required: true }, { id: 'context', name: 'Context', data_type: 'any' }],
            outputs: [{ id: 'response', name: 'Agent response', data_type: 'string' }, { id: 'tool_calls', name: 'Tool calls log', data_type: 'json' }],
          },
        },
        {
          id: 'output-1',
          type: 'output',
          label: 'Response',
          position: { x: 580, y: 200 },
          config: { mode: 'json', status_code: 200 },
          ports: { inputs: [{ id: 'payload', name: 'Payload', data_type: 'any', required: true }], outputs: [] },
        },
      ],
      edges: [
        { id: 'e1', source_node_id: 'input-1', source_port_id: 'payload', target_node_id: 'agent-1', target_port_id: 'message', data_type: 'any' },
        { id: 'e2', source_node_id: 'agent-1', source_port_id: 'response', target_node_id: 'output-1', target_port_id: 'payload', data_type: 'string' },
      ],
    },
  },

  {
    id: 'rag-agent',
    name: 'RAG Agent',
    description: 'Retrieval-Augmented Generation with S3 Vectors knowledge base. Grounds answers in your documents.',
    tags: ['rag', 'knowledge-base', 's3-vectors'],
    nodeCount: 5,
    project: {
      name: 'rag-agent',
      nodes: [
        {
          id: 'input-1',
          type: 'input',
          label: 'User Input',
          position: { x: 80, y: 240 },
          config: { trigger: 'http', 'http.method': 'POST', 'http.path': '/invoke', 'http.auth': 'none' },
          ports: { inputs: [], outputs: [{ id: 'payload', name: 'Payload', data_type: 'json' }] },
        },
        {
          id: 'kb-1',
          type: 'kb_s3_vector',
          label: 'S3 Vector Store',
          position: { x: 300, y: 80 },
          config: { bucket: 'my-vectors-bucket', index_name: 'docs-index', embedding_model_id: 'amazon.titan-embed-text-v2:0' },
          ports: {
            inputs: [{ id: 'vectors', name: 'Vectors (ingest)', data_type: 'vector' }],
            outputs: [{ id: 'retriever', name: 'Retriever', data_type: 'retriever' }],
          },
        },
        {
          id: 'retriever-1',
          type: 'retriever',
          label: 'Retriever',
          position: { x: 300, y: 240 },
          config: { top_k: 5, search_type: 'similarity' },
          ports: {
            inputs: [{ id: 'query', name: 'Query', data_type: 'any', required: true }, { id: 'retriever', name: 'Retriever', data_type: 'retriever', required: true }],
            outputs: [{ id: 'documents', name: 'Documents', data_type: 'document' }],
          },
        },
        {
          id: 'agent-1',
          type: 'agent',
          label: 'RAG Agent',
          position: { x: 540, y: 240 },
          config: {
            model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            system_prompt: 'You are a helpful assistant. Use the provided context to answer questions accurately. If the context does not contain the answer, say so.',
            temperature: 0.3,
            max_tokens: 4096,
            streaming: false,
            tools: [],
            memory: { enabled: false, namespace: 'default', top_k: 5, ttl_seconds: 3600 },
          },
          ports: {
            inputs: [{ id: 'message', name: 'User message', data_type: 'any', required: true }, { id: 'context', name: 'Context', data_type: 'any' }],
            outputs: [{ id: 'response', name: 'Agent response', data_type: 'string' }, { id: 'tool_calls', name: 'Tool calls log', data_type: 'json' }],
          },
        },
        {
          id: 'output-1',
          type: 'output',
          label: 'Response',
          position: { x: 780, y: 240 },
          config: { mode: 'json', status_code: 200 },
          ports: { inputs: [{ id: 'payload', name: 'Payload', data_type: 'any', required: true }], outputs: [] },
        },
      ],
      edges: [
        { id: 'e1', source_node_id: 'input-1', source_port_id: 'payload', target_node_id: 'retriever-1', target_port_id: 'query', data_type: 'any' },
        { id: 'e2', source_node_id: 'kb-1', source_port_id: 'retriever', target_node_id: 'retriever-1', target_port_id: 'retriever', data_type: 'retriever' },
        { id: 'e3', source_node_id: 'input-1', source_port_id: 'payload', target_node_id: 'agent-1', target_port_id: 'message', data_type: 'any' },
        { id: 'e4', source_node_id: 'retriever-1', source_port_id: 'documents', target_node_id: 'agent-1', target_port_id: 'context', data_type: 'document' },
        { id: 'e5', source_node_id: 'agent-1', source_port_id: 'response', target_node_id: 'output-1', target_port_id: 'payload', data_type: 'string' },
      ],
    },
  },

  {
    id: 'hitl-approval',
    name: 'Human-in-the-Loop Approval',
    description: 'Agent drafts a response, a human approves or rejects before it is sent. Uses DynamoDB checkpointer.',
    tags: ['hitl', 'approval', 'governance'],
    nodeCount: 4,
    project: {
      name: 'hitl-approval',
      nodes: [
        {
          id: 'input-1',
          type: 'input',
          label: 'Request',
          position: { x: 80, y: 200 },
          config: { trigger: 'http', 'http.method': 'POST', 'http.path': '/invoke', 'http.auth': 'none' },
          ports: { inputs: [], outputs: [{ id: 'payload', name: 'Payload', data_type: 'json' }] },
        },
        {
          id: 'agent-1',
          type: 'agent',
          label: 'Draft Agent',
          position: { x: 320, y: 200 },
          config: {
            model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            system_prompt: 'Draft a response to the user request. Be thorough.',
            temperature: 0.5,
            max_tokens: 4096,
            streaming: false,
            tools: [],
            memory: { enabled: false, namespace: 'default', top_k: 5, ttl_seconds: 3600 },
          },
          ports: {
            inputs: [{ id: 'message', name: 'User message', data_type: 'any', required: true }, { id: 'context', name: 'Context', data_type: 'any' }],
            outputs: [{ id: 'response', name: 'Agent response', data_type: 'string' }, { id: 'tool_calls', name: 'Tool calls log', data_type: 'json' }],
          },
        },
        {
          id: 'hitl-1',
          type: 'human_in_the_loop',
          label: 'Human Review',
          position: { x: 560, y: 200 },
          config: { notification: 'email', notification_target: 'reviewer@example.com', timeout_seconds: 86400, timeout_action: 'reject' },
          ports: {
            inputs: [{ id: 'payload', name: 'Payload for review', data_type: 'any', required: true }],
            outputs: [{ id: 'approved', name: 'Approved', data_type: 'json' }, { id: 'rejected', name: 'Rejected', data_type: 'string' }],
          },
        },
        {
          id: 'output-1',
          type: 'output',
          label: 'Approved Response',
          position: { x: 800, y: 200 },
          config: { mode: 'json', status_code: 200 },
          ports: { inputs: [{ id: 'payload', name: 'Payload', data_type: 'any', required: true }], outputs: [] },
        },
      ],
      edges: [
        { id: 'e1', source_node_id: 'input-1', source_port_id: 'payload', target_node_id: 'agent-1', target_port_id: 'message', data_type: 'any' },
        { id: 'e2', source_node_id: 'agent-1', source_port_id: 'response', target_node_id: 'hitl-1', target_port_id: 'payload', data_type: 'string' },
        { id: 'e3', source_node_id: 'hitl-1', source_port_id: 'approved', target_node_id: 'output-1', target_port_id: 'payload', data_type: 'json' },
      ],
    },
  },

  {
    id: 'multi-agent',
    name: 'Multi-Agent Coordinator',
    description: 'Supervisor routes tasks to specialized sub-agents. Great for complex workflows.',
    tags: ['multi-agent', 'orchestration'],
    nodeCount: 5,
    project: {
      name: 'multi-agent',
      nodes: [
        {
          id: 'input-1',
          type: 'input',
          label: 'Task',
          position: { x: 80, y: 220 },
          config: { trigger: 'http', 'http.method': 'POST', 'http.path': '/invoke', 'http.auth': 'none' },
          ports: { inputs: [], outputs: [{ id: 'payload', name: 'Payload', data_type: 'json' }] },
        },
        {
          id: 'coordinator-1',
          type: 'multi_agent_coordinator',
          label: 'Coordinator',
          position: { x: 320, y: 220 },
          config: {
            model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            system_prompt: 'You are a supervisor. Route tasks to the most appropriate specialist agent.',
            routing_strategy: 'llm_based',
            max_iterations: 10,
            workers: ['researcher-1', 'writer-1'],
          },
          ports: {
            inputs: [{ id: 'task', name: 'Task', data_type: 'any', required: true }],
            outputs: [{ id: 'result', name: 'Result', data_type: 'json' }],
          },
        },
        {
          id: 'researcher-1',
          type: 'agent',
          label: 'Researcher',
          position: { x: 560, y: 120 },
          config: {
            model_id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
            system_prompt: 'You are a research specialist. Find and summarize relevant information.',
            temperature: 0.3,
            max_tokens: 4096,
            streaming: false,
            tools: [],
            memory: { enabled: false, namespace: 'default', top_k: 5, ttl_seconds: 3600 },
          },
          ports: {
            inputs: [{ id: 'message', name: 'User message', data_type: 'any', required: true }, { id: 'context', name: 'Context', data_type: 'any' }],
            outputs: [{ id: 'response', name: 'Agent response', data_type: 'string' }, { id: 'tool_calls', name: 'Tool calls log', data_type: 'json' }],
          },
        },
        {
          id: 'writer-1',
          type: 'agent',
          label: 'Writer',
          position: { x: 560, y: 320 },
          config: {
            model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            system_prompt: 'You are a writing specialist. Produce clear, well-structured content.',
            temperature: 0.7,
            max_tokens: 8192,
            streaming: false,
            tools: [],
            memory: { enabled: false, namespace: 'default', top_k: 5, ttl_seconds: 3600 },
          },
          ports: {
            inputs: [{ id: 'message', name: 'User message', data_type: 'any', required: true }, { id: 'context', name: 'Context', data_type: 'any' }],
            outputs: [{ id: 'response', name: 'Agent response', data_type: 'string' }, { id: 'tool_calls', name: 'Tool calls log', data_type: 'json' }],
          },
        },
        {
          id: 'output-1',
          type: 'output',
          label: 'Result',
          position: { x: 820, y: 220 },
          config: { mode: 'json', status_code: 200 },
          ports: { inputs: [{ id: 'payload', name: 'Payload', data_type: 'any', required: true }], outputs: [] },
        },
      ],
      edges: [
        { id: 'e1', source_node_id: 'input-1', source_port_id: 'payload', target_node_id: 'coordinator-1', target_port_id: 'task', data_type: 'any' },
        { id: 'e2', source_node_id: 'coordinator-1', source_port_id: 'result', target_node_id: 'output-1', target_port_id: 'payload', data_type: 'json' },
      ],
    },
  },

  {
    id: 'agent-with-tools',
    name: 'Agent with Tools',
    description: 'Claude agent that calls a SQL (Athena) tool and an HTTP API tool. Tools attach via the agent config — no edges needed.',
    tags: ['tools', 'function-calling', 'sql'],
    nodeCount: 5,
    project: {
      name: 'agent-with-tools',
      nodes: [
        {
          id: 'input-1',
          type: 'input',
          label: 'User Question',
          position: { x: 80, y: 240 },
          config: { trigger: 'http', 'http.method': 'POST', 'http.path': '/invoke', 'http.auth': 'none' },
          ports: { inputs: [], outputs: [{ id: 'payload', name: 'Payload', data_type: 'json' }] },
        },
        {
          id: 'tool-athena-1',
          type: 'tool_athena',
          label: 'Orders DB',
          position: { x: 80, y: 60 },
          config: {
            name: 'query_orders',
            description: 'Query the orders database. Filters by customer_id (string).',
            database: 'analytics',
            workgroup: 'primary',
            query_template: 'SELECT order_id, total, status, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50',
            output_location: 's3://my-athena-results/',
            max_rows: 100,
          },
          ports: {
            inputs: [{ id: 'params', name: 'Query parameters', data_type: 'json' }],
            outputs: [{ id: 'results', name: 'Query results', data_type: 'json' }],
          },
        },
        {
          id: 'tool-http-1',
          type: 'tool_http',
          label: 'Shipping API',
          position: { x: 80, y: 460 },
          config: {
            name: 'get_shipping_status',
            description: 'Get shipping status for a tracking number from the carrier API.',
            base_url: 'https://api.example-carrier.com/v1/track',
            method: 'GET',
            auth: { type: 'bearer', secret_ref: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:carrier-api-token' },
            timeout_seconds: 15,
          },
          ports: {
            inputs: [{ id: 'request', name: 'Request', data_type: 'json' }],
            outputs: [{ id: 'response', name: 'Response', data_type: 'json' }, { id: 'status_code', name: 'Status code', data_type: 'string' }],
          },
        },
        {
          id: 'agent-1',
          type: 'agent',
          label: 'Support Agent',
          position: { x: 380, y: 240 },
          config: {
            model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
            inference_profile_arn: '',
            system_prompt: 'You are a customer support agent. Use the query_orders tool to look up customer order history and the get_shipping_status tool to check delivery status. Cite the data you used in your answer.',
            temperature: 0.3,
            max_tokens: 4096,
            streaming: false,
            tools: ['tool-athena-1', 'tool-http-1'],
            memory: { enabled: false, namespace: 'default', top_k: 5, ttl_seconds: 3600 },
          },
          ports: {
            inputs: [{ id: 'message', name: 'User message', data_type: 'any', required: true }, { id: 'context', name: 'Context', data_type: 'any' }],
            outputs: [{ id: 'response', name: 'Agent response', data_type: 'string' }, { id: 'tool_calls', name: 'Tool calls log', data_type: 'json' }],
          },
        },
        {
          id: 'output-1',
          type: 'output',
          label: 'Reply',
          position: { x: 660, y: 240 },
          config: { mode: 'json', status_code: 200 },
          ports: { inputs: [{ id: 'payload', name: 'Payload', data_type: 'any', required: true }], outputs: [] },
        },
      ],
      edges: [
        { id: 'e1', source_node_id: 'input-1', source_port_id: 'payload', target_node_id: 'agent-1', target_port_id: 'message', data_type: 'any' },
        { id: 'e2', source_node_id: 'agent-1', source_port_id: 'response', target_node_id: 'output-1', target_port_id: 'payload', data_type: 'string' },
      ],
    },
  },

  {
    id: 'data-ingestion',
    name: 'Document Ingestion Pipeline',
    description: 'End-to-end S3 → parse → chunk → embed → S3 Vectors pipeline for building RAG knowledge bases.',
    tags: ['ingestion', 'rag', 'pipeline'],
    nodeCount: 5,
    project: {
      name: 'doc-ingestion',
      nodes: [
        {
          id: 's3-source-1',
          type: 's3_source',
          label: 'S3 Source',
          position: { x: 80, y: 220 },
          config: { bucket: 'my-documents-bucket', prefix: 'docs/', file_types: ['pdf', 'txt', 'docx'] },
          ports: { inputs: [], outputs: [{ id: 'documents', name: 'Documents', data_type: 'document' }] },
        },
        {
          id: 'parser-1',
          type: 'document_parser',
          label: 'Document Parser',
          position: { x: 280, y: 220 },
          config: { strategy: 'auto' },
          ports: {
            inputs: [{ id: 'raw', name: 'Raw document', data_type: 'any', required: true }],
            outputs: [{ id: 'document', name: 'Parsed document', data_type: 'document' }],
          },
        },
        {
          id: 'chunker-1',
          type: 'chunking',
          label: 'Chunking',
          position: { x: 480, y: 220 },
          config: { strategy: 'fixed_size', chunk_size: 512, chunk_overlap: 50 },
          ports: {
            inputs: [{ id: 'documents', name: 'Documents', data_type: 'document', required: true }],
            outputs: [{ id: 'chunks', name: 'Chunks', data_type: 'document' }],
          },
        },
        {
          id: 'embedding-1',
          type: 'embedding',
          label: 'Embedding',
          position: { x: 680, y: 220 },
          config: { model_id: 'amazon.titan-embed-text-v2:0', batch_size: 100 },
          ports: {
            inputs: [{ id: 'chunks', name: 'Chunks', data_type: 'document', required: true }],
            outputs: [{ id: 'vectors', name: 'Vectors', data_type: 'vector' }],
          },
        },
        {
          id: 'kb-1',
          type: 'kb_s3_vector',
          label: 'S3 Vector Store',
          position: { x: 880, y: 220 },
          config: { bucket: 'my-vectors-bucket', index_name: 'docs-index', embedding_model_id: 'amazon.titan-embed-text-v2:0' },
          ports: {
            inputs: [{ id: 'vectors', name: 'Vectors (ingest)', data_type: 'vector' }],
            outputs: [{ id: 'retriever', name: 'Retriever', data_type: 'retriever' }],
          },
        },
      ],
      edges: [
        { id: 'e1', source_node_id: 's3-source-1', source_port_id: 'documents', target_node_id: 'parser-1', target_port_id: 'raw', data_type: 'document' },
        { id: 'e2', source_node_id: 'parser-1', source_port_id: 'document', target_node_id: 'chunker-1', target_port_id: 'documents', data_type: 'document' },
        { id: 'e3', source_node_id: 'chunker-1', source_port_id: 'chunks', target_node_id: 'embedding-1', target_port_id: 'chunks', data_type: 'document' },
        { id: 'e4', source_node_id: 'embedding-1', source_port_id: 'vectors', target_node_id: 'kb-1', target_port_id: 'vectors', data_type: 'vector' },
      ],
    },
  },
];
