#!/bin/bash
#
# Удаление MTProto Suite: останавливает контейнеры, удаляет данные, volumes и сертификаты.
#
# Поддерживает удаление всех режимов установки: panel, node, both.
# Принимает: y/yes/Y/YES для подтверждения, всё остальное — отмена.

set -e

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

INSTALL_DIR="${INSTALL_DIR:-/opt/mtproto-suite}"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  Удаление MTProto Suite                 ${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""
echo -e "Будет удалено:"
echo "  - Каталог: $INSTALL_DIR"
echo "  - Docker контейнеры панели и ноды"
echo "  - Docker volumes (БД и данные нод)"
echo "  - Docker сеть mtproto-net"
echo "  - SSL сертификаты"
echo ""

# Подтверждение: принимаем y/yes/Y/YES
read -p "Продолжить? (y/n): " CONFIRM
case "$CONFIRM" in
  [yY]|[yY][eE][sS]) ;;
  *)
    echo -e "${YELLOW}Отменено.${NC}"
    exit 0
    ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  echo -e "${RED}Требуются права root.${NC}"
  exit 1
fi

# ============ Остановка контейнеров ============

echo -e "${CYAN}Остановка контейнеров...${NC}"

# Останавливаем все compose-проекты, которые могли быть созданы
if [ -d "$INSTALL_DIR" ]; then
  cd "$INSTALL_DIR"

  # Режим panel
  COMPOSE_PROJECT_NAME=mtproto-panel docker compose down -v --remove-orphans 2>/dev/null || true

  # Режим node
  if [ -f service-node/docker-compose.yml ]; then
    cd service-node
    COMPOSE_PROJECT_NAME=mtproto-node docker compose down -v --remove-orphans 2>/dev/null || true
    cd ..
  fi

  # Режим both
  if [ -f docker-compose.both.yml ]; then
    COMPOSE_PROJECT_NAME=mtproto-suite docker compose -f docker-compose.both.yml down -v --remove-orphans 2>/dev/null || true
  fi

  # Общий compose (если был запущен из корня)
  docker compose down -v --remove-orphans 2>/dev/null || true
fi

# ============ Удаление Docker ресурсов ============

echo -e "${CYAN}Удаление Docker сети...${NC}"
docker network rm mtproto-net 2>/dev/null || true

echo -e "${CYAN}Удаление Docker volumes...${NC}"
# Удаляем все volumes, связанные с проектом
for v in $(docker volume ls -q 2>/dev/null | grep -E 'mtproto' || true); do
  echo "  Удаляю volume: $v"
  docker volume rm "$v" 2>/dev/null || true
done

# Также удаляем volumes по конкретным именам (на случай если grep не нашёл)
docker volume rm mtproto-panel_pgdata mtproto-suite_pgdata 2>/dev/null || true

# ============ Удаление файлов ============

echo -e "${CYAN}Удаление файлов...${NC}"
cd /
rm -rf "$INSTALL_DIR"

# ============ Удаление cron задач (Let's Encrypt renewal) ============

if crontab -l 2>/dev/null | grep -q 'certbot renew.*mtproto'; then
  echo -e "${CYAN}Удаление cron задачи certbot...${NC}"
  crontab -l 2>/dev/null | grep -v 'certbot renew.*mtproto' | crontab - 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ✓ MTProto Suite удалён                ${NC}"
echo -e "${GREEN}========================================${NC}"
