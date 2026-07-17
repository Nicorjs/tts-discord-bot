#!/bin/bash
# Revisa si hay cambios nuevos en GitHub y, si los hay, reconstruye y reinicia el bot.
# Pensado para correr por cron cada pocos minutos en el VPS.
set -e
cd "$(dirname "$0")"

BRANCH="main"
LOG_PREFIX="$(date '+%Y-%m-%d %H:%M:%S')"

git fetch origin "$BRANCH" --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "$LOG_PREFIX - Cambios detectados ($LOCAL -> $REMOTE). Actualizando..."
  git pull origin "$BRANCH"
  docker compose up -d --build
  echo "$LOG_PREFIX - Bot actualizado y reiniciado."
else
  echo "$LOG_PREFIX - Sin cambios."
fi
