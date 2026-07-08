# Инструкции по публикации исправлений

## Проблема

Все исправления закоммичены локально, но **не запушены в GitHub**. Поэтому когда вы скачиваете скрипты через `wget`, вы получаете старую версию.

## Решение

### Вариант 1: Запушить в репозиторий (рекомендуется)

```bash
cd /home/user/mtproto-suite

# Запушить все изменения в main
git push origin main

# Или если нужна force push (если история расходится)
git push -f origin main
```

После этого все исправления будут доступны через `wget`.

### Вариант 2: Использовать локальные файлы

Если нет прав на push, используйте локальные файлы:

```bash
# Копировать репозиторий в /opt
sudo cp -r /home/user/mtproto-suite /opt/mtproto-suite
cd /opt/mtproto-suite

# Запустить установку из локальных файлов
sudo bash install.sh
```

## Проверка

После push проверьте, что wget скачивает новую версию:

```bash
# Скачать uninstall.sh
wget -qO- https://raw.githubusercontent.com/ns8-support/mtproto-suite/main/uninstall.sh | grep "y/n"

# Должно показать: read -p "Продолжить? (y/n): " CONFIRM
```

## Что исправлено

### 1. Docker сборка
- ✅ Убран `npm link ../shared`
- ✅ Добавлена явная установка `npm install @mtproto-suite/shared@file:../shared`
- ✅ Исправлены пути в shared/package.json

### 2. Подтверждения
- ✅ uninstall.sh: принимает `y`, `Y`, `yes`, `YES`
- ✅ install.sh: все подтверждения принимают `y/n`

### 3. Docker Compose
- ✅ GHCR образы с fallback на локальную сборку
- ✅ Исправлены volumes для shared пакета

## Статистика коммита

```
40 files changed, 9458 insertions(+), 150 deletions(-)
```

### Изменённые файлы
- `.github/workflows/docker-publish.yml` (новый)
- `docker-compose.yml`, `docker-compose.ssl.yml`, `docker-compose.both.yml`
- `install.sh`, `uninstall.sh`
- `panel-frontend/Dockerfile`, `panel-backend/Dockerfile`, `service-node/Dockerfile`
- `shared/package.json`
- `docs/DOCKER_REGISTRY.md` (новый)
- И 30+ других файлов

## Следующие шаги

1. **Запушить изменения**: `git push origin main`
2. **Проверить wget**: скачать uninstall.sh и проверить, что там `y/n`
3. **Протестировать Docker сборку**: `docker compose build --no-cache`
4. **Протестировать uninstall**: `bash uninstall.sh` и ввести `y`
