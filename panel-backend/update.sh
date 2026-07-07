#!/bin/bash
#
# Self-update для panel-backend. Вызывается через POST /api/system/update.
#

set -e

cd /app/project

if [ -f .env ]; then
  cp .env .env.bak
fi

git fetch origin master
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)
if [ "$LOCAL" = "$REMOTE" ]; then
  echo "Already up to date."
  exit 0
fi
git reset --hard origin/master

if [ -f .env.bak ]; then
  mv .env.bak .env
fi

docker compose pull 2>/dev/null || true
docker compose up -d --build

echo "Panel update complete."
