"""Phase 8: CI/CD Pipeline Generator — emits GitHub Actions and GitLab CI configs."""
from __future__ import annotations

from .._types import CompiledArtifacts, CompiledFile
from ..models.graph import Project


def generate_cicd(project: Project) -> CompiledArtifacts:
    artifacts = CompiledArtifacts()
    artifacts.add(_gen_github_actions(project))
    artifacts.add(_gen_gitlab_ci(project))
    return artifacts


def _agent_name(project: Project) -> str:
    return project.name.lower().replace(" ", "-")


def _gen_github_actions(project: Project) -> CompiledFile:
    name = _agent_name(project)
    content = f"""\
name: Deploy {project.name}

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  AWS_REGION: ${{{{ secrets.AWS_REGION }}}}
  ECR_REPOSITORY: {name}

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{{{ secrets.AWS_ROLE_ARN }}}}
          aws-region: ${{{{ env.AWS_REGION }}}}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push Docker image
        id: build
        env:
          ECR_REGISTRY: ${{{{ steps.login-ecr.outputs.registry }}}}
          IMAGE_TAG: ${{{{ github.sha }}}}
        run: |
          docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
          docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
          echo "image=$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG" >> "$GITHUB_OUTPUT"

      - name: Setup Terraform
        uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.7.0"

      - name: Terraform Init
        working-directory: infra/
        run: terraform init -backend-config=backend.hcl

      - name: Terraform Plan
        working-directory: infra/
        env:
          TF_VAR_ecr_image_uri: ${{{{ steps.build.outputs.image }}}}
        run: terraform plan -var-file=prod.tfvars -out=tfplan

      - name: Terraform Apply
        working-directory: infra/
        run: terraform apply tfplan
"""
    return CompiledFile(path=".github/workflows/deploy.yml", content=content)


def _gen_gitlab_ci(project: Project) -> CompiledFile:
    name = _agent_name(project)
    content = f"""\
image: docker:24.0.5

stages:
  - build
  - deploy

variables:
  AGENT_NAME: "{name}"
  TF_VERSION: "1.7.0"

build-image:
  stage: build
  services:
    - docker:24.0.5-dind
  before_script:
    - aws ecr get-login-password --region $AWS_REGION
        | docker login --username AWS --password-stdin $ECR_REGISTRY
  script:
    - docker build -t $ECR_REGISTRY/{name}:$CI_COMMIT_SHA .
    - docker push $ECR_REGISTRY/{name}:$CI_COMMIT_SHA
  only:
    - main

terraform-deploy:
  stage: deploy
  image:
    name: hashicorp/terraform:$TF_VERSION
    entrypoint: [""]
  script:
    - cd infra/
    - terraform init -backend-config=backend.hcl
    - terraform apply -auto-approve
        -var-file=prod.tfvars
        -var="ecr_image_uri=$ECR_REGISTRY/{name}:$CI_COMMIT_SHA"
  environment:
    name: production
  only:
    - main
"""
    return CompiledFile(path=".gitlab-ci.yml", content=content)
