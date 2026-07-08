# Инструкция по публикации исправлений в GitHub

## Текущее состояние

✅ **Все исправления готовы и закоммичены локально:**
- `8de0e53` - fix: исправление Docker сборки и подтверждения в uninstall
- `a97e8dd` - fix: исправление TypeScript путей и добавление отладки в Dockerfile

❌ **Проблема:** Изменения НЕ запушены в GitHub, поэтому `wget` скачивает старую версию.

## Что нужно сделать

### Вариант 1: Использовать GitHub Personal Access Token (рекомендуется)

1. **Создайте токен:**
   - Перейдите: https://github.com/settings/tokens
   - Нажмите "Generate new token (classic)"
   - Выберите scopes: `repo` (полный доступ к репозиториям)
   - Скопируйте токен

2. **Запушьте изменения:**
   ```bash
   cd /home/user/mtproto-suite
   
   # Замените YOUR_TOKEN на ваш токен
   git push https://YOUR_TOKEN@github.com/ns8-support/mtproto-suite.git main
   ```

### Вариант 2: Использовать GitHub CLI

1. **Установите GitHub CLI:**
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
   sudo apt update
   sudo apt install gh
   
   # Или через snap
   sudo snap install gh
   ```

2. **Авторизуйтесь:**
   ```bash
   gh auth login
   # Выберите: GitHub.com → HTTPS → Login with a web browser
   ```

3. **Запушьте изменения:**
   ```bash
   cd /home/user/mtproto-suite
   git push origin main
   ```

### Вариант 3: Использовать SSH ключ

1. **Создайте SSH ключ (если ещё нет):**
   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   cat ~/.ssh/id_ed25519.pub
   ```

2. **Добавьте ключ в GitHub:**
   - Перейдите: https://github.com/settings/ssh/new
   - Вставьте публичный ключ

3. **Измените remote на SSH:**
   ```bash
   cd /home/user/mtproto-suite
   git remote set-url origin git@github.com:ns8-support/mtproto-suite.git
   git push origin main
   ```

## Проверка после push

После успешного push проверьте:

```bash
# 1. Проверить, что коммиты в GitHub
git log origin/main --oneline -5

# 2. Подождать 1-2 минуты (GitHub обновляет raw файлы)

# 3. Проверить, что wget скачивает новую версию
wget -qO- https://raw.githubusercontent.com/ns8-support/mtproto-suite/main/uninstall.sh | grep "y/n"
# Должно показать: read -p "Продолжить? (y/n): " CONFIRM

# 4. Проверить Dockerfile
wget -qO- https://raw.githubusercontent.com/ns8-support/mtproto-suite/main/panel-frontend/Dockerfile | grep "shared@file"
# Должно показать: RUN npm install --no-audit --no-fund @mtproto-suite/shared@file:../shared
```

## Альтернатива: Локальная сборка (без push)

Если нет возможности запушить, используйте локальные файлы:

```bash
# Скопировать репозиторий
sudo cp -r /home/user/mtproto-suite /opt/mtproto-suite
cd /opt/mtproto-suite

# Очистить Docker кеш
docker compose down
docker builder prune -af

# Пересобрать из локальных файлов
docker compose build --no-cache --progress=plain

# Запустить
docker compose up -d
```

## Что исправлено

### 1. Docker сборка
- ✅ Убран `npm link ../shared` (не работает в Docker)
- ✅ Добавлена явная установка `npm install @mtproto-suite/shared@file:../shared`
- ✅ Исправлен путь в tsconfig.json: `../../shared/*` → `../shared/*`
- ✅ Изменён `moduleResolution`: `bundler` → `node`

### 2. Подтверждения
- ✅ uninstall.sh: принимает `y`, `Y`, `yes`, `YES`
- ✅ install.sh: все подтверждения принимают `y/n`

### 3. Docker Compose
- ✅ GHCR образы с fallback на локальную сборку
- ✅ Исправлены volumes для shared пакета

## Коммиты для push

```
a97e8dd fix: исправление TypeScript путей и добавление отладки в Dockerfile
8de0e53 fix: исправление Docker сборки и подтверждения в uninstall
```

## Статистика изменений

```
42 files changed, 9736 insertions(+), 154 deletions(-)
```

### Ключевые файлы
- `.github/workflows/docker-publish.yml` (новый - CI/CD для GHCR)
- `install.sh`, `uninstall.sh` (исправления)
- `panel-frontend/Dockerfile`, `panel-backend/Dockerfile`, `service-node/Dockerfile`
- `panel-frontend/tsconfig.json` (исправление путей)
- `shared/package.json` (добавлены exports)
- `docker-compose.yml`, `docker-compose.ssl.yml`, `docker-compose.both.yml`
- `docs/DOCKER_REGISTRY.md` (новый - документация по GHCR)
- `rebuild.sh` (новый - скрипт очистки кеша)
- `diagnose.sh` (новый - диагностический скрипт)

## Следующие шаги после push

1. **Проверить wget:**
   ```bash
   wget -qO- https://raw.githubusercontent.com/ns8-support/mtproto-suite/main/uninstall.sh | head -40
   ```

2. **Протестировать uninstall:**
   ```bash
   bash <(wget -qO- https://raw.githubusercontent.com/ns8-support/mtproto-suite/main/uninstall.sh)
   # Ввести "y" - должно сработать
   ```

3. **Протестировать Docker сборку:**
   ```bash
   cd /opt/mtproto-suite  # или где установлена панель
   docker compose build --no-cache
   ```

4. **Проверить CI/CD:**
   - Перейти: https://github.com/ns8-support/mtproto-suite/actions
   - Убедиться, что workflow "Build and Publish Docker Images" запустился
   - Проверить, что образы опубликованы в GHCR
