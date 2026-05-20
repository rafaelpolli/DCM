"""ML-mode deploy notebook — variant of the per-agent SageMaker notebook.

Runs from inside SageMaker Studio in the customer's AWS account. Bootstraps
Terraform state, applies the IAM + Model Package Group, upserts the pipeline
via the SageMaker SDK, starts an execution, and (after manual approval of
the ModelPackage) deploys the endpoint via a second terraform apply.
"""
from __future__ import annotations

import json

from ..._types import CompiledFile


def generate_ml_notebook(project_name: str) -> CompiledFile:
    def code(src: str) -> dict:
        return {"cell_type": "code", "execution_count": None, "metadata": {},
                "outputs": [], "source": src}

    def md(src: str) -> dict:
        return {"cell_type": "markdown", "metadata": {}, "source": src}

    config_cell = '''\
# --- Configuracao -----------------------------------------------------------
import boto3, pathlib, subprocess, sys, os

REGION  = "us-east-1"
PROJECT = "__PROJECT_NAME__"

ACCOUNT_ID = boto3.client("sts", region_name=REGION).get_caller_identity()["Account"]

ROOT   = pathlib.Path.cwd()              # raiz do projeto ML (este notebook)
TF_DIR = ROOT / "infra"

STATE_BUCKET = f"{PROJECT}-tfstate-{ACCOUNT_ID}"
LOCK_TABLE   = f"{PROJECT}-tf-lock"
DEFAULT_BUCKET = f"{PROJECT}-sagemaker-{ACCOUNT_ID}"

def run(cmd, cwd=None):
    print(f"$ {cmd}")
    r = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)
    if r.stdout:
        print(r.stdout)
    if r.returncode != 0:
        print(r.stderr)
        raise RuntimeError(f"comando falhou (exit {r.returncode}): {cmd}")
    return r.stdout

print("account:", ACCOUNT_ID, "| region:", REGION, "| project:", PROJECT)
assert TF_DIR.exists(), f"infra/ nao encontrado em {TF_DIR}"
'''.replace("__PROJECT_NAME__", project_name)

    cells = [
        md(
            "# Deploy do ML pipeline `" + project_name + "` na AWS\n"
            "\n"
            "Notebook executavel de dentro de um **SageMaker Studio**. Provisiona o "
            "IAM e o Model Package Group via Terraform, faz upsert do pipeline via "
            "SDK, dispara uma execucao e, apos aprovacao manual do ModelPackage, "
            "deploya o endpoint via segundo `terraform apply`.\n"
            "\n"
            "Rode as celulas em ordem."
        ),
        md(
            "## Pre-requisitos\n"
            "\n"
            "1. Execution role do SageMaker com permissao para criar IAM, S3, "
            "SageMaker resources, DynamoDB.\n"
            "2. Bedrock NAO e necessario (este projeto e ML puro).\n"
            "3. Bucket S3 com seus dados de treinamento ja disponiveis."
        ),
        code(config_cell),
        code(
            "# --- Instalar o binario do Terraform ---------------------------------------\n"
            "import urllib.request, zipfile\n"
            "\n"
            'TF_VERSION = "1.9.8"\n'
            'bindir = pathlib.Path.home() / "bin"\n'
            "bindir.mkdir(exist_ok=True)\n"
            "\n"
            'if not (bindir / "terraform").exists():\n'
            '    url = (f"https://releases.hashicorp.com/terraform/{TF_VERSION}/"\n'
            '           f"terraform_{TF_VERSION}_linux_amd64.zip")\n'
            '    urllib.request.urlretrieve(url, "/tmp/terraform.zip")\n'
            '    with zipfile.ZipFile("/tmp/terraform.zip") as z:\n'
            "        z.extractall(bindir)\n"
            '    os.chmod(bindir / "terraform", 0o755)\n'
            "\n"
            'os.environ["PATH"] = f"{bindir}:{os.environ[\'PATH\']}"\n'
            'run("terraform version")'
        ),
        code(
            "# --- Instalar o SDK do SageMaker -------------------------------------------\n"
            'run(f"{sys.executable} -m pip install --quiet \\"sagemaker>=2.200\\"")'
        ),
        code(
            "# --- Bootstrap do state remoto do Terraform (S3 + DynamoDB) ----------------\n"
            's3  = boto3.client("s3", region_name=REGION)\n'
            'ddb = boto3.client("dynamodb", region_name=REGION)\n'
            "\n"
            "for bucket in (STATE_BUCKET, DEFAULT_BUCKET):\n"
            "    try:\n"
            '        if REGION == "us-east-1":\n'
            "            s3.create_bucket(Bucket=bucket)\n"
            "        else:\n"
            "            s3.create_bucket(Bucket=bucket,\n"
            '                             CreateBucketConfiguration={"LocationConstraint": REGION})\n'
            '        print("bucket criado:", bucket)\n'
            "    except s3.exceptions.BucketAlreadyOwnedByYou:\n"
            '        print("bucket ja existe:", bucket)\n'
            "\n"
            'try:\n'
            "    ddb.create_table(TableName=LOCK_TABLE,\n"
            '                     AttributeDefinitions=[{"AttributeName": "LockID", "AttributeType": "S"}],\n'
            '                     KeySchema=[{"AttributeName": "LockID", "KeyType": "HASH"}],\n'
            '                     BillingMode="PAY_PER_REQUEST")\n'
            '    ddb.get_waiter("table_exists").wait(TableName=LOCK_TABLE)\n'
            '    print("tabela de lock criada:", LOCK_TABLE)\n'
            "except ddb.exceptions.ResourceInUseException:\n"
            '    print("tabela de lock ja existe:", LOCK_TABLE)'
        ),
        code(
            "# --- terraform init + apply do IAM e Model Package Group -------------------\n"
            '(TF_DIR / "terraform.tfvars").write_text(\n'
            '    f\'aws_region     = \"{REGION}\"\\n\'\n'
            '    f\'project_name   = \"{PROJECT}\"\\n\'\n'
            '    f\'default_bucket = \"{DEFAULT_BUCKET}\"\\n\'\n'
            ")\n"
            "run(f'terraform init -reconfigure '\n"
            "    f'-backend-config=\"bucket={STATE_BUCKET}\" '\n"
            "    f'-backend-config=\"key={PROJECT}/terraform.tfstate\" '\n"
            "    f'-backend-config=\"region={REGION}\"', cwd=TF_DIR)\n"
            'run("terraform validate", cwd=TF_DIR)\n'
            "# Fase A: cria role + Model Package Group (NAO cria endpoint ainda — model_data_url vem depois).\n"
            'run("terraform apply -auto-approve "\n'
            '    "-target=aws_iam_role.sagemaker "\n'
            '    "-target=aws_iam_role_policy_attachment.sagemaker_full "\n'
            '    "-target=aws_iam_role_policy.sagemaker_s3 "\n'
            '    "-target=aws_sagemaker_model_package_group", cwd=TF_DIR)\n'
            "\n"
            'ROLE_ARN = run("terraform output -raw sagemaker_role_arn", cwd=TF_DIR).strip()\n'
            'print("ROLE_ARN:", ROLE_ARN)'
        ),
        code(
            "# --- Upsert + start do pipeline (SDK) --------------------------------------\n"
            'os.environ["SAGEMAKER_ROLE_ARN"] = ROLE_ARN\n'
            'os.environ["SAGEMAKER_DEFAULT_BUCKET"] = DEFAULT_BUCKET\n'
            "sys.path.insert(0, str(ROOT))\n"
            "from pipeline.pipeline import pipeline  # noqa: E402\n"
            "\n"
            "pipeline.upsert(role_arn=ROLE_ARN)\n"
            "execution = pipeline.start()\n"
            'print("Execution ARN:", execution.arn)\n'
            'print("Aguardando execucao terminar... (pode levar minutos a horas)")\n'
            "execution.wait()\n"
            "status = execution.describe()['PipelineExecutionStatus']\n"
            'print("Status final:", status)'
        ),
        md(
            "## Aprovacao manual do ModelPackage\n"
            "\n"
            "O `model_register` step publica um novo ModelPackage com status "
            "`PendingManualApproval`. Antes de deployar o endpoint, abra o "
            "**SageMaker Studio > Model Registry**, inspecione as metricas do "
            "ModelPackage e mova-o para `Approved`. Depois rode a celula abaixo "
            "para criar o endpoint."
        ),
        code(
            "# --- Fase B: criar o endpoint apos aprovacao do ModelPackage ---------------\n"
            "# Preencha {ep}_model_data_url e {ep}_container_image em infra/dev.tfvars\n"
            "# (o S3 URI do model.tar.gz aprovado e a imagem de inferencia do framework).\n"
            'run("terraform apply -auto-approve -var-file=dev.tfvars", cwd=TF_DIR)'
        ),
        md(
            "## Teardown\n"
            "\n"
            "A celula abaixo destroi toda a infra. Esta comentada de proposito — "
            "descomente e execute apenas quando quiser remover tudo.\n"
            "\n"
            "Endpoints SageMaker sao cobrados por hora — destrua quando nao "
            "precisar mais."
        ),
        code(
            "# CUIDADO: remove role, model package group, modelos e endpoints.\n"
            '# run("terraform destroy -auto-approve -var-file=dev.tfvars", cwd=TF_DIR)'
        ),
    ]

    notebook = {
        "cells": cells,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3.12"},
        },
        "nbformat": 4,
        "nbformat_minor": 5,
    }
    return CompiledFile(
        path="deploy-sagemaker.ipynb",
        content=json.dumps(notebook, indent=1, ensure_ascii=False),
    )
