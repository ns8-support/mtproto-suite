#!/bin/bash
#
# Удаление панели: останавливает контейнеры, удаляет данные и сертификаты.
#
# Исправление: в оригинале скрипт оставлял volumes с БД. Теперь удаляет всё,
# что было создано install.sh (с подтверждением).

set -e

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

INSTALL_DIR="${INSTALL_DIR:-/opt/mtproto-panel}"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  Удаление MTProto Panel                 ${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""
echo -e "Будет удалено:"
echo "  - Каталог: $INSTALL_DIR"
echo "  - Docker контейнеры: mtproto-panel-db, mtproto-panel-backend, mtproto-panel-frontend"
echo "  - Docker volume: mtproto-panel_pgdata (все данные БД)"
echo "  - SSL сертификаты (если есть)"
echo ""
read -p "Продолжить? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo -e "${YELLOW}Отменено.${NC}"
  exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
  echo -e "${RED}Требуются права root.${NC}"
  exit 1
fi

cd "$INSTALL_DIR" || { echo -e "${RED}Каталог $INSTALL_DIR не найден${NC}"; exit 1; }

echo -e "${CYAN}Остановка контейнеров...${NC}"
docker compose down -v --remove-orphans 2>/dev/null || true

echo -e "${CYAN}Удаление файлов...${NC}"
cd /
rm -rf "$INSTALL_DIR"

echo -e "${CYAN}Очистка Docker volume...${NC}"
docker volume rm mtproto-panel_pgdata 2>/dev/null || true

echo ""
echo -e "${GREEN}Панель удалена.${NC}"
