"""ML pipeline compilation phase — runs when Project.project_type == 'ml_pipeline'.

Mirrors the agent pipeline package (validator + compiler + iac + notebook) but
targets the SageMaker Pipelines SDK + SageMaker Endpoints instead of LangGraph
+ AgentCore Runtime. The two paths share Project/Node/Edge data models but
not the compilation logic.
"""
from .validator_ml import validate_ml
from .compiler_ml import compile_ml_pipeline
from .iac_ml import generate_iac_ml
from .notebook_ml import generate_ml_notebook

__all__ = [
    "validate_ml",
    "compile_ml_pipeline",
    "generate_iac_ml",
    "generate_ml_notebook",
]
