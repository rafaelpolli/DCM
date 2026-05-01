#!/usr/bin/env bash
set -euo pipefail

APP_NAME="datacontract-manager"
APP_DIR="/opt/${APP_NAME}"
APP_USER="${SUDO_USER:-ubuntu}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute com sudo: sudo bash deploy/install_docker_ubuntu.sh"
  exit 1
fi

if [ ! -f "compose.yaml" ] || [ ! -f "Dockerfile" ]; then
  echo "Execute este script a partir da raiz do projeto."
  exit 1
fi

echo "Instalando Docker e plugin Compose..."
apt-get update
apt-get install -y ca-certificates curl gnupg rsync
install -m 0755 -d /etc/apt/keyrings

if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi

. /etc/os-release
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

usermod -aG docker "${APP_USER}" || true
systemctl enable docker
systemctl start docker

echo "Parando servicos antigos, se existirem..."
systemctl stop dcm 2>/dev/null || true
systemctl disable dcm 2>/dev/null || true
systemctl stop nginx 2>/dev/null || true
systemctl disable nginx 2>/dev/null || true

echo "Copiando projeto para ${APP_DIR}..."
mkdir -p "${APP_DIR}"
rsync -a --delete \
  --exclude ".git" \
  --exclude ".venv" \
  --exclude "data" \
  --exclude "__pycache__" \
  --exclude "*.pyc" \
  ./ "${APP_DIR}/"

chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

echo "Construindo e iniciando container..."
cd "${APP_DIR}"
docker compose up -d --build

echo ""
echo "Deploy Docker concluido."
echo "Status:"
docker compose ps
echo ""
echo "Acesse pelo IP publico da EC2:"
echo "http://SEU_IP_PUBLICO/login"
