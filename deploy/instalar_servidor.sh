#!/usr/bin/env bash
# Preparación inicial del servidor Ubuntu (una sola vez). Después, cada push a
# main lo despliega el runner auto-hospedado de GitHub Actions
# (.github/workflows/deploy.yml), que corre en este mismo servidor.
#
#   sudo bash instalar_servidor.sh https://github.com/mantilla16/tasktime.git /opt/tasktime
#
# Deja: Docker con compose (si faltaba), el repositorio clonado en la ruta,
# un .env con la clave de Postgres generada y los contenedores arrancados.
# El dueño de la carpeta es el usuario que ejecuta sudo (el mismo que corre
# los runners), para que el runner pueda actualizarla sin permisos extra.
set -euo pipefail

REPO="${1:?Uso: instalar_servidor.sh URL_DEL_REPO [RUTA] [USUARIO]}"
RUTA="${2:-/opt/tasktime}"
USUARIO="${3:-${SUDO_USER:-$(id -un)}}"

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

echo "== Usuario $USUARIO (dueño de la carpeta y del runner)"
id -u "$USUARIO" >/dev/null 2>&1 || useradd -m -s /bin/bash "$USUARIO"
usermod -aG docker "$USUARIO"

echo "== Repositorio en $RUTA"
if [ ! -d "$RUTA/.git" ]; then
  mkdir -p "$RUTA"
  git clone "$REPO" "$RUTA"
fi
chown -R "$USUARIO:$USUARIO" "$RUTA"
cd "$RUTA"
# Si el clon ya existía, ponerlo en la última versión de main.
sudo -u "$USUARIO" git fetch --all --prune
sudo -u "$USUARIO" git reset --hard origin/main

echo "== .env"
if [ ! -f .env ]; then
  CLAVE_DB="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-40)"
  sed "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$CLAVE_DB/" .env.example > .env
  chmod 600 .env
  chown "$USUARIO:$USUARIO" .env
  echo "   Creado $RUTA/.env con una clave de Postgres aleatoria. Ajusta WEB_PORT si el 3100 está ocupado."
else
  echo "   Ya existe .env; se conserva."
fi

echo "== Primer arranque"
sudo -u "$USUARIO" docker compose up -d --build
sudo -u "$USUARIO" docker compose ps

PUERTO="$(grep -E '^WEB_PORT=' .env | cut -d= -f2 || true)"
echo
echo "Listo. La app escucha en http://127.0.0.1:${PUERTO:-3100}."
echo "Siguiente paso: registra un runner auto-hospedado para el repositorio tasktime"
echo "(GitHub > Settings > Actions > Runners > New self-hosted runner) con el usuario $USUARIO,"
echo "por ejemplo en /home/$USUARIO/actions-runner-tasktime, e instálalo como servicio:"
echo "    sudo ./svc.sh install $USUARIO && sudo ./svc.sh start"
echo "Después, cada push a main actualiza $RUTA y reconstruye los contenedores."
echo "Publica la app con el proxy (deploy/nginx.conf.example) y abre la URL: pedirá crear la cuenta de gerente."
