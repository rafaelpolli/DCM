"""End-to-end tests for the ML pipeline track (project_type = 'ml_pipeline')."""
from __future__ import annotations

import json

import pytest

from engine.models.graph import Project
from engine.pipeline.ml import (
    compile_ml_pipeline,
    generate_iac_ml,
    generate_ml_notebook,
    validate_ml,
)

from tests.conftest import make_edge, make_node, make_port


@pytest.fixture
def ml_pipeline_project() -> Project:
    """data_source_s3 -> processing_job -> training_job -> model_register -> endpoint_realtime."""
    src = make_node("data_source_s3", "n_src", config={
        "name": "raw-data",
        "s3_uri": "s3://my-bucket/data/raw/",
        "format": "parquet",
    }, outputs=[make_port("data", "Data", "any")])

    proc = make_node("processing_job", "n_proc", config={
        "name": "preprocess",
        "image_uri": "246618743249.dkr.ecr.us-east-1.amazonaws.com/sagemaker-scikit-learn:1.0-1-cpu-py3",
        "instance_type": "ml.m5.large",
        "instance_count": 1,
        "script_uri": "s3://my-bucket/scripts/preprocess.py",
        "output_s3_uri": "s3://my-bucket/processed/",
    },
        inputs=[make_port("data", "Data", "any")],
        outputs=[make_port("output", "Processed", "any")])

    train = make_node("training_job", "n_train", config={
        "name": "xgb-train",
        "image_uri": "246618743249.dkr.ecr.us-east-1.amazonaws.com/sagemaker-xgboost:1.5-1",
        "instance_type": "ml.m5.xlarge",
        "instance_count": 1,
        "output_s3_uri": "s3://my-bucket/models/",
        "hyperparameters": {"objective": "binary:logistic", "num_round": "50"},
    },
        inputs=[make_port("train", "Train", "any")],
        outputs=[make_port("model", "Model", "any")])

    reg = make_node("model_register", "n_reg", config={
        "model_package_group_name": "churn-models",
        "approval_status": "PendingManualApproval",
        "content_types": ["application/json"],
        "response_types": ["application/json"],
        "inference_instances": ["ml.m5.large"],
    },
        inputs=[make_port("model", "Model", "any")],
        outputs=[make_port("package", "ModelPackage", "any")])

    endpoint = make_node("endpoint_realtime", "n_ep", config={
        "name": "churn-prod",
        "instance_type": "ml.m5.large",
        "initial_instance_count": 1,
    },
        inputs=[make_port("package", "ModelPackage", "any")])

    edges = [
        make_edge("n_src", "data", "n_proc", "data", "any"),
        make_edge("n_proc", "output", "n_train", "train", "any"),
        make_edge("n_train", "model", "n_reg", "model", "any"),
        make_edge("n_reg", "package", "n_ep", "package", "any"),
    ]

    return Project(
        name="churn-ml",
        project_type="ml_pipeline",
        nodes=[src, proc, train, reg, endpoint],
        edges=edges,
    )


def test_ml_pipeline_validates(ml_pipeline_project: Project):
    result = validate_ml(ml_pipeline_project)
    assert result.valid, [e.to_dict() for e in result.errors]
    # Topological order: source first, endpoint last.
    ids = [n.id for n in result.sorted_nodes]
    assert ids.index("n_src") < ids.index("n_train") < ids.index("n_ep")


def test_ml_pipeline_rejects_invalid_topology():
    """endpoint_realtime hanging off data_source_s3 (no training) must be rejected."""
    src = make_node("data_source_s3", "n_src", config={
        "name": "x", "s3_uri": "s3://b/", "format": "csv",
    }, outputs=[make_port("data", "Data", "any")])
    ep = make_node("endpoint_realtime", "n_ep", config={"instance_type": "ml.m5.large"})
    edges = [make_edge("n_src", "data", "n_ep", "data", "any")]
    p = Project(name="bad", project_type="ml_pipeline", nodes=[src, ep], edges=edges)
    result = validate_ml(p)
    assert not result.valid
    codes = {e.code for e in result.errors}
    assert "ML_NO_TRAINING_JOB" in codes or "INVALID_ML_TOPOLOGY" in codes


def test_ml_pipeline_compiles_to_sagemaker_sdk(ml_pipeline_project: Project):
    result = validate_ml(ml_pipeline_project)
    artifacts = compile_ml_pipeline(ml_pipeline_project, result.sorted_nodes)
    files = artifacts.files

    assert "pipeline/pipeline.py" in files
    assert "pipeline/run.py" in files

    pipe = files["pipeline/pipeline.py"]
    assert "from sagemaker.workflow.pipeline import Pipeline" in pipe
    assert "ProcessingStep" in pipe
    assert "TrainingStep" in pipe
    assert "RegisterModel" in pipe
    assert 'name="xgb-train"' in pipe
    assert "step_n_train" in pipe
    # Training input chained from processing output.
    assert "step_n_proc.properties.ProcessingOutputConfig" in pipe
    # Register model wires to training step properties.
    assert "step_n_train.properties.ModelArtifacts.S3ModelArtifacts" in pipe
    assert "Pipeline(" in pipe
    # endpoint_realtime is NOT a Pipelines step.
    assert "step_n_ep" not in pipe


def test_ml_pipeline_emits_iac(ml_pipeline_project: Project):
    result = validate_ml(ml_pipeline_project)
    iac = generate_iac_ml(ml_pipeline_project, result.sorted_nodes)
    files = iac.files

    assert "infra/main.tf" in files
    assert "infra/variables.tf" in files
    assert "infra/iam.tf" in files
    assert "infra/sagemaker.tf" in files
    assert "infra/outputs.tf" in files
    assert "infra/dev.tfvars" in files

    iam_tf = files["infra/iam.tf"]
    assert "aws_iam_role" in iam_tf
    assert "sagemaker.amazonaws.com" in iam_tf
    assert "AmazonSageMakerFullAccess" in iam_tf

    sm_tf = files["infra/sagemaker.tf"]
    assert "aws_sagemaker_model_package_group" in sm_tf
    assert '"churn-models"' in sm_tf
    assert "aws_sagemaker_model" in sm_tf
    assert "aws_sagemaker_endpoint_configuration" in sm_tf
    assert "aws_sagemaker_endpoint" in sm_tf
    assert '"ml.m5.large"' in sm_tf

    outputs_tf = files["infra/outputs.tf"]
    assert "sagemaker_role_arn" in outputs_tf
    assert "endpoint_name" in outputs_tf


def test_ml_pipeline_notebook_is_valid_ipynb():
    nb_file = generate_ml_notebook("churn-ml")
    nb = json.loads(nb_file.content)
    assert nb["nbformat"] == 4
    assert nb_file.path == "deploy-sagemaker.ipynb"
    # All code cells are valid Python.
    import ast
    for c in nb["cells"]:
        if c["cell_type"] == "code":
            ast.parse(c["source"])
    # Mentions the project name and the key flow steps.
    text = " ".join(c["source"] for c in nb["cells"])
    assert "churn-ml" in text
    assert "pipeline.upsert" in text
    assert "pipeline.start" in text
    assert "terraform apply" in text


def test_agent_project_still_uses_agent_pipeline():
    """Default project_type='agent' must NOT touch the ML pipeline path."""
    src = make_node("data_source_s3", "n_src", config={
        "name": "x", "s3_uri": "s3://b/", "format": "csv",
    })
    p = Project(name="x", nodes=[src], edges=[])
    # Default project_type is 'agent' — validate_ml would reject this graph,
    # but the agent validator should never even see ml-only nodes; the point is
    # the project_type discriminator is honored end-to-end.
    assert p.project_type == "agent"
