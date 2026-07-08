# Docker Registry и CI/CD

MTProto Suite автоматически собирает и публикует Docker-образы в GitHub Container Registry (GHCR) при каждом пуше в ветку `main`.

## 📦 Доступные образы

Все образы доступны в GHCR:

```bash
# Panel Backend
ghcr.io/ns8-support/mtproto-suite/panel-backend:latest

# Panel Frontend
ghcr.io/ns8-support/mtproto-suite/panel-frontend:latest

# Service Node
ghcr.io/ns8-support/mtproto-suite/service-node:latest
```

## 🏷️ Теги образов

При публикации создаются следующие теги:

- `latest` — последний коммит в ветке `main`
- `main` — последний коммит в ветке `main`
- `main-<sha>` — конкретный коммит (например, `main-abc1234`)
- `v*.*.*` — релизные теги (например, `v2.0.0`)
- `v*.*` — минорные версии (например, `v2.0`)
- `v*` — мажорные версии (например, `v2`)

## 🚀 Использование в установщике

### Автоматическое использование GHCR

Установщик `install.sh` автоматически пытается скачать образы из GHCR:

```bash
# Установка панели
bash install.sh --mode=panel

# Установка ноды
bash install.sh --mode=node

# Установка обоих компонентов
bash install.sh --mode=both
```

**Логика работы:**
1. Установщик пытается выполнить `docker compose pull`
2. Если образы доступны в GHCR — скачивает их (быстрая установка)
3. Если образы недоступны — собирает локально из исходников (медленнее, но всегда работает)

### Принудительная локальная сборка

Если вы хотите всегда собирать образы локально (например, для разработки или модификаций):

```bash
# Вручную собрать образы перед запуском
cd /opt/mtproto-suite
docker compose build

# Запустить с локальными образами
docker compose up -d
```

## 🔧 Настройка собственного registry

Вы можете использовать собственный Docker registry вместо GHCR.

### Через переменные окружения

Создайте файл `.env` в корне проекта:

```bash
# .env
REGISTRY=your-registry.com
IMAGE_NAMESPACE=your-namespace/mtproto-suite
IMAGE_TAG=v2.0.0
```

Затем запустите:

```bash
docker compose pull
docker compose up -d
```

### Через docker-compose override

Создайте `docker-compose.override.yml`:

```yaml
services:
  backend:
    image: your-registry.com/your-namespace/mtproto-suite/panel-backend:v2.0.0
  
  frontend:
    image: your-registry.com/your-namespace/mtproto-suite/panel-frontend:v2.0.0
  
  service-node:
    image: your-registry.com/your-namespace/mtproto-suite/service-node:v2.0.0
```

## 🔄 Обновление образов

### Автоматическое обновление (рекомендуется)

Используйте встроенную функцию обновления:

```bash
# Обновить панель
cd /opt/mtproto-suite
bash panel-backend/update.sh

# Обновить ноду
cd /opt/mtproto-suite/service-node
bash update.sh
```

Скрипты автоматически:
1. Забирают последние изменения из git
2. Пытаются скачать новые образы из GHCR
3. Если образы недоступны — собирают локально
4. Перезапускают контейнеры

### Ручное обновление

```bash
cd /opt/mtproto-suite

# Скачать последние образы
docker compose pull

# Перезапустить контейнеры
docker compose up -d

# Удалить старые образы (опционально)
docker image prune -f
```

## 🏗️ Локальная разработка

### Сборка образов локально

```bash
# Собрать все образы
docker compose build

# Собрать конкретный образ
docker compose build backend
docker compose build frontend

# Собрать образ ноды
cd service-node
docker compose build
```

### Использование локальных образов

Если вы хотите, чтобы docker-compose использовал только локальные образы (без попытки скачать из GHCR):

```bash
# Удалить image директивы из docker-compose.yml
# Или использовать override:

# docker-compose.override.yml
services:
  backend:
    image: mtproto-suite-panel-backend:local
    build:
      context: .
      dockerfile: panel-backend/Dockerfile
```

## 🔐 Аутентификация в GHCR

Образы в GHCR являются **публичными** и не требуют аутентификации для скачивания.

Если вы хотите использовать приватные образы:

```bash
# Войти в GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin

# Скачать приватные образы
docker compose pull
```

## 📊 CI/CD Pipeline

### Workflow файл

`.github/workflows/docker-publish.yml`

### Триггеры

- **Push в `main`** — сборка и публикация с тегами `latest`, `main`, `main-<sha>`
- **Push тега `v*.*.*`** — сборка и публикация с тегами версии
- **Pull Request** — сборка без публикации (проверка)

### Матрица сборки

Каждый образ собирается для:
- `linux/amd64` (x86_64)
- `linux/arm64` (aarch64)

### Кэширование

Используется GitHub Actions cache для ускорения сборки:
```yaml
cache-from: type=gha
cache-to: type=gha,mode=max
```

## 🐛 Troubleshooting

### Образ не скачивается из GHCR

**Симптом:** Установщик fallback'ит на локальную сборку

**Решение:**
```bash
# Проверить доступность образа
docker pull ghcr.io/ns8-support/mtproto-suite/panel-backend:latest

# Если ошибка 404 — образ ещё не опубликован (первый коммит в main)
# Если ошибка 403 — образ приватный, нужна аутентификация
```

### Локальная сборка занимает много времени

**Симптом:** Установка длится 10+ минут

**Решение:**
- Дождитесь публикации образов в GHCR (обычно 5-10 минут после пуша в main)
- Или используйте pre-built образы из GHCR

### Конфликт версий образов

**Симптом:** Контейнеры не запускаются после обновления

**Решение:**
```bash
# Удалить старые контейнеры и образы
docker compose down
docker compose rm -f
docker image prune -af

# Скачать свежие образы
docker compose pull
docker compose up -d
```

## 📝 Best Practices

### Production

1. **Используйте конкретные теги версий** вместо `latest`:
   ```bash
   IMAGE_TAG=v2.0.0 docker compose up -d
   ```

2. **Тестируйте обновления** перед применением в production:
   ```bash
   # На staging сервере
   docker compose pull
   docker compose up -d
   # Проверьте работоспособность
   ```

3. **Сохраняйте .env файлы** при обновлении:
   ```bash
   cp .env .env.backup
   # Обновление
   cp .env.backup .env
   ```

### Development

1. **Всегда собирайте локально** для тестирования изменений:
   ```bash
   docker compose build
   docker compose up -d
   ```

2. **Используйте docker-compose.override.yml** для локальных настроек

3. **Не коммитьте .env файлы** — используйте `.env.example` как шаблон

## 🔗 Полезные ссылки

- [GitHub Container Registry Documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
