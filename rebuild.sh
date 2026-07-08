#!/bin/bash
#
# Скрипт для полной очистки Docker кеша и пересборки образов
#

set -e

echo "=========================================="
echo "  Очистка Docker кеша и пересборка"
echo "=========================================="
echo ""

# 1. Остановка всех контейнеров
echo "1. Остановка всех контейнеров..."
docker compose down 2>/dev/null || true
echo ""

# 2. Удаление старых образов
echo "2. Удаление старых образов mtproto-suite..."
docker images | grep mtproto-suite | awk '{print $3}' | xargs -r docker rmi -f 2>/dev/null || true
echo ""

# 3. Очистка BuildKit кеша
echo "3. Очистка BuildKit кеша..."
docker builder prune -af
echo ""

# 4. Очистка system prune (опционально, более агрессивно)
echo "4. Очистка неиспользуемых данных..."
docker system prune -f
echo ""

# 5. Пересборка без кеша
echo "5. Пересборка образов без кеша..."
echo "   Это может занять 5-10 минут..."
echo ""
docker compose build --no-cache --progress=plain
echo ""

echo "=========================================="
echo "  ✓ Пересборка завершена!"
echo "=========================================="
echo ""
echo "Для запуска используйте:"
echo "  docker compose up -d"
echo ""
echo "Для просмотра логов:"
echo "  docker compose logs -f"
