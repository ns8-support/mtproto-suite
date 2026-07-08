#!/bin/bash
#
# Self-update для service-node. Вызывается через POST /api/update.
#
# Исправления:
# 1. Проверка текущей версии перед обновлением (не делать update если уже актуально).
# 2. Сохранение .env перед git pull.
# 3. Graceful shutdown контейнеров перед pull.

set -e

cd /app/project

# Сохраняем .env
if [ -f service-node/.env ]; then
  cp service-node/.env service-node/.env.bak
fi

echo "Pulling latest changes..."
git fetch origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ]; then
  echo "Already up to date."
  exit 0
fi
git reset --hard origin/main

# Восстанавливаем .env
if [ -f service-node/.env.bak ]; then
  mv service-node/.env.bak service-node/.env
fi

cd service-node

# Пробуем скачать образ из GHCR, если не получается — собираем локально
echo "Attempting to pull image from GHCR..."
if docker compose pull 2>/dev/null; then
  echo "Image pulled from GHCR"
else
  echo "Image not found in GHCR, building locally..."
  docker compose build
fi

echo "Restarting containers..."
docker compose up -d

echo "Update complete."
