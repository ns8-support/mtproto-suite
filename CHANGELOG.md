# Changelog

Все заметные изменения документированы здесь. Формат основан на [Keep a Changelog](https://keepachangelog.com/), версионирование — [Semantic Versioning](https://semver.org/).

---

## [2.0.0] — 2026-07-06

### 🎉 Major Release: Unified MTProto Suite

Объединение `danielVNru/mtproto-panel` и `danielVNru/mtproto-node` в единый проект с общими типами, единым docker-compose, унифицированным установщиком и новыми функциями.

### 🆕 Новые возможности

#### Unified Installer

- Единый интерактивный `install.sh` с тремя режимами: `--mode=panel|node|both`
- Поддержка SSL через Let's Encrypt (`--ssl-letsencrypt`) или самоподписанный (`--ssl-self`)
- Установка всех зависимостей (Docker, Docker Compose, git, curl, openssl)
- Валидация всех параметров
- Non-interactive режим с `--yes`

#### Real-Time Monitoring

- CPU usage (с cores, load avg, model)
- RAM usage (total/used/free, swap)
- Disk usage (для каждой точки монтирования)
- Docker container stats (CPU%, memory, network)
- System info (OS, kernel, hostname, IP, uptime)
- История метрик в PostgreSQL (последние 1000 точек на ноду)
- Графики истории (1h / 6h / 24h / 7d)
- Авто-обновление метрик (5s / 10s / 30s / 1m / off)

#### Remote Installation

- Установка service-node на удалённом сервере через SSH
- Поддержка SSH password и private key
- Pipeline из 8 шагов с прогрессом
- Автоматическое определение публичного IP
- Health check после установки
- Генерация криптостойкого AUTH_TOKEN (32 байта)
- Кнопка "+ Добавить как ноду в панель"

#### Remote Actions

- Restart service-node через `docker compose restart`
- Reboot server через `sudo reboot` (с двойным подтверждением)
- Health check после restart
- Полный лог операций

#### Wildcard SSL

- Получение `*.example.com` от Let's Encrypt через DNS-01 challenge
- Cloudflare API integration для создания TXT записей
- RSA 2048 ключ для ACME аккаунта
- ACME v2 protocol с `acme-client` v5
- Wildcard CSR через `node-forge`
- Автоочистка TXT записей после challenge
- Production и Staging серверы Let's Encrypt
- UI wizard для пошагового получения

#### NetBird Mesh VPN

- Установка NetBird клиента на ноды
- Автоматическое определение ОС и архитектуры
- Подключение через setup key (SaaS или self-hosted)
- Self-hosted management URL поддержка
- Статус: connected, mesh IP, peer name, список peers
- Кеширование статуса в PostgreSQL
- Refresh и uninstall через UI

### 🔒 Безопасность

#### Критические исправления

| ID | Описание | Исправление |
|---|---|---|
| VULN-001 | JWT_SECRET дефолт `'change-me-in-production'` в коде | Удалён дефолт, требует env var |
| VULN-002 | Пустой AUTH_TOKEN разрешал доступ | Валидация min 16 chars |
| VULN-003 | Token сравнение через XOR-цикл | Заменено на `crypto.timingSafeEqual` |
| VULN-004 | Username enumeration через response timing | Identical bcrypt для unknown users |
| VULN-005 | Нет валидации IP/port/token на роутах | Добавлена strict regex validation |
| VULN-006 | Нет port CHECK constraint в PostgreSQL | `CHECK (port > 0 AND port <= 65535)` |
| VULN-007 | SSH credentials не валидировались | Валидация host, port, user, auth method |

#### Аудит SSH Credentials (см. [docs/SECURITY_AUDIT_SSH.md](docs/SECURITY_AUDIT_SSH.md))

| ID | Severity | Описание | Исправление |
|---|---|---|---|
| AUDIT-001 | High | Error messages утечка internal IPs, paths, stack traces | `sanitizeErrorMessage()` маппит в безопасные тексты |
| AUDIT-002 | High | Default `cors()` разрешал все origins | Whitelist через `PANEL_FRONTEND_URL` env var |
| AUDIT-003 | High | Нет rate limiting на SSH endpoints | `express-rate-limit` 10 req/5min на SSH endpoints |
| AUDIT-004 | Medium | Нет security headers (HSTS, X-Frame-Options, etc.) | HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy |
| AUDIT-005 | Medium | Logger мог логировать credentials в meta | `sanitizeMeta()` рекурсивно редактирует password/token/privateKey |
| AUDIT-006 | Medium | `err.code` (ECONNREFUSED etc.) утекал в response | Удалён из response, остаётся в server logs |
| AUDIT-007 | Verified safe | Все SSH команды захардкожены | Подтверждено — нет command injection vector |
| AUDIT-008 | Verified safe | React не хранит credentials в localStorage | Подтверждено — только useState |
| AUDIT-009 | Verified safe | Logger calls используют host+username, не password | Подтверждено grep'ом по всему коду |
| AUDIT-010 | Verified safe | SSH соединения закрываются через try/finally | Подтверждено |

#### Дополнительно

- bcrypt cost 12 для admin password (сохранено)
- Secrets в `.env` файлах с `chmod 600`
- TLS 1.2/1.3 рекомендован, HSTS включён
- Strict-Transport-Security header
- X-Frame-Options, X-Content-Type-Options
- AES-256-GCM шифрование для Cloudflare токенов (planned)

### ⚡ Производительность

#### Service Node

- **Store I/O**: sync `writeFileSync` → async `writeFile` + atomic rename
- **In-memory cache**: write-through с mutex для сериализации
- **IP history**: debounced flush раз в 10 секунд (вместо каждой строки nginx log)
- **HTTP bootstrap**: стартует мгновенно, тяжёлая инициализация в фоне
- **Metrics collection**: 4 SSH команды параллельно через `Promise.all`

#### Panel Backend

- **PostgreSQL pool**: `max=10`, `idleTimeoutMillis=30000`
- **`Promise.allSettled`** в `/api/proxies/all` (мёртвая нода не ломает ответ)
- **fetchWithTimeout** для всех запросов к нодам (нет 60-сек зависаний)
- **Structured JSON logger** с уровнями

#### Frontend

- **Unified `useAsync` hook** — устранил 4 копии дублированной логики
- **AbortController** в API клиенте — отмена при unmount
- **Vite manualChunks** — gravity-ui и chart.js в отдельных chunks
- **Canvas-based MetricsChart** — без зависимости от chart.js для простых графиков

### 🛡️ Надёжность

- **Graceful shutdown** для обоих сервисов (SIGTERM/SIGINT)
- **Atomic JSON write** через `.tmp + rename`
- **HEALTHCHECK** в каждом Dockerfile
- **Retry nginx start** (3 попытки при конфликте портов)
- **OOM защита** в nginx log watcher (1 МБ лимит)
- **Cleanup on error** (rollback контейнеров)
- **`.env` preservation** при `update.sh`
- **Connection timeouts** на всех external API calls

### 🏗️ Архитектура

#### Shared Package (`@mtproto-suite/shared`)

Общие типы и утилиты для всех 4 пакетов:

- `types/proxy.ts` — ProxyConfig, ProxyStats, TelemtOptions, DEFAULT_TELEMT_OPTIONS, TELEMT_OPTION_KEYS
- `types/vless.ts` — VlessConfig
- `types/monitoring.ts` — NodeMetrics, ContainerStats, SystemInfo, NetBirdStatus
- `types/api.ts` — API контракты между panel и node
- `types/constants.ts` — TELEGRAM_DC_RANGES, FAKE_TLS_DOMAINS, container prefixes
- `utils/tar.ts` — createTarBuffer (используется в 3 местах)
- `utils/fetch.ts` — fetchWithTimeout, safeJson, mergeSignals
- `utils/logger.ts` — structured JSON logger

#### Composite tsconfig

- `shared/**/*` включается в build panel-backend и service-node
- `paths` mapping для `@mtproto-suite/shared/*`

#### Docker

- **Multi-stage builds** для всех Dockerfile (frontend, backend, service-node)
- **`docker-compose.yml`** — Panel stack
- **`docker-compose.ssl.yml`** — Overlay для HTTPS
- **`docker-compose.both.yml`** — Panel + Node на одной машине (для теста)
- **`service-node/docker-compose.yml`** — Standalone node

### 🐛 Исправленные баги

- `store.json` corruption при крэше → atomic write
- Race condition при `updateProxy` → mutex serialization
- Домен в `tg://proxy` link → использует `proxy.listenPort || config.nginxPort`
- VLESS без raw-ссылки → поддержка `vless://` URI напрямую
- IPv6 в VLESS → корректный парсинг `[::1]:443`
- gRPC serviceName → правильно парсится
- xhttp extra/mode → сохраняются в конфиг
- Geo API для IP из nginx logs → in-memory кеш (1 час TTL)
- Длинные chunks в Docker log stream → OOM защита
- updater не перезаписывает `.env` → сохранение пользовательских секретов

### 🧪 API Changes

#### Новые endpoints

- `POST /api/remote-install/test-ssh`
- `POST /api/remote-install/node`
- `POST /api/nodes/:id/metrics`
- `GET /api/nodes/:id/metrics/history`
- `POST /api/nodes/:id/system-info`
- `POST /api/nodes/:id/docker-stats`
- `POST /api/nodes/:id/restart-service`
- `POST /api/nodes/:id/reboot`
- `POST /api/nodes/:id/netbird/status`
- `POST /api/nodes/:id/netbird/install`
- `POST /api/nodes/:id/netbird/uninstall`
- `GET /api/nodes/:id/netbird/cached-status`
- `POST /api/ssl/cloudflare/test`
- `POST /api/ssl/wildcard/obtain`
- `GET /api/ssl/wildcard/status`
- `POST /api/ssl/wildcard/renew`
- `GET /api/ssl/zones`

#### Изменения формата

- Error responses: `{ message }` → `{ error }` (standardized)

### 📦 Migration

См. [docs/MIGRATION.md](docs/MIGRATION.md) для миграции с оригинальных репозиториев.

---

## [1.3.2] — 2026-06-19 (Original Repo)

Latest release of `danielVNru/mtproto-panel` и `danielVNru/mtproto-node` до объединения.

### Features

- Multi-node management
- VLESS/Reality VPN integration
- Multi-port proxies
- Statistics history
- IP geolocation
- Live IP tracking
- Self-update

### Known Issues

- JWT_SECRET hardcoded default (fixed in 2.0.0)
- No metrics history persistence (fixed in 2.0.0)
- No remote install (added in 2.0.0)
- No NetBird support (added in 2.0.0)
- No wildcard SSL automation (added in 2.0.0)
- Race condition in store (fixed in 2.0.0)

---

## Pre-1.0

See git history of [danielVNru/mtproto-panel](https://github.com/danielVNru/mtproto-panel) and [danielVNru/mtproto-node](https://github.com/danielVNru/mtproto-node) for pre-1.0 history.

---

## Version Support Policy

| Version | Status | Security Updates Until |
|---|---|---|
| 2.x | Active | TBD |
| 1.x | End-of-life | 2026-12-31 |
| < 1.0 | End-of-life | — |

[2.0.0]: #200--2026-07-06
[1.3.2]: https://github.com/danielVNru/mtproto-panel/releases/tag/v1.3.2
