# Архитектура

Технический глубокий разбор архитектуры MTProto Suite, дизайн-решений и потоков данных.

[🇬🇧 English version](ARCHITECTURE.md)

## 📋 Содержание

- [Обзор системы](#-обзор-системы)
- [Архитектура компонентов](#-архитектура-компонентов)
- [Потоки данных](#-потоки-данных)
- [Архитектура хранения](#-архитектура-хранения)
- [Сетевая архитектура](#-сетевая-архитектура)
- [Архитектура безопасности](#-архитектура-безопасности)
- [Соображения производительности](#-соображения-производительности)
- [Стратегия масштабирования](#-стратегия-масштабирования)

---

## 🌐 Обзор системы

MTProto Suite — это **распределённая control plane** для управления MTProto прокси. Она следует классическому разделению **control plane / data plane**:

```
┌─────────────────────────────────────────────────────────────────┐
│                      CONTROL PLANE                                │
│                       (Хост панели)                                │
│                                                                   │
│  ┌─────────┐    ┌──────────┐    ┌─────────┐    ┌──────────────┐  │
│  │ Web UI  │───▶│  API     │───▶│   БД    │    │  Мониторинг  │  │
│  │ (React) │    │ (Express)│    │ (PG)    │    │  (SSH пул)   │  │
│  └─────────┘    └────┬─────┘    └─────────┘    └──────────────┘  │
│                     │                                             │
└─────────────────────┼─────────────────────────────────────────────┘
                      │ SSH + Bearer-token API
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
┌──────────────────────────────────────────────────────────────────┐
│                       DATA PLANE                                   │
│                      (Сервис-ноды)                                  │
│                                                                   │
│   Нода #1            Нода #2             Нода #N                  │
│  ┌──────────┐         ┌──────────┐         ┌──────────┐            │
│  │ Express  │         │ Express  │         │ Express  │            │
│  │  API     │         │  API     │         │  API     │            │
│  └────┬─────┘         └────┬─────┘         └────┬─────┘            │
│       │                    │                    │                  │
│  ┌────▼─────┐         ┌────▼─────┐         ┌────▼─────┐            │
│  │  nginx   │         │  nginx   │         │  nginx   │            │
│  │ SNI 443  │         │ SNI 443  │         │ SNI 443  │            │
│  └────┬─────┘         └────┬─────┘         └────┬─────┘            │
│       │                    │                    │                  │
│  ┌────▼─────┐         ┌────▼─────┐         ┌────▼─────┐            │
│  │ telemt   │         │ telemt   │         │ telemt   │            │
│  │ прокси   │         │ прокси   │         │ прокси   │            │
│  └────┬─────┘         └────┬─────┘         └────┬─────┘            │
│       │                    │                    │                  │
│  ┌────▼─────┐         ┌────▼─────┐         ┌────▼─────┐            │
│  │  xray    │         │  xray    │         │  xray    │            │
│  │ (VPN)    │         │ (VPN)    │         │ (VPN)    │            │
│  └──────────┘         └──────────┘         └──────────┘            │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Принципы дизайна

1. **Stateless control plane** — панель можно перезапустить без потери данных (БД персистентна)
2. **Stateless data plane** — сервис-ноды хранят состояние в JSON файлах, но могут восстановить из конфига панели
3. **Pull-based конфигурация** — сервис-ноды получают изменения конфига от панели
4. **Push-based команды** — панель может отправлять команды (restart, reboot, install)
5. **Async всё** — никаких блокирующих операций, весь I/O асинхронный
6. **Fail-safe дефолты** — строгая валидация предотвращает сохранение невалидных конфигов

---

## 🧩 Архитектура компонентов

### Shared Package (`@mtproto-suite/shared`)

Общие TypeScript типы и утилиты, используемые и в panel-backend, и в service-node.

**Типы:**
- `ProxyConfig` — состояние прокси (id, name, port, domain, status, ...)
- `ProxyStats` — runtime метрики (CPU, memory, network, uptime)
- `VlessConfig` — структура VLESS подписки
- `NodeMetrics` — системные метрики (CPU, memory, disk)
- `SystemInfo` — информация об ОС (hostname, kernel, IP)
- `ContainerStats` — метрики Docker контейнеров

**Утилиты:**
- `createTarBuffer()` — TAR архив с одним файлом (для `docker putArchive`)
- `extractIp()` — парсер IP через regex
- `fetchWithTimeout()` — fetch с таймаутом через AbortController
- `mergeSignals()` — комбинирует несколько AbortSignals в один
- `logger` — структурированный JSON логгер

**Константы:**
- `TELEGRAM_DC_RANGES` — IP префиксы дата-центров Telegram
- `FAKE_TLS_DOMAINS` — пул из 50+ доменов для fake TLS
- `DOCKER_NETWORK_NAME` — `mtproto-net`
- `CONTAINER_PREFIXES` — соглашения об именовании
- `PORT_RANGE` — диапазон авто-назначения портов

### Panel Backend

**Стек:**
- Express 4 + TypeScript
- PostgreSQL 16 (jsonb, uuid, индексы)
- bcrypt (cost 12) для паролей
- jsonwebtoken для JWT
- ssh2 для SSH клиента (удалённая установка, мониторинг)
- acme-client v5 + node-forge (wildcard SSL)
- axios (Cloudflare API)
- pg (PostgreSQL клиент)

**Ответственности:**
1. **Аутентификация** — выдача и валидация JWT
2. **Управление пользователями** — создание админа, хеширование паролей
3. **Реестр нод** — CRUD для сервис-нод в PostgreSQL
4. **Проксирование запросов** — REST API, проксирующий запросы к нодам
5. **Удалённая установка** — SSH установка service-node
6. **Прокси мониторинга** — SSH сбор метрик
7. **Управление NetBird** — установка и статус
8. **Wildcard SSL** — ACME протокол + Cloudflare DNS-01

**Структура директорий:**
```
panel-backend/src/
├── config/         # Валидация ENV, парсинг портов
├── db/             # Pool, миграции, схема
├── middleware/     # JWT auth, валидация
├── routes/         # REST endpoints
│   ├── auth.ts
│   ├── nodes.ts
│   ├── proxies.ts
│   ├── allProxies.ts
│   ├── remote-install.ts
│   ├── ssl.ts
│   └── nodes-monitoring.ts
├── services/       # Бизнес-логика
│   ├── ssh/        # SSH клиент, метрики, действия
│   ├── ssl/        # ACME + Cloudflare
│   └── netbird/    # Mesh VPN
└── utils/          # Хелперы (validation, fetchWithTimeout)
```

### Service Node

**Стек:**
- Express 4 + TypeScript
- dockerode (Docker API клиент)
- Встроенный Node.js fetch для внешних API (ip-api.com)

**Ответственности:**
1. **Жизненный цикл контейнеров** — создание/запуск/остановка/удаление Docker контейнеров
2. **SNI роутинг nginx** — генерация конфига, запись в nginx, reload
3. **Интеграция VLESS** — парсинг подписок, создание xray контейнеров
4. **Сбор статистики** — Docker stats, real-time nginx log watcher
5. **История IP** — отслеживание подключений, lookup геолокации
6. **Кастомные домены** — управление пользовательским пулом доменов
7. **IP blacklist** — применение к nginx deny директивам

**Структура директорий:**
```
service-node/src/
├── config/         # Валидация ENV
├── middleware/     # Bearer-token auth (timingSafeEqual)
├── routes/         # REST endpoints
│   ├── health.ts
│   └── proxy.ts
├── services/       # Бизнес-логика
│   ├── docker.ts   # Управление telemt контейнерами
│   ├── nginx.ts    # SNI роутер + log watcher
│   ├── xray.ts     # VLESS → SOCKS5
│   └── proxy.ts    # CRUD оркестратор
├── store/          # JSON хранилище с mutex
└── utils/          # Crypto, хелперы
```

### Panel Frontend

**Стек:**
- React 18 + TypeScript
- Vite 5 (сборка, dev сервер)
- React Router 6 (SPA роутинг)
- Custom CSS modules (без UI фреймворков)

**Ответственности:**
1. **Auth UI** — форма входа, JWT хранение
2. **UI управления нодами** — список, добавление, мониторинг
3. **UI управления прокси** — CRUD с расширенной конфигурацией
4. **UI мониторинга** — авто-обновление метрик, графики
5. **NetBird UI** — установка, статус, список peers
6. **SSL UI** — wizard wildcard сертификата
7. **Массовые операции** — экспорт/импорт прокси

**Структура директорий:**
```
panel-frontend/src/
├── api/            # Типизированный API клиент
├── hooks/          # useAsync, useNodes и т.д.
├── components/     # Переиспользуемые UI компоненты
│   ├── Monitoring/ # MetricsCard, MetricsChart, ActionPanel
│   ├── NetBird/    # NetBirdPanel
│   ├── SSL/        # WildcardSslDialog
│   └── RemoteInstall/ # RemoteInstallDialog
├── pages/          # Компоненты маршрутов
│   ├── Login/
│   ├── Nodes/
│   ├── NodeDetail/
│   └── SSL/
└── utils/          # chart, format, clipboard
```

---

## 🔄 Потоки данных

### Создание прокси (Действие пользователя → Контейнер работает)

```
┌──────┐    ┌─────────┐    ┌─────────┐    ┌──────────┐    ┌─────────┐
│ UI   │    │ Panel   │    │ Panel   │    │ Service  │    │ Docker  │
│      │    │ Frontend│    │ Backend │    │ Node     │    │         │
└──┬───┘    └────┬────┘    └────┬────┘    └────┬─────┘    └────┬────┘
   │            │              │              │              │
   │ 1. POST /api/nodes/1/proxies              │              │
   ├───────────▶│              │              │              │
   │            │ 2. Пересылка на ноду         │              │
   │            ├─────────────▶│              │              │
   │            │              │ 3. POST /api/proxies        │
   │            │              ├─────────────▶│              │
   │            │              │              │ 4. создать   │
   │            │              │              ├─────────────▶│
   │            │              │              │ 5. запустить │
   │            │              │              │◀─────────────┤
   │            │              │ 6. Обновить store.json       │
   │            │              │◀─────────────┤              │
   │            │              │ 7. Обновить nginx.conf       │
   │            │              │◀─────────────┤              │
   │            │              │ 8. nginx -s reload          │
   │            │              │◀─────────────┤              │
   │            │ 9. Вернуть конфиг прокси       │              │
   │            │◀─────────────┤              │              │
   │ 10. Показать успех          │              │              │
   │◀───────────┤              │              │              │
```

**Время:** ~2 секунды всего

### Подключение клиента → Telegram DC (Путь запроса)

```
┌────────┐    ┌─────────┐    ┌─────────┐    ┌──────────┐    ┌─────────────┐
│Клиент  │    │nginx    │    │telemt   │    │xray      │    │Telegram DC  │
│(Telegram)   │(SNI)    │    │(прокси) │    │(VLESS)   │    │             │
└───┬────┘    └────┬────┘    └────┬────┘    └────┬─────┘    └────┬───────┘
    │             │              │              │              │
    │ 1. TLS ClientHello (SNI: google.com)      │              │
    ├────────────▶│              │              │              │
    │             │ 2. Маршрутизация по SNI      │              │
    │             ├─────────────▶│              │              │
    │             │              │ 3. Декодировать MTProto secret│
    │             │              │              │              │
    │             │              │ 4. (Hybrid режим)            │
    │             │              │ - ME: прямой (host маршруты │
    │             │              │   в tun0 → EU IP)          │
    │             │              │ - DC: через xray SOCKS5     │
    │             │              ├─────────────▶│              │
    │             │              │              │ 5. VLESS к   │
    │             │              │              │   VPN серверу│
    │             │              │              ├─────────────▶│
    │             │              │              │ 6. Соединение│
    │             │              │              │   с DC       │
    │             │              │              │◀─────────────┤
    │             │              │ 7. Проксировать данные      │
    │◀────────────┴──────────────┴──────────────┴──────────────┤
```

**Задержка:** ~50-200мс (в зависимости от VPN маршрута)

### Сбор метрик (Действие пользователя → Метрики отображены)

```
┌──────┐    ┌─────────┐    ┌─────────┐    ┌──────────┐    ┌─────────┐
│ UI   │    │ Panel   │    │ Panel   │    │ Service  │    │ Linux   │
│      │    │ Frontend│    │ Backend │    │ Node     │    │ сервер  │
└──┬───┘    └────┬────┘    └────┬────┘    └────┬─────┘    └────┬────┘
   │            │              │              │              │
   │ 1. GET /api/nodes/1/metrics               │              │
   ├───────────▶│              │              │              │
   │            │ 2. POST /api/nodes/1/metrics              │
   │            ├─────────────▶│              │              │
   │            │              │ 3. SSH exec (параллельно):    │
   │            │              │    - top -bn1                │
   │            │              │    - free -b                 │
   │            │              │    - df -B1 -P               │
   │            │              │    - docker stats            │
   │            │              ├─────────────▶│              │
   │            │              │              ├─────────────▶│
   │            │              │              │◀─────────────┤
   │            │              │ 4. Парсинг ответов           │
   │            │              │◀─────────────┤              │
   │            │              │ 5. Сохранить в таблицу истории│
   │            │              │              │              │
   │            │ 6. Вернуть NodeMetrics          │              │
   │            │◀─────────────┤              │              │
   │ 7. Отобразить в UI          │              │              │
   │◀───────────┤              │              │              │
```

**Время:** ~1-2 секунды (4 параллельных SSH вызова)

---

## 💾 Архитектура хранения

### Панель: PostgreSQL

**База данных:** `mtproto_panel`

**Таблицы:**

#### `users`
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(60) NOT NULL,  -- bcrypt, ровно 60 символов
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Индексы:
- UNIQUE на `username` (автоматический)

#### `nodes`
```sql
CREATE TABLE nodes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL DEFAULT '',
  ip VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL CHECK (port > 0 AND port <= 65535),
  token VARCHAR(64) NOT NULL,
  domain VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Индексы:
- `idx_nodes_ip` (B-tree на `ip`)

#### `proxy_overrides`
```sql
CREATE TABLE proxy_overrides (
  id SERIAL PRIMARY KEY,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  proxy_id VARCHAR(32) NOT NULL,
  promo VARCHAR(255) DEFAULT '',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(node_id, proxy_id)
);
```

#### `ssl_certificates`
```sql
CREATE TABLE ssl_certificates (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  domain VARCHAR(255) NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'wildcard',
  issuer VARCHAR(255) DEFAULT '',
  valid_from TIMESTAMP,
  valid_to TIMESTAMP,
  serial_number VARCHAR(128) DEFAULT '',
  certificate_path TEXT NOT NULL,
  private_key_path TEXT,
  auto_renew BOOLEAN DEFAULT true,
  last_renewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `cloudflare_credentials`
```sql
CREATE TABLE cloudflare_credentials (
  id SERIAL PRIMARY KEY,
  api_token_encrypted TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### `node_metrics_history`
```sql
CREATE TABLE node_metrics_history (
  id SERIAL PRIMARY KEY,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cpu_percent NUMERIC(5,2) NOT NULL,
  memory_percent NUMERIC(5,2) NOT NULL,
  disk_percent NUMERIC(5,2) NOT NULL,
  running_containers INTEGER NOT NULL DEFAULT 0,
  load_avg_1 NUMERIC(6,3),
  load_avg_5 NUMERIC(6,3)
);
```

Индексы:
- `idx_node_metrics_history_node_time` (`node_id`, `timestamp DESC`)

Хранение данных: 1000 точек на ноду (авто-trim)

#### `netbird_status`
```sql
CREATE TABLE netbird_status (
  id SERIAL PRIMARY KEY,
  node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  installed BOOLEAN DEFAULT false,
  connected BOOLEAN DEFAULT false,
  mesh_ip VARCHAR(64),
  peer_name VARCHAR(255),
  management_url VARCHAR(512),
  version VARCHAR(64),
  peers_json JSONB,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(node_id)
);
```

### Service Node: JSON файлы

**Расположение:** `/opt/mtproto-suite/service-node/data/`

**Файлы:**

#### `store.json` — конфигурации прокси
```json
{
  "proxies": [
    {
      "id": "abc123",
      "name": "Proxy Frankfurt",
      "domain": "google.com",
      "port": 12345,
      "containerName": "mtproto-proxy-abc123",
      "status": "running",
      "vpnContainerName": "mtproto-xray-abc123",
      ...
    }
  ],
  "customDomains": ["google.com", "microsoft.com"],
  "blacklistedIps": ["1.2.3.4"]
}
```

**Атомарные записи:** `.tmp` + `rename` (нет corruption при крэше)

#### `stats-history.json` — история метрик
```json
{
  "abc123": [
    {
      "timestamp": "2026-07-06T12:00:00Z",
      "cpuPercent": 5.2,
      "memoryBytes": 12345678,
      "networkRxBytes": 1234567,
      "networkTxBytes": 7654321,
      "connectedCount": 42
    }
  ]
}
```

**Trim:** Макс. 2016 снапшотов на прокси (~7 дней при 5-мин интервале)

#### `ip-history.json` — история IP подключений
```json
{
  "abc123": [
    {
      "ip": "1.2.3.4",
      "country": "Russia",
      "countryCode": "RU",
      "firstSeen": "2026-07-01T10:00:00Z",
      "lastSeen": "2026-07-06T12:30:00Z"
    }
  ]
}
```

**Сброс:** Debounced, записывается каждые 10 секунд (не на каждую строку nginx лога)

### Почему JSON, а не SQL?

Для состояния сервис-ноды JSON предпочтительнее потому что:
1. **Один файл = один источник истины** — легко бэкапить/восстанавливать
2. **Нет зависимости от SQL клиента** — только Node.js модуль fs
3. **Атомарные записи через tmp + rename** — нет corruption при крэше
4. **Легко инспектировать** — `cat data/store.json | jq`
5. **Нет миграций** — схема в TypeScript типах

Для панели PostgreSQL обязателен потому что:
1. **Реляционные данные** — ноды ↔ прокси ↔ метрики
2. **Конкурентный доступ** — несколько пользователей, несколько API вызовов
3. **Агрегации** — GROUP BY, JOIN, time-series запросы
4. **ACID гарантии** — целостность данных уровня финансовых систем

---

## 🌐 Сетевая архитектура

### Порты

| Порт | Сервис | Протокол | Направление |
|---|---|---|---|
| 80 | Панель HTTP | TCP | Входящий (хост панели) |
| 443 | Панель HTTPS | TCP | Входящий (хост панели) |
| 443 | Нода прокси | TCP | Входящий (хост ноды) |
| 3000 | Панель backend | TCP | Внутренний (сеть панели) |
| 5432 | PostgreSQL | TCP | Внутренний (сеть панели) |
| 8443 | Нода API | TCP | Входящий (от панели) |
| 22 | SSH | TCP | Входящий (от панели/админа) |

### Docker сети

**Панель:**
- Default bridge сеть (frontend ↔ backend ↔ db)

**Ноды:**
- External bridge сеть `mtproto-net`
- Соединяет: nginx, прокси контейнеры, xray контейнеры

**Связность контейнеров:**
```
nginx (host network, порт 443) → proxy-1 (mtproto-net) → telegram DC
                                ↓
                                proxy-2 (mtproto-net) → telegram DC
```

**Почему host network для nginx?**
- Слушает на привилегированном порту 443
- Прямой доступ к IP клиентов (для geo-IP и блокировки IP)
- Нет overhead docker-proxy

### TLS/SSL

**Панель:**
- TLS 1.2/1.3 только
- HSTS включён (`Strict-Transport-Security: max-age=31536000; includeSubDomains`)
- Современный cipher suite (ECDHE)
- Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- CORS whitelist через env var `PANEL_FRONTEND_URL` (только известные origins)
- Rate limiting: 200 req/min глобально, 10 SSH / 5 мин, 10 login / 15 мин
- Sanitization error messages — нет утечек IP, путей, stack traces
- Logger auto-redaction для credentials (password, token, privateKey, secret)

**Ноды:**
- fake TLS через nginx `$ssl_preread_server_name`
- Использует домены типа `google.com`, `microsoft.com` для маскировки
- TLS client hello настоящий, но фактического TLS handshake нет (MTProto внутри)

### DNS

**По умолчанию:** `8.8.8.8`, `1.1.1.1` (настроено в docker-compose)

**Для wildcard SSL:**
- `_acme-challenge.example.com` TXT записи (TTL 60с во время challenge)

---

## 🔐 Архитектура безопасности

### Слои аутентификации

1. **JWT (панель API)**
   - Алгоритм: HS256
   - Срок действия: 24 часа
   - Секрет: 64-символьный hex (256-bit)
   - Payload: `{ userId, username }`

2. **Bearer-токен (нода API)**
   - Статический токен, 64-символьный hex (256-bit)
   - Хранится в env переменной `AUTH_TOKEN`
   - Сравнение через `crypto.timingSafeEqual` (constant-time)

3. **SSH (панель → нода)**
   - Пароль ИЛИ приватный ключ (OpenSSH формат)
   - Опциональная passphrase
   - Не сохраняется в панели (передаётся per-request)

### Модель угроз

**Адресуемые угрозы:**

| Угроза | Вектор | Митигация |
|---|---|---|
| **Брутфорс credentials** | `/api/auth/login` | bcrypt (медленный), JWT срок 24ч, нет lockout (рекомендуется fail2ban) |
| **Кража токена** | XSS, MITM | Только HTTPS, localStorage (не cookie), SameSite=Strict |
| **Timing-атака на токен** | Side-channel | `timingSafeEqual` |
| **Username enumeration** | Response timing | Идентичный bcrypt для неизвестных пользователей |
| **SQL инъекция** | API запросы | Параметризованные запросы (pg library) |
| **CSRF** | Браузерные запросы | Bearer-токен (не cookie-based) |
| **MITM на API** | Сеть | TLS 1.2/1.3 принудительный |
| **Container escape** | Скомпрометированный прокси | Docker изоляция, non-root user внутри контейнеров (запланировано) |
| **Fake TLS fingerprinting** | DPI | `tls_emulation: true`, кастомные cipher suites |
| **Брутфорс SSH** | Панель → Нода | rate limit 10/5 мин; SSH credentials не сохраняются (per-request) |
| **Cross-origin атаки** | Сторонние сайты | CORS whitelist через `PANEL_FRONTEND_URL` |
| **Information disclosure через errors** | Error response | `sanitizeErrorMessage()` — нет утечек IP/путей |
| **Credentials в логах** | Logging | `sanitizeMeta()` в logger — авто-редакция password/token |
| **MITM на SSH** | Сеть | SSH протокол (встроенное шифрование) |
| **Replay атака на действия** | API | JWT включает срок действия, ротация токенов |

**Детальный аудит безопасности:** См. [`SECURITY_AUDIT_SSH.md`](SECURITY_AUDIT_SSH.md) — полный аудит SSH credentials (10 проблем, все исправлены).

**Неадресуемые угрозы (вне scope):**
- **Физический доступ к серверам** — если атакующий имеет root, игра окончена
- **Скомпрометированный Docker daemon** — обходит изоляцию контейнеров
- **Скомпрометированное ядро ОС** — обходит всю изоляцию
- **Side-channel атаки** (Spectre, Meltdown) — требуют патчей ядра
- **Telegram-банны** — обрабатываются ME серверами (функция telemt)
- **Юридические/регуляторные** — ответственность пользователя по соблюдению местных законов

### Хранение секретов

| Секрет | Хранение | Шифрование |
|---|---|---|
| Пароль админа | PostgreSQL `users.password_hash` | bcrypt (one-way) |
| JWT_SECRET | Панель `.env` (chmod 600) | Нет (только права FS) |
| DB_PASSWORD | Панель `.env` (chmod 600) | Нет |
| Нода AUTH_TOKEN | Нода `.env` (chmod 600) | Нет |
| SSH credentials | Per-request в HTTP body | HTTPS in transit |
| Cloudflare API токен | PostgreSQL `cloudflare_credentials.api_token_encrypted` | AES-256-GCM (запланировано) |
| SSL приватные ключи | Файловая система (`chmod 600`) | Нет |

**Рекомендуемое усиление для production:**
1. Используйте Vault / AWS Secrets Manager
2. Включите шифрование дисков (LUKS)
3. Используйте SSH ключ auth для всех серверов
4. Запускайте панель за reverse proxy с WAF
5. Рассмотрите HSM для критических секретов

### Сетевая изоляция

**Рекомендация для production:**
- Панель в приватной подсети (например, 10.0.0.0/16)
- Ноды в приватной подсети
- Доступ только через:
  - VPN (WireGuard, NetBird)
  - Bastion host с MFA
- Публичное воздействие:
  - Панель: только через HTTPS (со строгими правилами firewall)
  - Ноды: только порт 443 (прокси трафик)

---

## ⚡ Соображения производительности

### Узкие места

| Слой | Узкое место | Митигация |
|---|---|---|
| Браузер → Панель API | Задержка сети | CDN, gzip, HTTP/2 |
| Панель → Нода API | SSH round-trips | Параллельные SSH вызовы, кеширование |
| Нода → Docker API | Overhead Docker daemon | Пул соединений `dockerode` |
| Нода → Linux команды | SSH overhead | Выполнение параллельно |
| nginx → telemt | Overhead stream proxy | `proxy_timeout`, `proxy_buffering off` |

### Оптимизации

**Backend:**
- Пул соединений (`pg.Pool` max=10)
- Async I/O везде
- Атомарные JSON записи
- Mutex для сериализации (предотвращает race conditions)

**Frontend:**
- `useAsync` с AbortController (отмена при unmount)
- `manualChunks` в Vite (gravity-ui и chart разделены)
- `mergeSignals` (совместимость со старыми браузерами)

**Нода:**
- `top -bn1` (одиночный снапшот, не непрерывный)
- `df -B1 -P` (POSIX формат для консистентного парсинга)
- Кеши в памяти (GeoIP, domain→proxy, store)
- Debounced сброс IP истории (10 сек, не per-event)

### Оценки пропускной способности

**На контейнер прокси:**
- ~1000 соединений (зависит от RAM)
- ~50 MB/s пропускная способность (лимит одного ядра)
- ~10k сообщений/сек (overhead декодирования MTProto)

**На хост ноды:**
- ~100 прокси (4-8 CPU ядер, 8 GB RAM)
- ~5 GB/s суммарная пропускная способность
- ~1M сообщений/сек

**На хост панели:**
- ~1000 нод (с правильной настройкой БД)
- ~10k API запросов/мин
- PostgreSQL узкое место для >10k нод

---

## 📈 Стратегия масштабирования

### Горизонтальное масштабирование (Ноды)

Добавляйте больше сервис-нод по мере необходимости:
- Каждая нода независима (нет общего состояния)
- Панель масштабируется линейно с количеством нод (одно SSH соединение на действие)
- PostgreSQL масштабируется до миллионов нод (один инстанс)

### Вертикальное масштабирование (Один хост)

Увеличивайте ресурсы хоста:
- CPU: 1 ядро на ~50 прокси
- RAM: 256 MB на контейнер прокси + 512 MB система
- Диск: 1 GB на контейнер прокси + 10 GB базовых

### Масштабирование базы данных

Для >10k нод:
- **PostgreSQL read replicas** — разделение чтений (метрики) и записей (конфиги)
- **Партиционирование** — разделение `node_metrics_history` по месяцам
- **Архивирование** — перенос старых метрик в холодное хранилище (S3 + Parquet)

### CDN для панели UI

Для глобального доступа:
- CloudFlare перед (бесплатного тарифа достаточно)
- nginx как origin (с cache-control headers)
- Автоматический HTTPS через CF

### Container Orchestration

Для >100 нод:
- Kubernetes (с Helm chart)
- Каждая нода = Deployment
- Панель = StatefulSet (для БД)
- Auto-scaling на основе метрик

**Ещё не реализовано** — текущий дизайн предполагает docker-compose для простоты.

---

## 🔄 Дорожная карта будущего

### Запланированные функции

- [ ] **Multi-user роли** — admin, operator, viewer (RBAC)
- [ ] **Audit log** — все действия панели логируются в PostgreSQL
- [ ] **Webhooks** — Slack/Telegram уведомления о событиях
- [ ] **Аналитика прокси** — графики трафика по прокси, топ стран
- [ ] **UI бэкапа/восстановления** — автоматические бэкапы в S3
- [ ] **Multi-tenancy** — несколько изолированных панелей на одном хосте
- [ ] **High availability** — панель failover (active-passive)
- [ ] **gRPC API** — альтернатива REST для сервис-нод

### На рассмотрении

- **Prometheus exporter** — метрики для Grafana
- **OpenTelemetry tracing** — распределённая трассировка
- **HashiCorp Vault интеграция** — управление секретами
- **OPA (Open Policy Agent)** — декларативное применение политик
