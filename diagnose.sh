#!/bin/bash
#
# Диагностический скрипт для проверки исправлений MTProto Suite
#

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0

echo "=========================================="
echo "  Диагностика MTProto Suite"
echo "=========================================="
echo ""

# 1. Проверка наличия файлов
echo "1. Проверка наличия файлов..."
for file in install.sh uninstall.sh docker-compose.yml panel-frontend/Dockerfile panel-backend/Dockerfile service-node/Dockerfile; do
  if [ -f "$file" ]; then
    echo -e "  ${GREEN}✓${NC} $file"
  else
    echo -e "  ${RED}✗${NC} $file НЕ НАЙДЕН"
    ERRORS=$((ERRORS + 1))
  fi
done
echo ""

# 2. Проверка uninstall.sh — подтверждение y/n
echo "2. Проверка uninstall.sh (подтверждение y/n)..."
if grep -q 'read -p "Продолжить? (y/n):"' uninstall.sh; then
  echo -e "  ${GREEN}✓${NC} uninstall.sh использует y/n"
else
  echo -e "  ${RED}✗${NC} uninstall.sh НЕ использует y/n"
  ERRORS=$((ERRORS + 1))
fi

if grep -q '\[yY\]|\[yY\]\[eE\]\[sS\]' uninstall.sh; then
  echo -e "  ${GREEN}✓${NC} uninstall.sh принимает y/Y/yes/YES"
else
  echo -e "  ${RED}✗${NC} uninstall.sh НЕ принимает y/Y/yes/YES"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 3. Проверка Dockerfile — отсутствие npm link
echo "3. Проверка Dockerfile (отсутствие npm link)..."
for df in panel-frontend/Dockerfile panel-backend/Dockerfile service-node/Dockerfile; do
  if grep -q "npm link" "$df"; then
    echo -e "  ${RED}✗${NC} $df содержит npm link (должен быть убран)"
    ERRORS=$((ERRORS + 1))
  else
    echo -e "  ${GREEN}✓${NC} $df НЕ содержит npm link"
  fi
done
echo ""

# 4. Проверка Dockerfile — явная установка shared
echo "4. Проверка Dockerfile (явная установка shared)..."
for df in panel-frontend/Dockerfile panel-backend/Dockerfile service-node/Dockerfile; do
  if grep -q "@mtproto-suite/shared@file:../shared" "$df"; then
    echo -e "  ${GREEN}✓${NC} $df устанавливает shared через file:../shared"
  else
    echo -e "  ${RED}✗${NC} $df НЕ устанавливает shared через file:../shared"
    ERRORS=$((ERRORS + 1))
  fi
done
echo ""

# 5. Проверка shared/package.json — exports
echo "5. Проверка shared/package.json (exports)..."
if grep -q '"exports"' shared/package.json; then
  echo -e "  ${GREEN}✓${NC} shared/package.json имеет exports"
else
  echo -e "  ${RED}✗${NC} shared/package.json НЕ имеет exports"
  ERRORS=$((ERRORS + 1))
fi

if grep -q '"./types"' shared/package.json; then
  echo -e "  ${GREEN}✓${NC} shared/package.json экспортирует ./types"
else
  echo -e "  ${RED}✗${NC} shared/package.json НЕ экспортирует ./types"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 6. Проверка git статуса
echo "6. Проверка git статуса..."
if git diff --quiet HEAD 2>/dev/null; then
  echo -e "  ${GREEN}✓${NC} Все изменения закоммичены"
else
  echo -e "  ${YELLOW}!${NC} Есть незакоммиченные изменения"
fi

if git log origin/main..HEAD --oneline 2>/dev/null | grep -q .; then
  echo -e "  ${YELLOW}!${NC} Есть локальные коммиты, не запушенные в origin/main"
  echo -e "  ${YELLOW}  Запустите:${NC} git push origin main"
else
  echo -e "  ${GREEN}✓${NC} Все коммиты запушены в origin/main"
fi
echo ""

# 7. Проверка синтаксиса bash скриптов
echo "7. Проверка синтаксиса bash скриптов..."
for script in install.sh uninstall.sh panel-backend/update.sh service-node/update.sh; do
  if bash -n "$script" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} $script — синтаксис корректен"
  else
    echo -e "  ${RED}✗${NC} $script — СИНТАКСИЧЕСКАЯ ОШИБКА"
    ERRORS=$((ERRORS + 1))
  fi
done
echo ""

# Итог
echo "=========================================="
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✓ Все проверки пройдены!${NC}"
  echo ""
  echo "Следующие шаги:"
  echo "  1. git push origin main"
  echo "  2. docker compose build --no-cache"
  echo "  3. bash uninstall.sh (и ввести y)"
else
  echo -e "${RED}✗ Найдено ошибок: $ERRORS${NC}"
  echo ""
  echo "Проверьте ошибки выше и исправьте их."
fi
echo "=========================================="

exit $ERRORS
