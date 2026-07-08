#!/bin/bash
#
# Self-update для panel-backend. Вызывается через POST /api/system/update.
#

set -e

cd /app/project

if [ -f .env ]; then
  cp .env .env.bak
fi

git fetch origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ]; then
  echo "Already up to date."
  exit 0
fi
git reset --hard origin/main

if [ -f .env.bak ]; then
  mv .env.bak .env
fi

# Пробуем скачать образы из GHCR, если не получается — собираем локально
echo "Attempting to pull images from GHCR..."
if docker compose pull 2>/dev/null; then
  echo "Images pulled from GHCR"
  docker compose up -d
else
  echo "Images not found in GHCR, building locally..."
  docker compose up -d --build
fi

echo "Panel update complete."
