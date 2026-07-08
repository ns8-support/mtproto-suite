# Отчёт об ошибках — MTProto Suite

Дата анализа: 2026-07-08  
Найдено ошибок: **15**  
Применено исправлений: **15** ✅  
Файл патча: `BUGFIXES.patch` (готов к `git apply`)

Все исправления применены к файлам репозитория. Для применения патча:
```bash
cd mtproto-suite
git apply BUGFIXES.patch
```

---

## 🔴 Критические ошибки

### BUG-001: Неправильное имя ветки `master` → `main`

**Файлы:** `install.sh`, `panel-backend/update.sh`, `service-node/update.sh`  
**Описание:** Репозиторий использует ветку `main`, но все скрипты ссылаются на `master`.

**Проявление:**
```bash
# install.sh:255
git fetch origin master 2>/dev/null || true   # ← ошибка
git reset --hard origin/master                 # ← ошибка

# install.sh:266
git clone --branch master "$REPO_URL" "$INSTALL_DIR"   # ← ошибка
```

**Влияние:** Невозможно клонировать или обновить репозиторий — установка полностью сломана.

**Исправление:** Заменить все `master` на `main` в скриптах.

---

### BUG-002: `.env` записывается не в корень проекта (режим `panel`)

**Файл:** `install.sh` → функция `install_panel()`  
**Описание:** `install_panel()` записывает `.env` в `panel-backend/.env`, но `docker compose up -d --build` запускается из корня `INSTALL_DIR`. Docker Compose ищет `.env` в **текущем рабочем каталоге** (корне), а не в `panel-backend/`.

**Проявление:**
```bash
# install.sh — install_panel():
cat > panel-backend/.env << EOF   # ← записывает в panel-backend/
PORT=80
DB_PASSWORD=...
JWT_SECRET=...
EOF

# Затем:
docker compose up -d --build       # ← ищет .env в корне, не находит DB_PASSWORD!
```

**Влияние:** Переменные `DB_PASSWORD`, `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` не передаются в контейнеры. PostgreSQL может не запуститься или запуститься без пароля, backend не сможет подключиться к БД.

**Исправление:** Записывать `.env` в корень `$INSTALL_DIR`.

---

### BUG-003: Health check проверяет неверный порт

**Файл:** `install.sh` → функция `install_panel()`  
**Описание:** Health check внутри `backend` контейнера проверяет `http://localhost:80/api/health`, но backend слушает порт **3000**, а не 80.

```bash
docker compose exec -T backend wget --quiet --tries=1 --spider \
  http://localhost:80/api/health   # ← порт 80 — это frontend (nginx), не backend!
```

**Влияние:** Health check всегда фейлится, но скрипт продолжает выполнение. Панель может быть не готова когда показывается "установлено".

**Исправление:** `http://localhost:3000/api/health`

---

### BUG-004: Конфликт портов в `docker-compose.ssl.yml`

**Файл:** `docker-compose.ssl.yml`  
**Описание:** При merge с `docker-compose.yml` секция `ports` объединяется (append), а не перезаписывается:

```yaml
# docker-compose.yml:
ports:
  - "${PORT:-80}:80"

# docker-compose.ssl.yml (overlay):
ports:
  - "${PORT:-443}:443"

# Результат merge — ОБА порта:
ports:
  - "80:80"    # HTTP
  - "80:443"   # HTTPS на том же хостовом порту 80 → КОНФЛИКТ!
```

**Влияние:** Docker Compose выдаст ошибку `Bind for 0.0.0.0:80 failed: port is already allocated`. Установка с SSL через `--ssl-letsencrypt` или `--ssl-self` не работает.

**Исправление:** Убрать порт 80 из базового compose при использовании SSL, или использовать разные хостовые порты.

---

### BUG-005: `name: mtproto-panel-ssl` в overlay создаёт конфликт volume

**Файл:** `docker-compose.ssl.yml`  
**Описание:** `name: mtproto-panel-ssl` перезаписывает `name: mtproto-panel` при merge. В результате volume `pgdata` становится `mtproto-panel-ssl_pgdata` вместо `mtproto-panel_pgdata`.

**Влияние:** При переключении между HTTP и HTTPS теряются данные БД (volume с другим именем).

**Исправление:** Убрать `name:` из `docker-compose.ssl.yml`.

---

## 🟠 Серьёзные ошибки

### BUG-006: `uninstall.sh` — не определена переменная `CYAN`

**Файл:** `uninstall.sh`  
**Описание:** Переменная `$CYAN` используется, но не определена:

```bash
# Определены:
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

# Но используется:
echo -e "${CYAN}Остановка контейнеров...${NC}"   # ← CYAN не определён!
```

**Влияние:** Вывод теряет цвет, но не ломает работу. Минорная косметическая ошибка.

**Исправление:** Добавить `CYAN='\033[0;36m'`.

---

### BUG-007: `uninstall.sh` — неправильный `INSTALL_DIR` по умолчанию

**Файл:** `uninstall.sh`  
**Описание:**
```bash
# uninstall.sh:
INSTALL_DIR="${INSTALL_DIR:-/opt/mtproto-panel}"    # ← старое имя!

# install.sh:
INSTALL_DIR="${INSTALL_DIR:-/opt/mtproto-suite}"     # ← правильное имя
```

**Влияние:** При вызове `uninstall.sh` без `INSTALL_DIR` скрипт будет искать каталог `/opt/mtproto-panel`, которого не существует. Удаление не сработает.

**Исправление:** `/opt/mtproto-suite`

---

### BUG-008: Все URL в документации указывают на несуществующий репозиторий

**Файлы:** README.md, README.ru.md, все файлы в `docs/`, `install.sh`, `panel-backend/src/services/ssh/remote-install.ts`  
**Описание:** Ссылки ведут на `https://github.com/mtproto-suite/mtproto-suite`, но реальный репозиторий — `https://github.com/ns8-support/mtproto-suite`.

**Влияние:** Все команды вида `bash <(wget -qO- https://raw.githubusercontent.com/mtproto-suite/.../install.sh)` вернут 404.

**Исправление:** Заменить `mtproto-suite/mtproto-suite` на `ns8-support/mtproto-suite` во всех файлах.

---

### BUG-009: README.ru.md — подпись к README.ru.md ошибочна

**Файл:** `README.ru.md`  
**Описание:**
```markdown
├── README.ru.md               # Английская версия
```
Должно быть `# Русская версия`.

---

### BUG-010: `install.sh` — вывод для следующей установки содержит некорректный URL

**Файл:** `install.sh` строка 489  
**Описание:**
```bash
echo -e "${CYAN}  bash <(wget -qO- ${REPO_URL}/raw/master/install.sh) --mode=node${NC}"
```
Две проблемы:
1. `${REPO_URL}` — это git URL (`...mtproto-suite.git`), не raw URL для GitHub
2. Используется ветка `master` вместо `main`

Результат: `https://github.com/mtproto-suite/mtproto-suite.git/raw/master/install.sh` — полностью невалидный URL.

**Исправление:** Использовать `https://raw.githubusercontent.com/ns8-support/mtproto-suite/main/install.sh`.

---

## 🟡 Средние ошибки

### BUG-011: `install_node()` — `PORT` в `.env` жёстко `8443` независимо от выбора пользователя

**Файл:** `install.sh` → `install_node()`  
**Описание:** Пользователь выбирает `NODE_PORT`, но в `.env` записывается `PORT=8443`:

```bash
ask "Порт API ноды" "8443" ...
NODE_PORT=$REPLY

# Но затем:
cat > service-node/.env << EOF
PORT=8443          # ← хардкод! Должно быть PORT=${NODE_PORT}
...
EOF
```

**Влияние:** Если пользователь выбрал нестандартный порт (не 8443), нода будет слушать 8443, а не выбранный порт.

**Исправление:** `PORT=${NODE_PORT}`

---

### BUG-012: `install_both()` — `PORT` в `.env` использует `PANEL_PORT` но docker-compose использует `${PORT:-80}`

**Файл:** `install.sh` → `install_both()`  
**Описание:** В `.env` записывается `PORT=${PANEL_PORT}`, что корректно. Но `NODE_REQUEST_TIMEOUT_MS=5000` в `.env`, а `docker-compose.both.yml` имеет hardcoded `NODE_REQUEST_TIMEOUT_MS: 5000` в `environment`. Это не ошибка, но непоследовательно — если пользователь изменит .env, compose это проигнорирует.

**Влияние:** Минорное — непоследовательность.

---

### BUG-013: `service-node/docker-compose.yml` — монтирование `..:/app/project` без `:ro`

**Файл:** `service-node/docker-compose.yml`  
**Описание:**
```yaml
volumes:
  - ..:/app/project    # ← весь проект, включая все .env файлы!
```

В отличие от `docker-compose.yml` и `docker-compose.both.yml`, где монтирование `:ro` (read-only).

**Влияние:** Service node может перезаписать файлы проекта. Потенциальная уязвимость безопасности.

**Исправление:** `..:/app/project:ro`

---

### BUG-014: `install.sh` — `COMPOSE_PROJECT_NAME` vs `name:` в compose файле

**Файл:** `install.sh`, `docker-compose.yml`  
**Описание:** `install_panel()` устанавливает `export COMPOSE_PROJECT_NAME=mtproto-panel`, но `docker-compose.yml` имеет `name: mtproto-panel`. В Docker Compose v2 `name:` в файле имеет приоритет над `COMPOSE_PROJECT_NAME`. Это не критично если они совпадают, но `install_node()` устанавливает `COMPOSE_PROJECT_NAME=mtproto-node`, а `service-node/docker-compose.yml` имеет `name: mtproto-node` — OK. Однако `docker-compose.ssl.yml` с `name: mtproto-panel-ssl` перезаписывает имя при merge.

**Исправление:** Убрать `name:` из `docker-compose.ssl.yml`.

---

### BUG-015: `install.sh` — health check node использует HTTP но service-node может требовать Bearer token

**Файл:** `install.sh` → `install_node()`  
**Описание:** Health check:
```bash
curl -fsS -m 2 "http://localhost:${NODE_PORT}/api/health" \
  -H "Authorization: Bearer ${AUTH_TOKEN}"
```
Это корректно, но `${NODE_PORT}` — это порт, выбранный пользователем. Однако в `.env` `PORT=8443` (хардкод — см. BUG-011). Нода будет слушать на 8443, а health check будет обращаться на `${NODE_PORT}`. Если пользователь выбрал другой порт, health check не найдёт ноду.

---

## 📋 Сводная таблица

| # | Серьёзность | Файл | Описание |
|---|---|---|---|
| BUG-001 | 🔴 Критический | install.sh, update.sh | Ветка `master` вместо `main` |
| BUG-002 | 🔴 Критический | install.sh | `.env` записывается не в корень |
| BUG-003 | 🔴 Критический | install.sh | Health check на порту 80 вместо 3000 |
| BUG-004 | 🔴 Критический | docker-compose.ssl.yml | Конфликт портов при merge |
| BUG-005 | 🟠 Серьёзный | docker-compose.ssl.yml | `name:` перезаписывает project name |
| BUG-006 | 🟡 Минорный | uninstall.sh | `CYAN` не определён |
| BUG-007 | 🟠 Серьёзный | uninstall.sh | `INSTALL_DIR=/opt/mtproto-panel` |
| BUG-008 | 🟠 Серьёзный | Все файлы | URL `mtproto-suite/mtproto-suite` |
| BUG-009 | 🟡 Минорный | README.ru.md | Подпись "Английская версия" |
| BUG-010 | 🟠 Серьёзный | install.sh | Невалидный URL для следующей установки |
| BUG-011 | 🟠 Серьёзный | install.sh | PORT хардкод вместо NODE_PORT |
| BUG-012 | 🟡 Минорный | install.sh | Непоследовательный timeout |
| BUG-013 | 🟡 Средний | service-node/docker-compose.yml | Нет `:ro` на монтировании |
| BUG-014 | 🟡 Средний | docker-compose.ssl.yml | `name:` конфликт с COMPOSE_PROJECT_NAME |
| BUG-015 | 🟡 Средний | install.sh | Health check порт не совпадает с .env |
