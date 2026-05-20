"""End-to-end pipeline tests for user-requested workflows.

Workflow 1: API Gateway -> AgentCore Runtime -> RAG agent (S3 Vectors KB + AgentCore Memory)
Workflow 2: S3 source -> chunk -> embed -> ingest into S3 Vectors bucket
"""
from __future__ import annotations

import pytest

from engine.models.graph import Project
from engine.pipeline.compiler.compiler import compile_graph
from engine.pipeline.iac_generator import generate_iac
from engine.pipeline.local_scaffold import generate_local_scaffold
from engine.pipeline.test_generator import generate_tests
from engine.pipeline.validator import validate
from engine.pipeline import bundler

from tests.conftest import make_edge, make_node, make_port


# -----------------------------
# Workflow 1: RAG agent
# -----------------------------

@pytest.fixture
def rag_agent_project() -> Project:
    """API Gateway -> AgentCore Runtime -> agent (memory) + S3 Vectors KB.

    Topology:
        input(http) ----message---> agent ---response---> output
        kb_s3_vector ---retriever---> agent (context)
    """
    input_node = make_node(
        "input", "n_input",
        config={
            "trigger": "http",
            "http": {"method": "POST", "path": "/invoke", "auth": "jwt"},
        },
        outputs=[make_port("payload", "Payload", "json")],
    )

    kb_node = make_node(
        "kb_s3_vector", "n_kb",
        config={
            "bucket": "rag-vectors-prod",
            "index_name": "docs-index",
            "embedding_model_id": "amazon.titan-embed-text-v2:0",
        },
        outputs=[make_port("retriever", "Retriever", "any")],
    )

    agent_node = make_node(
        "agent", "n_agent",
        config={
            "model_id": "anthropic.claude-3-5-sonnet-20241022-v2:0",
            "system_prompt": "You are a RAG assistant. Use retrieved context to answer.",
            "temperature": 0.3,
            "max_tokens": 4096,
            "streaming": False,
            "tools": [],
            "memory": {"enabled": True, "backend": "dynamodb", "ttl_seconds": 3600},
        },
        inputs=[
            make_port("message", "User message", "any", required=True),
            make_port("context", "Retrieved context", "any"),
        ],
        outputs=[
            make_port("response", "Agent response", "string"),
            make_port("tool_calls", "Tool calls", "json"),
        ],
    )

    output_node = make_node(
        "output", "n_output",
        config={"mode": "json", "status_code": 200},
        inputs=[make_port("payload", "Payload", "any", required=True)],
    )

    edges = [
        make_edge("n_input", "payload", "n_agent", "message", "any"),
        make_edge("n_kb", "retriever", "n_agent", "context", "any"),
        make_edge("n_agent", "response", "n_output", "payload", "any"),
    ]

    return Project(
        name="rag-agent",
        description="API Gateway -> AgentCore Runtime, RAG over S3 Vectors with AgentCore Memory",
        nodes=[input_node, kb_node, agent_node, output_node],
        edges=edges,
    )


def test_rag_agent_validates(rag_agent_project: Project):
    result = validate(rag_agent_project)
    assert result.valid, [e.to_dict() for e in result.errors]


def test_rag_agent_emits_kb_node_querying_s3vectors(rag_agent_project: Project):
    result = validate(rag_agent_project)
    artifacts = compile_graph(rag_agent_project, result.sorted_nodes)
    kb_py = artifacts.files["agent/nodes/n_kb.py"]
    assert 's3vectors' in kb_py
    assert 'rag-vectors-prod' in kb_py
    assert 'docs-index' in kb_py
    assert 'BedrockEmbeddings' in kb_py
    assert 'amazon.titan-embed-text-v2:0' in kb_py


def test_rag_agent_uses_agentcore_memory_real_api(rag_agent_project: Project):
    """Asserts the agent node uses the real AgentCore Memory SDK API."""
    result = validate(rag_agent_project)
    artifacts = compile_graph(rag_agent_project, result.sorted_nodes)
    agent_py = artifacts.files["agent/nodes/n_agent.py"]

    # Real SDK API — not the placeholder retrieve/store
    assert 'from bedrock_agentcore.memory import MemoryClient' in agent_py
    assert 'MemoryClient(region_name=AWS_REGION)' in agent_py
    assert '_memory.retrieve_memories(' in agent_py
    assert '_memory.create_event(' in agent_py
    assert 'memory_id=MEMORY_ID' in agent_py
    assert 'actor_id=actor_id' in agent_py
    assert 'session_id=session_id' in agent_py
    assert '"USER"' in agent_py and '"ASSISTANT"' in agent_py

    # Old placeholder calls must be gone
    assert '_memory.retrieve(query=' not in agent_py
    assert '_memory.store(content=' not in agent_py


def test_rag_agent_state_carries_actor_and_session(rag_agent_project: Project):
    result = validate(rag_agent_project)
    artifacts = compile_graph(rag_agent_project, result.sorted_nodes)
    state_py = artifacts.files["agent/state.py"]
    assert 'actor_id: str' in state_py
    assert 'session_id: str' in state_py


def test_rag_agent_runner_propagates_actor_id(rag_agent_project: Project):
    result = validate(rag_agent_project)
    artifacts = compile_graph(rag_agent_project, result.sorted_nodes)
    runner = artifacts.files['agent/runner.py']
    assert 'session_context.get("actor_id")' in runner
    assert 'actor_id=actor_id' in runner
    assert 'session_id=session_id' in runner


def test_rag_agent_memory_tf_declares_strategies(rag_agent_project: Project):
    result = validate(rag_agent_project)
    iac = generate_iac(rag_agent_project, result.sorted_nodes)
    mem_tf = iac.files['infra/agentcore_memory.tf']
    assert 'semantic_memory_strategy' in mem_tf
    assert 'summary_memory_strategy' in mem_tf
    assert 'user_preference_memory_strategy' in mem_tf
    assert '/actor/{actorId}' in mem_tf
    assert '/session/{sessionId}' in mem_tf


def test_rag_agent_iac_includes_apigw_agentcore_memory(rag_agent_project: Project):
    result = validate(rag_agent_project)
    iac = generate_iac(rag_agent_project, result.sorted_nodes)
    files = iac.files

    assert 'infra/api_gateway.tf' in files
    assert 'aws_apigatewayv2_api' in files['infra/api_gateway.tf']
    assert 'POST /invoke' in files['infra/api_gateway.tf']

    assert 'infra/agentcore.tf' in files
    assert 'aws_bedrockagentcore_agent_runtime' in files['infra/agentcore.tf']

    assert 'infra/agentcore_memory.tf' in files
    assert 'aws_bedrockagentcore_memory' in files['infra/agentcore_memory.tf']

    iam = files['infra/iam.tf']
    assert 'bedrock-agentcore:RetrieveMemories' in iam
    assert 'bedrock-agentcore:StoreMemories' in iam

    outputs = files['infra/outputs.tf']
    assert 'api_gateway_url' in outputs
    assert 'agentcore_runtime_arn' in outputs
    assert 'memory_id' in outputs


def test_rag_agent_runner_uses_agentcore_runtime(rag_agent_project: Project):
    result = validate(rag_agent_project)
    artifacts = compile_graph(rag_agent_project, result.sorted_nodes)
    runner = artifacts.files['agent/runner.py']
    assert 'BedrockAgentCoreApp' in runner
    assert '@app.entrypoint' in runner
    assert 'graph.ainvoke' in runner
    assert 'def lambda_handler' not in runner


def test_rag_agent_no_lambda_for_agent(rag_agent_project: Project):
    """Agent must run on AgentCore Runtime — no aws_lambda_function.agent."""
    result = validate(rag_agent_project)
    iac = generate_iac(rag_agent_project, result.sorted_nodes)
    lambda_tf = iac.files['infra/lambda.tf']
    assert 'aws_lambda_function" "agent"' not in lambda_tf
    # API GW must route to the AgentCore invoker Lambda, not to a Lambda hosting the agent
    apigw_tf = iac.files['infra/api_gateway.tf']
    assert 'aws_lambda_function.agentcore_invoker.invoke_arn' in apigw_tf
    assert 'bedrock-agentcore:InvokeAgentRuntime' in apigw_tf


def test_agent_runs_in_private_vpc(rag_agent_project: Project):
    """Agents must run in a private VPC with no internet egress."""
    result = validate(rag_agent_project)
    iac = generate_iac(rag_agent_project, result.sorted_nodes)
    files = iac.files

    # Dedicated VPC module is emitted.
    assert 'infra/vpc.tf' in files
    vpc_tf = files['infra/vpc.tf']
    assert 'aws_vpc" "agent"' in vpc_tf
    # No internet path — confirms zero egress.
    assert 'aws_internet_gateway' not in vpc_tf
    assert 'aws_nat_gateway' not in vpc_tf
    # AWS APIs reached via PrivateLink endpoints.
    assert 'bedrock-agentcore' in vpc_tf
    assert 'ecr.api' in vpc_tf
    assert 'aws_vpc_endpoint' in vpc_tf

    # AgentCore Runtime is placed in the VPC, not PUBLIC.
    agentcore_tf = files['infra/agentcore.tf']
    assert 'network_mode = "VPC"' in agentcore_tf
    assert '"PUBLIC"' not in agentcore_tf
    assert 'vpc_config' in agentcore_tf

    # Network variables exist with create_vpc default true.
    variables_tf = files['infra/variables.tf']
    assert 'create_vpc' in variables_tf
    assert 'egress_allowlist_cidrs' in variables_tf

    # The API GW invoker Lambda is VPC-attached.
    assert 'vpc_config' in files['infra/api_gateway.tf']


def test_rag_agent_dockerfile_runs_agentcore_app(rag_agent_project: Project):
    from engine.pipeline.local_scaffold import generate_local_scaffold
    scaffold = generate_local_scaffold(rag_agent_project)
    dockerfile = scaffold.files['Dockerfile']
    assert 'python:3.12-slim' in dockerfile
    assert 'python' in dockerfile and '-m' in dockerfile and 'agent.runner' in dockerfile
    assert 'lambda_handler' not in dockerfile
    assert 'public.ecr.aws/lambda' not in dockerfile


def test_observability_uses_agentcore_not_langsmith(rag_agent_project: Project):
    from engine.pipeline.observability import inject_observability
    result = validate(rag_agent_project)
    artifacts = compile_graph(rag_agent_project, result.sorted_nodes)
    inject_observability(rag_agent_project, artifacts)
    obs = artifacts.files['agent/observability.py']
    assert 'bedrock_agentcore.observability' in obs
    assert 'configure' in obs
    assert 'LANGCHAIN' not in obs
    assert 'langsmith' not in obs.lower()


def test_pyproject_drops_langsmith(rag_agent_project: Project):
    from engine.pipeline.local_scaffold import generate_local_scaffold
    scaffold = generate_local_scaffold(rag_agent_project)
    pyproject = scaffold.files['pyproject.toml']
    assert 'bedrock-agentcore' in pyproject
    assert 'langsmith' not in pyproject


def test_env_example_drops_langsmith(rag_agent_project: Project):
    from engine.pipeline.local_scaffold import generate_local_scaffold
    scaffold = generate_local_scaffold(rag_agent_project)
    env = scaffold.files['.env.example']
    assert 'LANGCHAIN' not in env
    assert 'langsmith' not in env.lower()


def test_rag_agent_full_zip_bundles(rag_agent_project: Project):
    result = validate(rag_agent_project)
    assert result.valid
    artifacts = compile_graph(rag_agent_project, result.sorted_nodes)
    artifacts.merge(generate_iac(rag_agent_project, result.sorted_nodes))
    artifacts.merge(generate_tests(rag_agent_project))
    artifacts.merge(generate_local_scaffold(rag_agent_project))
    zip_bytes = bundler.bundle(rag_agent_project, artifacts)
    assert isinstance(zip_bytes, (bytes, bytearray))
    assert len(zip_bytes) > 0
    assert zip_bytes[:2] == b"PK"  # ZIP magic


# -----------------------------
# Workflow 2: Ingestion pipeline
# -----------------------------

@pytest.fixture
def ingestion_project() -> Project:
    """S3 source -> chunking -> embedding -> output (writing to S3 Vectors bucket).

    The output node carries the destination bucket config; the embedding stage
    produces vectors that the runtime PUTs into the S3 Vectors index.
    """
    input_node = make_node(
        "input", "n_input",
        config={
            "trigger": "s3_event",
            "s3_event": {"bucket": "rag-source-docs", "prefix": "incoming/"},
        },
        outputs=[make_port("payload", "Payload", "json")],
    )

    s3_src = make_node(
        "s3_source", "n_s3",
        config={
            "bucket": "rag-source-docs",
            "prefix": "incoming/",
            "file_types": ["pdf", "txt", "docx"],
        },
        outputs=[make_port("documents", "Documents", "document")],
    )

    chunk = make_node(
        "chunking", "n_chunk",
        config={"strategy": "fixed_size", "chunk_size": 512, "chunk_overlap": 50},
        inputs=[make_port("documents", "Documents", "document", required=True)],
        outputs=[make_port("chunks", "Chunks", "document")],
    )

    embed = make_node(
        "embedding", "n_embed",
        config={
            "model_id": "amazon.titan-embed-text-v2:0",
            "batch_size": 100,
        },
        inputs=[make_port("chunks", "Chunks", "document", required=True)],
        outputs=[make_port("vectors", "Vectors", "vector")],
    )

    # Destination S3 Vectors bucket — config carries bucket+index for the writer
    output_node = make_node(
        "output", "n_output",
        config={
            "mode": "json",
            "status_code": 200,
            "s3_vectors": {
                "bucket": "rag-vectors-prod",
                "index_name": "docs-index",
            },
        },
        inputs=[make_port("payload", "Payload", "any", required=True)],
    )

    edges = [
        make_edge("n_s3", "documents", "n_chunk", "documents", "document"),
        make_edge("n_chunk", "chunks", "n_embed", "chunks", "document"),
        make_edge("n_embed", "vectors", "n_output", "payload", "any"),
    ]

    return Project(
        name="ingest-rag",
        description="S3 -> chunk -> embed -> ingest into S3 Vectors bucket",
        nodes=[input_node, s3_src, chunk, embed, output_node],
        edges=edges,
    )


def test_ingestion_validates(ingestion_project: Project):
    result = validate(ingestion_project)
    assert result.valid, [e.to_dict() for e in result.errors]


def test_ingestion_topological_order(ingestion_project: Project):
    result = validate(ingestion_project)
    order = [n.id for n in result.sorted_nodes]
    # s3 source must precede chunk, chunk precedes embed, embed precedes output
    assert order.index("n_s3") < order.index("n_chunk")
    assert order.index("n_chunk") < order.index("n_embed")
    assert order.index("n_embed") < order.index("n_output")


def test_ingestion_emits_pipeline_node_files(ingestion_project: Project):
    result = validate(ingestion_project)
    artifacts = compile_graph(ingestion_project, result.sorted_nodes)
    files = artifacts.files
    for path in (
        "agent/nodes/n_s3.py",
        "agent/nodes/n_chunk.py",
        "agent/nodes/n_embed.py",
        "agent/nodes/n_output.py",
        "agent/state.py",
        "agent/graph.py",
        "agent/runner.py",
    ):
        assert path in files, f"missing {path}"


def test_ingestion_graph_wires_source_chunk_embed(ingestion_project: Project):
    result = validate(ingestion_project)
    artifacts = compile_graph(ingestion_project, result.sorted_nodes)
    graph_py = artifacts.files["agent/graph.py"]
    assert 'add_node("node_n_s3"' in graph_py
    assert 'add_node("node_n_chunk"' in graph_py
    assert 'add_node("node_n_embed"' in graph_py
    assert 'add_edge("node_n_s3", "node_n_chunk")' in graph_py
    assert 'add_edge("node_n_chunk", "node_n_embed")' in graph_py
    assert 'add_edge("node_n_embed", "node_n_output")' in graph_py


def test_ingestion_state_carries_vectors_field(ingestion_project: Project):
    result = validate(ingestion_project)
    artifacts = compile_graph(ingestion_project, result.sorted_nodes)
    state_py = artifacts.files["agent/state.py"]
    # embedding outputs vectors; state field key derives from source node + port
    assert "n_embed" in state_py and "vectors" in state_py


def test_ingestion_no_agentcore_memory_or_apigw_runtime_dependency(ingestion_project: Project):
    """Ingestion has no agent node, no memory; IaC must NOT include memory module."""
    result = validate(ingestion_project)
    iac = generate_iac(ingestion_project, result.sorted_nodes)
    assert 'infra/agentcore_memory.tf' not in iac.files
    # API gateway and base agentcore runtime are still emitted (single template path)
    assert 'infra/api_gateway.tf' in iac.files


def test_tool_sagemaker_endpoint_end_to_end():
    """Agent with a tool_sagemaker_endpoint compiles through validator + IaC + tool gen."""
    from engine.pipeline.compiler.tool_gen import generate_tool

    inp = make_node("input", "n_in", config={"trigger": "http"},
                    outputs=[make_port("payload", "Payload", "json")])
    agent = make_node("agent", "n_agent", config={
        "model_id": "anthropic.claude-3-5-sonnet-20241022-v2:0",
        "system_prompt": "Use the predictor tool.",
        "tools": ["n_sm"],
    },
        inputs=[make_port("input", "Input", "json")],
        outputs=[make_port("response", "Response", "json")])
    sm_tool = make_node("tool_sagemaker_endpoint", "n_sm", config={
        "name": "predict-churn",
        "description": "Calls the churn model.",
        "endpoint_name": "churn-prod",
        "content_type": "application/json",
        "accept": "application/json",
    })
    out = make_node("output", "n_out", config={"mode": "json"},
                    inputs=[make_port("response", "Response", "json")])
    edges = [
        make_edge("n_in", "payload", "n_agent", "input", "json"),
        make_edge("n_agent", "response", "n_out", "response", "json"),
    ]
    p = Project(name="sm-agent", nodes=[inp, agent, sm_tool, out], edges=edges)

    result = validate(p)
    assert result.valid, [e.to_dict() for e in result.errors]

    iac = generate_iac(p, result.sorted_nodes)
    iam = iac.files["infra/iam.tf"]
    assert "sagemaker:InvokeEndpoint" in iam
    assert "endpoint/churn-prod" in iam

    tool_file = generate_tool(sm_tool)
    assert tool_file.path == "agent/tools/n_sm.py"
    assert 'boto3.client("sagemaker-runtime")' in tool_file.content
    assert 'EndpointName="churn-prod"' in tool_file.content
    assert 'ContentType="application/json"' in tool_file.content


def test_ingestion_full_zip_bundles(ingestion_project: Project):
    result = validate(ingestion_project)
    assert result.valid
    artifacts = compile_graph(ingestion_project, result.sorted_nodes)
    artifacts.merge(generate_iac(ingestion_project, result.sorted_nodes))
    artifacts.merge(generate_tests(ingestion_project))
    artifacts.merge(generate_local_scaffold(ingestion_project))
    zip_bytes = bundler.bundle(ingestion_project, artifacts)
    assert isinstance(zip_bytes, (bytes, bytearray))
    assert zip_bytes[:2] == b"PK"
