#!/bin/sh
# Corre dentro del contenedor "watcher": vigila el repo de GitHub y, cuando hay
# cambios, reconstruye y reinicia SOLO el servicio del bot (nunca a sí mismo).
set -e

: "${HOST_REPO_PATH:?Debes definir HOST_REPO_PATH en tu .env con la ruta absoluta del repo en el VPS (ej. /opt/discord-tts-bot)}"
INTERVAL="${DEPLOY_INTERVAL_SECONDS:-300}"
BRANCH="${DEPLOY_BRANCH:-main}"

cd "$HOST_REPO_PATH"

# Evita el error "detected dubious ownership" de git cuando el UID del
# contenedor no coincide con el dueño de los archivos en el host.
git config --global --add safe.directory "$HOST_REPO_PATH"

echo "Watcher iniciado. Repo: $HOST_REPO_PATH | rama: $BRANCH | intervalo: ${INTERVAL}s"

while true; do
  TS="$(date '+%Y-%m-%d %H:%M:%S')"
  git fetch origin "$BRANCH" --quiet

  LOCAL=$(git rev-parse HEAD)
  REMOTE=$(git rev-parse "origin/$BRANCH")

  if [ "$LOCAL" != "$REMOTE" ]; then
    echo "$TS - Cambios detectados ($LOCAL -> $REMOTE). Actualizando..."
    git pull origin "$BRANCH"
    # Solo reconstruye el bot, nunca este mismo contenedor watcher.
    docker compose up -d --build discord-tts-bot
    echo "$TS - Bot actualizado y reiniciado."
  else
    echo "$TS - Sin cambios."
  fi

  sleep "$INTERVAL"
done
