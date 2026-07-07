# Руководство по миграции

Как мигрировать с оригинальных `danielVNru/mtproto-panel` и `danielVNru/mtproto-node` на MTProto Suite v2.0.

[🇬🇧 English version](MIGRATION.md)

## 📋 Содержание

- [Обзор](#-обзор)
- [Совместимость](#-совместимость)
- [Чек-лист перед миграцией](#-чек-лист-перед-миграцией)
- [Стратегии миграции](#-стратегии-миграции)
- [Пошаговая миграция](#-пошаговая-миграция)
- [Миграция данных](#-миграция-данных)
- [Проверка после миграции](#-проверка-после-миграции)
- [План отката](#-план-отката)
- [Изменения API](#-изменения-api)

---

## 🌟 Обзор

MTProto Suite v2.0 — это **drop-in замена** оригинальной двухрепозиторной настройки:

- ✅ Все конфигурации прокси совместимы
- ✅ Все конфигурации нод совместимы
- ✅ API endpoints обратно совместимы
- ✅ Форматы данных (JSON store, env файлы) сохранены
- ⚠️ Некоторые новые функции требуют миграции секретов (JWT_SECRET)

**Время миграции:** 15-30 минут на сервер (панель + каждая нода)

**Downtime:** ~5 минут на сервер (перезапуск контейнеров)

---

## ✅ Совместимость

### Что работает без изменений

| Компонент | Совместимость |
|---|---|
| Конфигурации прокси (`store.json`) | ✅ Тот же формат |
| Кастомные домены | ✅ Тот же формат |
| IP blacklist | ✅ Тот же формат |
| Генерация nginx конфига | ✅ Тот же алгоритм |
| xray/VLESS конфиги | ✅ Тот же формат |
| telemt конфиги | ✅ Тот же формат |
| История статистики | ✅ Тот же формат |
| История IP | ✅ Тот же формат |
| Service node API endpoints | ✅ 100% совместимы |
| Panel API endpoints | ✅ 100% совместимы (deprecated endpoints всё ещё работают) |

### Что требует ручного обновления

| Компонент | Причина | Действие |
|---|---|---|
| `JWT_SECRET` | Нет дефолта в v2.0 | Сгенерировать новый или скопировать из старого |
| `PANEL_FRONTEND_URL` | НОВОЕ в v2.0.0 | Установите HTTPS домен вашей панели для CORS whitelist |
| `DB_PASSWORD` | Нет дефолта в v2.0 | Сгенерировать новый или скопировать из старого |
| Пароль админа | Хешируется с bcrypt cost 12 | Сбросить через install или env var |
| Node `AUTH_TOKEN` | Был опциональным в v1.x | Требуется, минимум 16 символов |
| Имена контейнеров | Теперь используют стабильные префиксы | Авто-мигрируется при старте |
| Директория данных | Была `./data` в корне ноды | Теперь `service-node/data` (изменение пути) |

### Что будет заменено

| Старый репо | Новое расположение |
|---|---|
| `danielVNru/mtproto-panel` | `mtproto-suite/` (panel-backend, panel-frontend) |
| `danielVNru/mtproto-node` | `mtproto-suite/service-node/` |

---

## ✅ Чек-лист перед миграцией

### Перед началом

- [ ] **Бэкап текущей установки**
  ```bash
  # Бэкап панели
  cp -r /opt/mtproto-panel /opt/mtproto-panel.bak
  
  # Бэкап каждой ноды
  ssh root@node1 "cp -r /opt/mtproto-node /opt/mtproto-node.bak"
  ```

- [ ] **Бэкап данных PostgreSQL**
  ```bash
  cd /opt/mtproto-panel
  docker compose exec db pg_dump -U mtproto mtproto_panel > /backup/panel-db-$(date +%Y%m%d).sql
  ```

- [ ] **Бэкап секретов**
  ```bash
  # Панель .env
  cp /opt/mtproto-panel/.env /backup/panel.env
  
  # Каждая нода .env
  ssh root@node1 "cp /opt/mtproto-node/.env /backup/node1.env"
  ```

- [ ] **Бэкап данных прокси**
  ```bash
  # С каждой ноды
  ssh root@node1 "tar czf /backup/node1-data.tar.gz /opt/mtproto-node/data"
  
  # Или используйте встроенный экспорт
  curl -fsS http://node1:8443/api/export \
    -H "Authorization: Bearer $(cat /backup/node1-token)" \
    > /backup/node1-proxies.json
  ```

- [ ] **Документировать текущее состояние**
  ```bash
  # Запишите:
  # - URL и credentials админа
  # - Количество нод
  # - Количество прокси на ноду
  # - Активные VLESS подписки
  ```

- [ ] **Запланировать окно обслуживания**
  - Панель: 30 минут downtime допустимо
  - Каждая нода: 5 минут на ноду (прокси перезапускаются)
  - Лучшее время: часы низкого трафика

- [ ] **Протестировать на non-production сначала**
  - Поднимите тестовый инстанс
  - Восстановите бэкап данных
  - Проверьте, что все функции работают

---

## 🔄 Стратегии миграции

### Стратегия 1: In-Place обновление (рекомендуется)

**Лучше для:** Маленькие развёртывания (1-10 нод)

**Плюсы:** Просто, быстро, без изменения IP
**Минусы:** Некоторый downtime, нужно работать на месте

```bash
# На хосте панели
cd /opt/mtproto-panel
docker compose down

# Бэкап файлов .env
cp .env /backup/old-panel.env
cp panel-backend/.env /backup/old-backend.env  # если существует

# Клонировать новый репозиторий рядом
cd /opt
git clone https://github.com/mtproto-suite/mtproto-suite.git mtproto-suite-new

# Собрать новые образы
cd mtproto-suite-new
cd shared && npm install && npm run build && cd ..
cd panel-backend && npm install && npm run build && cd ..
cd panel-frontend && npm install && npm run build && cd ..

# Мигрировать данные (см. секцию миграции данных ниже)

# Остановить старое, запустить новое
docker compose down -v
cd /opt/mtproto-suite-new
docker compose up -d --build
```

### Стратегия 2: Side-by-Side (безопаснее)

**Лучше для:** Production с требованием нулевого downtime

**Плюсы:** Мгновенный откат, A/B тестирование
**Минусы:** Требуются дополнительные ресурсы, конфликты портов

```bash
# Установить MTProto Suite на других портах
bash install.sh --mode=panel --install-dir=/opt/mtproto-suite-v2
# Используйте порт 8080 (отличный от старого 80)

# Мигрировать данные
# Протестировать новый инстанс со старыми данными

# Переключить DNS / load balancer когда готовы
```

### Стратегия 3: Чистая установка

**Лучше для:** Greenfield развёртывание, изучение системы

**Плюсы:** Чистый лист, нет проблем legacy
**Минусы:** Требуется ручное воссоздание прокси

```bash
# Установить новое
bash install.sh --mode=panel

# Вручную воссоздать каждый прокси через UI
# Или импортировать из старых файлов экспорта (см. ниже)
```

---

## 📝 Пошаговая миграция

### Шаг 1: Остановить старые сервисы

**На хосте панели:**
```bash
cd /opt/mtproto-panel
docker compose down  # Останавливает контейнеры, сохраняет volumes
```

**На каждой ноде:**
```bash
# Остановить только API сервис (прокси продолжают работать пока):
# Или остановить всё для окна обслуживания:
cd /opt/mtproto-node
docker compose down
```

### Шаг 2: Установить MTProto Suite

**На хосте панели:**
```bash
bash <(wget -qO- https://raw.githubusercontent.com/mtproto-suite/mtproto-suite/master/install.sh) --mode=panel
```

Когда попросят, **используйте ТОТ ЖЕ порт**, что у старой установки (или другой, если хотите side-by-side).

### Шаг 3: Мигрировать базу данных (Панель)

**Вариант A: Восстановление из SQL дампа**

```bash
# Остановить новую панель БД
cd /opt/mtproto-suite
docker compose stop db

# Восстановить старую базу данных
docker compose exec -T db dropdb -U mtproto mtproto_panel
docker compose exec -T db createdb -U mtproto mtproto_panel
cat /backup/panel-db-20260706.sql | docker compose exec -T db psql -U mtproto -d mtproto_panel

# Перезапустить
docker compose start db
```

**Вариант B: Миграция вручную**

Если схема значительно отличается, мигрируйте вручную:

```bash
# Экспорт из старого
cd /opt/mtproto-panel.bak
docker compose up -d db
docker compose exec db pg_dump -U mtproto mtproto_panel --data-only > /tmp/old-data.sql

# Импорт в новый
cd /opt/mtproto-suite
# Новые миграции добавят новые колонки (ssl_certificates и т.д.)
# Восстановить данные (игнорировать ошибки для несовместимых строк)
cat /tmp/old-data.sql | docker compose exec -T db psql -U mtproto -d mtproto_panel

# Проверить
docker compose exec db psql -U mtproto -d mtproto_panel -c "SELECT COUNT(*) FROM nodes;"
```

### Шаг 4: Мигрировать данные ноды

**Вариант A: Скопировать директорию данных**

```bash
# На каждой ноде, после остановки старого сервиса:
cd /opt/mtproto-node
cp -r data /backup/data.bak  # Бэкап

# Установить MTProto Suite
bash <(wget -qO- https://raw.githubusercontent.com/mtproto-suite/mtproto-suite/master/install.sh) --mode=node

# Скопировать старые данные в новое место
cp -r /backup/data.bak/* /opt/mtproto-suite/service-node/data/

# Использовать тот же AUTH_TOKEN
grep AUTH_TOKEN /backup/node.env > /opt/mtproto-suite/service-node/.env.tmp
# Отредактируйте service-node/.env и установите AUTH_TOKEN из старого

# Перезапустить
cd /opt/mtproto-suite/service-node
docker compose restart
```

**Вариант B: Используйте встроенный экспорт/импорт**

```bash
# Из старой ноды
curl -fsS http://node-old:8443/api/export \
  -H "Authorization: Bearer $(cat /backup/old-token)" \
  > /tmp/proxies.json

# На новой ноде (через панель)
# 1. Добавьте новую ноду в панель
# 2. Откройте детали ноды
# 3. Нажмите "Импорт" → загрузите /tmp/proxies.json

# Примечание: Это воссоздаёт прокси (новые ID контейнеров)
# История статистики и IP НЕ переносится
```

### Шаг 5: Обновить конфигурацию панели

```bash
# Отредактируйте /opt/mtproto-suite/panel-backend/.env
# Сопоставьте значения из старого /opt/mtproto-panel/.env:

# Скопировать JWT_SECRET (чтобы существующие токены пользователей работали)
JWT_SECRET=<старое-значение>

# Скопировать credentials БД (если хотите переиспользовать старую БД)
DB_PASSWORD=<старый-пароль>

# Админ пользователь автоматически обновляется до ADMIN_PASSWORD из env
# Если хотите переиспользовать старый пароль:
ADMIN_PASSWORD=<старый-пароль-админа>
```

### Шаг 6: Запустить новые сервисы

```bash
# На хосте панели
cd /opt/mtproto-suite
docker compose up -d

# На каждой ноде
cd /opt/mtproto-suite/service-node
docker compose up -d
```

### Шаг 7: Проверить и протестировать

```bash
# Здоровье панели
curl -fsS http://panel:80/api/health

# Здоровье каждой ноды (из панели)
curl -fsS http://node:8443/api/health \
  -H "Authorization: Bearer $(cat /opt/mtproto-suite/service-node/.env | grep AUTH_TOKEN | cut -d= -f2)"

# Войти в UI панели и проверить, что все ноды в списке
# Откройте браузер: http://panel:80
```

---

## 💾 Детали миграции данных

### Данные панели

**Таблица `users`:**
```sql
-- Старые пользователи всё ещё работают (bcrypt-хешированные пароли совместимы)
-- Нужно только наличие password_hash
-- Ручных действий не требуется, если DB_PASSWORD был переиспользован
```

**Таблица `nodes`:**
```sql
-- Та же схема в v2.0 (только добавляет колонку domain, если отсутствует)
-- Миграция выполняет `ALTER TABLE nodes ADD COLUMN IF NOT EXISTS domain`
```

**Новые таблицы (создаются автоматически):**
- `proxy_overrides`
- `ssl_certificates`
- `cloudflare_credentials`
- `node_metrics_history`
- `netbird_status`

### Данные ноды

**`store.json`** — тот же формат, drop-in совместим.

**`stats-history.json`** — тот же формат.

**`ip-history.json`** — тот же формат.

**Состояние контейнеров:**
- Все существующие контейнеры будут обнаружены по префиксу имени
- Контейнеры со старыми именами (`mtproto-proxy-X` → всё ещё работают благодаря сопоставлению имён)
- Контейнеры с новыми именами будут созданы заново

### Состояние сети

**Docker сеть `mtproto-net`:**
- Создаётся новым установщиком
- То же имя, та же подсеть
- Существующие контейнеры автоматически переподключаются

---

## 🔌 Изменения API

### Deprecated endpoints (всё ещё работают)

Эти endpoints работают, но показывают предупреждения о deprecation:

| Старый endpoint | Новый endpoint |
|---|---|
| `GET /api/system/stats` | `POST /api/nodes/:id/metrics` |
| `GET /api/proxies/stats/all` | `GET /api/proxies/all` (расширенный) |

### Новые endpoints

| Endpoint | Описание |
|---|---|
| `POST /api/remote-install/test-ssh` | Тест SSH соединения |
| `POST /api/remote-install/node` | Установить service-node удалённо |
| `POST /api/nodes/:id/metrics` | Собрать метрики |
| `GET /api/nodes/:id/metrics/history` | История метрик |
| `POST /api/nodes/:id/system-info` | Информация об ОС |
| `POST /api/nodes/:id/docker-stats` | Docker статистика |
| `POST /api/nodes/:id/restart-service` | Перезапустить сервис |
| `POST /api/nodes/:id/reboot` | Перезагрузить сервер |
| `POST /api/nodes/:id/netbird/install` | Установить NetBird |
| `GET /api/nodes/:id/netbird/cached-status` | Статус NetBird (кешированный) |
| `POST /api/ssl/cloudflare/test` | Тест Cloudflare токена |
| `POST /api/ssl/wildcard/obtain` | Получить wildcard сертификат |
| `GET /api/ssl/wildcard/status` | Список сертификатов |
| `POST /api/ssl/zones` | Список Cloudflare zones |

### Изменения формата ответа

| Аспект | Старый | Новый |
|---|---|---|
| Формат ошибки | `{ message: '...' }` | `{ error: '...' }` |
| Timestamps | ISO строка | ISO строка (тот же) |
| IDs | Число | Строка (на основе UUID) |

**Влияние на миграцию:** Если у вас есть скрипты, использующие `response.message`, обновите до `response.error`.

---

## ✅ Проверка после миграции

### Чек-лист

- [ ] **Панель доступна** по ожидаемому URL
- [ ] **Вход работает** со старыми admin credentials
- [ ] **Все ноды в списке** в панели
- [ ] **Health checks нод проходят** (зелёные точки)
- [ ] **Прокси в списке** с правильным количеством на ноду
- [ ] **tg:// ссылки** всё ещё работают (тест через Telegram)
- [ ] **Сбор статистики** работает (проверьте через 5 мин)
- [ ] **Нет ошибок в логах** (`docker compose logs`)
- [ ] **Бэкап новой установки** (`cp -r /opt/mtproto-suite /opt/mtproto-suite.bak`)

### Команды для проверки

```bash
# Панель: список всех нод с health
curl -fsS http://panel/api/proxies/all \
  -H "Authorization: Bearer $(cat jwt)" | \
  jq '.[] | {node: .nodeName, online: .online, proxies: (.proxies | length)}'

# Должно показать: все ноды онлайн, правильное количество прокси

# Нода: проверить, что каждый контейнер запущен
docker ps --filter "name=mtproto-" --format "table {{.Names}}\t{{.Status}}"

# Должно показать: mtproto-nginx (Up), mtproto-proxy-* (Up), и т.д.

# Тест подключения прокси снаружи
# Откройте Telegram, вставьте tg:// ссылку, проверьте подключение
```

### Мониторьте наличие проблем

После миграции мониторьте 24 часа:

```bash
# Следить за логами панели
cd /opt/mtproto-suite
docker compose logs -f

# Следить за логами ноды
ssh root@node1 "cd /opt/mtproto-suite/service-node && docker compose logs -f"
```

Следите за:
- ✅ Прокси принимают подключения (проверка через Telegram)
- ✅ Нет crash loops в контейнерах
- ✅ Статистика собирается каждые 5 мин
- ⚠️ Проблемы SSH соединений (изменения сети)
- ⚠️ Утечки памяти (сравнение baseline метрик)

---

## ⏪ План отката

Если миграция не удалась:

### Быстрый откат (5 минут)

```bash
# Остановить новую установку
cd /opt/mtproto-suite
docker compose down

# Запустить старую установку
cd /opt/mtproto-panel
docker compose up -d

# Проверить
curl -fsS http://panel/api/health
```

### Полный откат (15 минут)

```bash
# Восстановить из бэкапов
cd /
rm -rf /opt/mtproto-suite
mv /opt/mtproto-panel.bak /opt/mtproto-panel

# Восстановить БД
cd /opt/mtproto-panel
docker compose up -d db
cat /backup/panel-db-20260706.sql | docker compose exec -T db psql -U mtproto -d mtproto_panel

# Восстановить данные ноды
ssh root@node1 "rm -rf /opt/mtproto-node; mv /opt/mtproto-node.bak /opt/mtproto-node"
ssh root@node1 "cd /opt/mtproto-node && docker compose up -d"

# Проверить старую панель
# Откройте браузер, протестируйте
```

### Соображения по откату

- **Прокси получат новые ID контейнеров** (даже при откате, конфиги прокси в БД требуют ре-импорта)
- **История статистики сохранена** в JSON файлах (просто скопируйте обратно)
- **История IP сохранена** (просто скопируйте обратно)
- **JWT токены, выданные в новой панели, становятся невалидными** в старой панели (пользователи входят заново)

---

## 🤔 Частые проблемы миграции

### Проблема: Несовпадение JWT_SECRET приводит к выходу пользователей из системы

**Решение:**
```bash
# Скопировать старый JWT_SECRET в новый
grep '^JWT_SECRET=' /backup/old-panel.env
# Отредактируйте /opt/mtproto-suite/panel-backend/.env
# Установите JWT_SECRET в то же значение
docker compose restart backend
# Пользователям не нужно входить заново
```

### Проблема: DB_PASSWORD изменён, панель не может подключиться к БД

**Решение:**
```bash
# Вариант A: Переиспользовать старый DB_PASSWORD
grep '^DB_PASSWORD=' /backup/old-panel.env
# Обновите /opt/mtproto-suite/panel-backend/.env И docker-compose.yml

# Вариант B: Восстановить старую БД в новый контейнер
docker compose exec db psql -U mtproto -d mtproto_panel -c "ALTER USER mtproto WITH PASSWORD 'старый-пароль';"
```

### Проблема: AUTH_TOKEN не совпадает между БД панели и нодой

**Решение:**
```bash
# Обновить в UI панели:
# Ноды → Редактировать → Новый токен

# Или через API:
curl -X PUT http://panel/api/nodes/1 \
  -H "Authorization: Bearer $(cat jwt)" \
  -H "Content-Type: application/json" \
  -d '{"token": "фактический-токен-с-ноды"}'
```

### Проблема: Контейнеры прокси имеют старые имена и не появляются в новой системе

**Решение:**
```bash
# Пересоздать контейнеры с новым соглашением об именовании
# На ноде, для каждого старого контейнера:
docker stop <старый-контейнер>
docker rm <старый-контейнер>

# Триггернуть пересоздание через панель:
# Детали ноды → Клик по прокси → "Перезапустить"
```

### Проблема: nginx конфиг не перезагрузился после миграции

**Решение:**
```bash
# На ноде
cd /opt/mtproto-suite/service-node
docker exec mtproto-nginx nginx -s reload

# Или пересоздать контейнер
docker compose restart mtproto-nginx
```

---

## 📞 Получение помощи

Если у вас возникли проблемы во время миграции:

1. **Проверьте [TROUBLESHOOTING.md](TROUBLESHOOTING.ru.md)** для частых проблем
2. **Поищите существующие issues**: https://github.com/mtproto-suite/mtproto-suite/issues
3. **Откройте новый issue** с:
   - Старая версия (panel v1.x.x, node v1.x.x)
   - Новая версия (v2.0.0)
   - Шаг, на котором застряли
   - Полный вывод ошибки
   - Доступные файлы бэкапа

---

## 🎉 Преимущества после миграции

После успешной миграции вы получите:

✅ **Лучшая безопасность** — JWT_SECRET обязателен, timingSafeEqual, валидация
✅ **Лучший мониторинг** — графики CPU/RAM/Disk, метрики в реальном времени
✅ **Лучшее управление** — удалённая установка, NetBird mesh, wildcard SSL
✅ **Лучшая производительность** — Async I/O, атомарные записи, кеширование
✅ **Активная разработка** — регулярные обновления, патчи безопасности
✅ **Единый проект** — один репозиторий, общие типы, более простые обновления
