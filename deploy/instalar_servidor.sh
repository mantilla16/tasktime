#!/usr/bin/env bash
# Preparación inicial del servidor Ubuntu (una sola vez). Después, cada push a
# main lo despliega GitHub Actions (.github/workflows/deploy.yml).
#
#   sudo bash instalar_servidor.sh https://github.com/mantilla16/tasktime.git /opt/tasktime
#
# Deja: Docker con compose, el usuario de despliegue con acceso a docker, el
# repositorio clonado, un .env con la clave de Postgres generada y la clave SSH
# que hay que registrar como secreto DEPLOY_KEY en GitHub. Si el servidor ya
# tiene Docker y el usuario (por otro proyecto), solo agrega lo que falta.
set -euo pipefail

REPO="${1:?Uso: instalar_servidor.sh URL_DEL_REPO [RUTA] [USUARIO]}"
RUTA="${2:-/opt/tasktime}"
USUARIO="${3:-bot}"

echo "== Docker"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

echo "== Usuario $USUARIO"
id -u "$USUARIO" >/dev/null 2>&1 || useradd -m -s /bin/bash "$USUARIO"
usermod -aG docker "$USUARIO"

echo "== Repositorio en $RUTA"
if [ ! -d "$RUTA/.git" ]; then
  mkdir -p "$(dirname "$RUTA")"
  sudo -u "$USUARIO" git clone "$REPO" "$RUTA" || git clone "$REPO" "$RUTA"
  chown -R "$USUARIO:$USUARIO" "$RUTA"
fi
cd "$RUTA"

echo "== .env"
if [ ! -f .env ]; then
  CLAVE_DB="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40)"
  sed "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$CLAVE_DB/" .env.example > .env
  chmod 600 .env
  chown "$USUARIO:$USUARIO" .env
  echo "   Creado $RUTA/.env con una clave de Postgres aleatoria. Ajusta WEB_PORT si el 3100 está ocupado."
fi

echo "== Clave SSH para GitHub Actions"
CLAVE="/home/$USUARIO/.ssh/deploy_ed25519"
if [ ! -f "$CLAVE" ]; then
  sudo -u "$USUARIO" mkdir -p "/home/$USUARIO/.ssh"
  sudo -u "$USUARIO" ssh-keygen -t ed25519 -N "" -f "$CLAVE" -C "github-actions-deploy"
  sudo -u "$USUARIO" bash -c "cat '$CLAVE.pub' >> /home/$USUARIO/.ssh/authorized_keys"
  chmod 700 "/home/$USUARIO/.ssh"; chmod 600 "/home/$USUARIO/.ssh/authorized_keys"
else
  echo "   Ya existe $CLAVE: reutiliza el mismo secreto DEPLOY_KEY del otro proyecto."
fi

echo "== Primer arranque"
sudo -u "$USUARIO" docker compose up -d --build
sudo -u "$USUARIO" docker compose ps

echo
echo "Listo. En GitHub (repo tasktime) crea los secretos:"
echo "  DEPLOY_HOST = $(hostname -I | awk '{print $1}')"
echo "  DEPLOY_USER = $USUARIO"
echo "  DEPLOY_PATH = $RUTA"
echo "  DEPLOY_KEY  = contenido de $CLAVE (clave PRIVADA)"
echo "La app escucha en http://127.0.0.1:$(grep -E '^WEB_PORT=' .env | cut -d= -f2 || echo 3100);"
echo "publícala con el proxy (ver deploy/nginx.conf.example) y abre la URL: pedirá crear la cuenta de gerente."
