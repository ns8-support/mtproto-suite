#!/bin/bash
#
# Скрипт для публикации изменений в GitHub
#

set -e

echo "=========================================="
echo "  Публикация изменений в GitHub"
echo "=========================================="
echo ""

cd "$(dirname "$0")"

# Проверка статуса
echo "1. Проверка статуса..."
UNPUSHED=$(git log origin/main..HEAD --oneline 2>/dev/null | wc -l)

if [ "$UNPUSHED" -eq 0 ]; then
  echo "✓ Все изменения уже запущены в GitHub"
  exit 0
fi

echo "  Найдено $UNPUSHED незапушенных коммитов:"
git log origin/main..HEAD --oneline
echo ""

# Запрос токена
echo "2. Для push требуется GitHub Personal Access Token"
echo ""
echo "   Как получить токен:"
echo "   1. Перейдите: https://github.com/settings/tokens"
echo "   2. Нажмите 'Generate new token (classic)'"
echo "   3. Выберите scope: 'repo'"
echo "   4. Скопируйте токен"
echo ""

read -s -p "Введите GitHub token: " TOKEN
echo ""

if [ -z "$TOKEN" ]; then
  echo "✗ Токен не предоставлен. Отмена."
  exit 1
fi

# Push
echo ""
echo "3. Публикация изменений..."
if git push "https://${TOKEN}@github.com/ns8-support/mtproto-suite.git" main; then
  echo ""
  echo "=========================================="
  echo "  ✓ Изменения успешно опубликованы!"
  echo "=========================================="
  echo ""
  echo "Подождите 1-2 минуты, затем проверьте:"
  echo ""
  echo "  # Проверить uninstall.sh"
  echo "  wget -qO- https://raw.githubusercontent.com/ns8-support/mtproto-suite/main/uninstall.sh | grep 'y/n'"
  echo ""
  echo "  # Проверить CI/CD"
  echo "  https://github.com/ns8-support/mtproto-suite/actions"
  echo ""
else
  echo ""
  echo "✗ Ошибка при публикации. Проверьте:"
  echo "  - Правильность токена"
  echo "  - Права доступа (scope: repo)"
  echo "  - Наличие прав на push в репозиторий"
  exit 1
fi
