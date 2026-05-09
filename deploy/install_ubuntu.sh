#!/usr/bin/env bash
set -euo pipefail

APP_NAME="datacontract-manager"
APP_DIR="/opt/${APP_NAME}"
APP_USER="${SUDO_USER:-ubuntu}"
SERVICE_FILE="/etc/systemd/system/dcm.service"
NGINX_FILE="/etc/nginx/sites-available/dcm"

if [ "$(id -u)" -ne 0 ]; then
  echo "Execute com sudo: sudo bash deploy/install_ubuntu.sh"
  exit 1
fi

if [ ! -f "datacontracts/requirements.txt" ]; then
  echo "Execute este script a partir da raiz do projeto."
  exit 1
fi

echo "Instalando pacotes do sistema..."
apt-get update
apt-get install -y python3 python3-venv python3-pip nginx rsync

echo "Copiando projeto para ${APP_DIR}..."
mkdir -p "${APP_DIR}"
rsync -a --delete \
  --exclude ".git" \
  --exclude ".venv" \
  --exclude "data" \
  --exclude "__pycache__" \
  --exclude "*.pyc" \
  ./ "${APP_DIR}/"

mkdir -p "${APP_DIR}/data"
chown -R "${APP_USER}:www-data" "${APP_DIR}"

echo "Criando ambiente Python..."
python3 -m venv "${APP_DIR}/.venv"
"${APP_DIR}/.venv/bin/python" -m pip install --upgrade pip
"${APP_DIR}/.venv/bin/python" -m pip install -r "${APP_DIR}/datacontracts/requirements.txt"

echo "Configurando systemd..."
cp "${APP_DIR}/deploy/dcm.service" "${SERVICE_FILE}"
sed -i "s/^User=.*/User=${APP_USER}/" "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable dcm
systemctl restart dcm

echo "Configurando Nginx..."
cp "${APP_DIR}/deploy/nginx-dcm.conf" "${NGINX_FILE}"
rm -f /etc/nginx/sites-enabled/default
ln -sf "${NGINX_FILE}" /etc/nginx/sites-enabled/dcm
nginx -t
systemctl enable nginx
systemctl restart nginx

echo ""
echo "Deploy concluido."
echo "Status da aplicacao:"
systemctl --no-pager --full status dcm || true
echo ""
echo "Acesse pelo IP publico da EC2 usando HTTP, por exemplo:"
echo "http://SEU_IP_PUBLICO/login"
