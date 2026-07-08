# Справочник по API

Полная документация REST API для MTProto Suite.

[🇬🇧 English version](API.md)

## 📋 Содержание

- [Аутентификация](#-аутентификация)
- [CORS](#-cors)
- [API панели](#-api-панели)
- [API сервис-ноды](#-api-сервис-ноды)
- [Обработка ошибок](#-обработка-ошибок)
- [Ограничение скорости](#-ограничение-скорости)
- [Примеры](#-примеры)

---

## 🔐 Аутентификация

### API панели

**Метод:** Bearer токен (JWT)

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Получить токен:**
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "secret"
}
```

**Ответ:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 1, "username": "admin" }
}
```

**Срок действия токена:** 24 часа (настраивается в `panel-backend/src/config/index.ts`)

### API сервис-ноды

**Метод:** Bearer токен (статический)

```http
Authorization: Bearer a1b2c3d4e5f6...
```

**Получить токен:** Из вывода `install.sh --mode=node` или в `service-node/.env`

**Длина токена:** 64 hex символа (256 бит)

### Health endpoints (без авторизации)

Оба API экспонируют `/api/health` без аутентификации для liveness probes:

```http
GET /api/health
```

```json
{
  "status": "ok",
  "timestamp": "2026-07-06T12:00:00.000Z",
  "version": "2.0.0"
}
```

---

## 🌐 CORS

С версии 2.0.0, panel API использует CORS whitelist через переменную окружения `PANEL_FRONTEND_URL`:

```bash
# В .env файле
PANEL_FRONTEND_URL=https://panel.example.com,https://www.panel.example.com
```

**Поведение:**
- Запросы с разрешённых origins проходят нормально
- Запросы с запрещённых origins блокируются с ошибкой `CORS: origin not allowed`
- Server-to-server запросы (без `Origin` header, например из curl) разрешены
- Заблокированные запросы логируются через `logger.warn('cors', ...)`

**По умолчанию (для разработки):**
```
PANEL_FRONTEND_URL=http://localhost:5173,http://localhost:80
```

**Production:** Всегда устанавливайте `PANEL_FRONTEND_URL` в HTTPS домен(ы) вашей панели.

---

## 🖥️ API панели

Базовый URL: `http://хост-панели:80/api`

### Endpoints аутентификации

#### `POST /api/auth/login`

Аутентификация и получение JWT токена.

**Запрос:**
```json
{
  "username": "admin",
  "password": "secret"
}
```

**Ответ 200:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 1, "username": "admin" }
}
```

**Ответ 401:**
```json
{ "error": "Invalid credentials" }
```

#### `GET /api/auth/me`

Получить информацию о текущем пользователе.

**Headers:** `Authorization: Bearer <token>`

**Ответ 200:**
```json
{
  "user": { "userId": 1, "username": "admin" }
}
```

### Endpoints нод

#### `GET /api/nodes`

Список всех зарегистрированных сервис-нод.

**Ответ 200:**
```json
[
  {
    "id": 1,
    "name": "Frankfurt #1",
    "ip": "proxy1.example.com",
    "port": 8443,
    "domain": "",
    "created_at": "2026-07-06T10:00:00.000Z"
  }
]
```

#### `POST /api/nodes/check-health`

Проверка связности перед добавлением ноды.

**Запрос:**
```json
{
  "ip": "1.2.3.4",
  "port": 8443,
  "token": "a1b2c3d4..."
}
```

**Ответ 200:**
```json
{ "online": true }
```

#### `POST /api/nodes`

Добавить новую сервис-ногу.

**Запрос:**
```json
{
  "name": "Frankfurt #1",
  "ip": "1.2.3.4",
  "port": 8443,
  "token": "a1b2c3d4...",
  "domain": "proxy1.example.com"
}
```

**Ответ 201:**
```json
{
  "id": 1,
  "name": "Frankfurt #1",
  "ip": "1.2.3.4",
  "port": 8443,
  "domain": "proxy1.example.com",
  "created_at": "2026-07-06T10:00:00.000Z"
}
```

**Ответ 400:**
```json
{ "error": "ip, port (1-65535), and token (min 16 chars) are required" }
```

#### `GET /api/nodes/:id`

Получить детали ноды.

#### `PUT /api/nodes/:id`

Обновить ноду (частичное обновление).

**Запрос (любое подмножество полей):**
```json
{
  "name": "Frankfurt #2",
  "ip": "1.2.3.4",
  "port": 8443,
  "token": "new-token...",
  "domain": "new.example.com"
}
```

#### `DELETE /api/nodes/:id`

Удалить ноду из панели.

**Ответ 200:**
```json
{ "success": true }
```

#### `GET /api/nodes/:id/health`

Проверить живое здоровье ноды.

**Ответ 200:**
```json
{ "online": true, "version": "2.0.0" }
```

#### `POST /api/nodes/:id/update`

Триггернуть `update.sh` на ноде.

**Ответ 200:**
```json
{ "success": true, "output": "Already up to date." }
```

#### `GET /api/nodes/:id/domains`

Получить кастомные домены с ноды.

#### `PUT /api/nodes/:id/domains`

Обновить кастомные домены на ноде.

#### `GET /api/nodes/:id/blacklist`

Получить IP blacklist с ноды.

#### `PUT /api/nodes/:id/blacklist`

Обновить IP blacklist на ноде.

#### `GET /api/nodes/:id/export`

Экспортировать все прокси с ноды (возвращает JSON файл).

#### `POST /api/nodes/:id/import`

Импортировать прокси на ноду.

### Endpoints прокси

#### `GET /api/nodes/:nodeId/proxies`

Список всех прокси на ноде.

**Ответ 200:**
```json
[
  {
    "id": "abc123",
    "name": "Proxy Frankfurt",
    "note": "",
    "port": 12345,
    "secret": "abcdef...",
    "domain": "google.com",
    "containerName": "mtproto-proxy-abc123",
    "status": "running",
    "vpnContainerName": null,
    "nginxPort": 443,
    "createdAt": "2026-07-06T10:00:00.000Z",
    "trafficUp": 12345,
    "trafficDown": 67890,
    "connectedIps": ["1.2.3.4", "5.6.7.8"]
  }
]
```

#### `POST /api/nodes/:nodeId/proxies`

Создать новое прокси.

**Запрос (упрощённый):**
```json
{
  "name": "Proxy Frankfurt",
  "domain": "google.com",
  "maxConnections": 100
}
```

**Запрос (со всеми опциями):**
```json
{
  "name": "Proxy Frankfurt",
  "domain": "google.com",
  "maxConnections": 100,
  "vpnSubscription": "vless://uuid@host:port?security=reality&...",
  "natIp": "1.2.3.4",
  "useMiddleProxy": true,
  "fastMode": true,
  "meKeepaliveIntervalSecs": 5,
  "tgConnect": 10,
  "logLevel": "info"
}
```

#### `GET /api/nodes/:nodeId/proxies/:proxyId`

Получить детали прокси.

#### `PUT /api/nodes/:nodeId/proxies/:proxyId`

Обновить прокси (частичное обновление).

#### `DELETE /api/nodes/:nodeId/proxies/:proxyId`

Удалить прокси.

#### `POST /api/nodes/:nodeId/proxies/:proxyId/restart`

Перезапустить контейнер прокси.

#### `POST /api/nodes/:nodeId/proxies/:proxyId/pause`

Приостановить прокси (Docker pause).

#### `POST /api/nodes/:nodeId/proxies/:proxyId/unpause`

Возобновить прокси.

#### `GET /api/nodes/:nodeId/proxies/:proxyId/stats`

Получить текущую статистику прокси.

**Ответ 200:**
```json
{
  "id": "abc123",
  "containerName": "mtproto-proxy-abc123",
  "status": "running",
  "cpuPercent": "5.20%",
  "memoryUsage": "12.5 MB",
  "memoryLimit": "1 GB",
  "networkRx": "1.5 MB",
  "networkTx": "2.3 MB",
  "networkRxBytes": 1500000,
  "networkTxBytes": 2300000,
  "uptime": "2h 15m",
  "connectedIps": [
    { "ip": "1.2.3.4", "country": "Russia", "countryCode": "RU" }
  ]
}
```

#### `GET /api/nodes/:nodeId/proxies/:proxyId/link`

Получить `tg://proxy?...` ссылку.

**Query:** `?server_ip=1.2.3.4`

**Ответ 200:**
```json
{
  "link": "tg://proxy?server=1.2.3.4&port=443&secret=eeabc..."
}
```

#### `GET /api/nodes/:nodeId/proxies/:proxyId/stats-history`

Получить историческую статистику (7 дней).

#### `GET /api/nodes/:nodeId/proxies/:proxyId/ip-history`

Получить историю IP подключений.

#### `DELETE /api/nodes/:nodeId/proxies/:proxyId/clear-history`

Очистить статистику + IP историю для прокси.

### Агрегированные endpoints прокси

#### `GET /api/proxies/all`

Получить прокси со ВСЕХ нод (параллельно).

**Ответ 200:**
```json
[
  {
    "nodeId": 1,
    "nodeName": "Frankfurt #1",
    "nodeIp": "1.2.3.4",
    "online": true,
    "proxies": [...]
  },
  {
    "nodeId": 2,
    "nodeName": "Frankfurt #2",
    "online": false,
    "proxies": []
  }
]
```

**Примечание:** Использует `Promise.allSettled` — офлайн ноды не ломают ответ.

### Endpoints мониторинга

Все monitoring endpoints требуют SSH credentials в теле запроса.

#### `POST /api/nodes/:id/metrics`

Собрать все метрики (CPU, RAM, Disk, Docker).

**Запрос:**
```json
{
  "ssh": {
    "host": "1.2.3.4",
    "port": 22,
    "username": "root",
    "password": "secret"
  }
}
```

**Ответ 200:**
```json
{
  "nodeId": 1,
  "cpu": {
    "usagePercent": 5.2,
    "cores": 4,
    "loadAvg1": 0.15,
    "loadAvg5": 0.10,
    "loadAvg15": 0.05,
    "model": "Intel(R) Xeon(R) CPU @ 2.40GHz"
  },
  "memory": {
    "totalBytes": 8589934592,
    "usedBytes": 2147483648,
    "freeBytes": 6442450944,
    "usagePercent": 25.0,
    "swapTotalBytes": 0,
    "swapUsedBytes": 0
  },
  "disks": [
    {
      "mountPoint": "/",
      "totalBytes": 107374182400,
      "usedBytes": 21474836480,
      "freeBytes": 85899345920,
      "usagePercent": 20.0,
      "filesystem": "/dev/sda1"
    }
  ],
  "containers": [
    {
      "name": "mtproto-nginx",
      "image": "nginx:latest",
      "status": "Up 2 hours",
      "cpuPercent": 1.2,
      "memoryBytes": 52428800,
      "memoryLimit": 0,
      "networkRxBytes": 1500000,
      "networkTxBytes": 2300000,
      "created": "2026-07-06T10:00:00.000Z"
    }
  ],
  "collectedAt": "2026-07-06T12:00:00.000Z",
  "history": [...]
}
```

#### `GET /api/nodes/:id/metrics/history`

Получить историю метрик из БД (без SSH).

**Query:** `?range=1h|6h|24h|7d` (по умолчанию: `1h`)

**Ответ 200:** Массив `MetricsHistoryPoint`

#### `POST /api/nodes/:id/system-info`

Получить информацию об ОС/оборудовании.

**Ответ 200:**
```json
{
  "hostname": "proxy1",
  "os": "ubuntu",
  "osVersion": "24.04",
  "kernel": "6.5.0-91-generic",
  "arch": "x86_64",
  "uptimeSeconds": 86400,
  "currentTime": "2026-07-06T12:00:00.000Z",
  "ipAddresses": ["1.2.3.4", "10.0.0.5"]
}
```

#### `POST /api/nodes/:id/docker-stats`

Расширенная статистика Docker.

#### `POST /api/nodes/:id/restart-service`

Перезапустить service-node через `docker compose restart`.

#### `POST /api/nodes/:id/reboot`

Перезагрузить сервер через `sudo reboot`.

**Запрос:**
```json
{
  "ssh": { ... },
  "confirm": true      // ОБЯЗАТЕЛЬНО
}
```

### Endpoints NetBird

#### `POST /api/nodes/:id/netbird/status`

Получить статус NetBird с ноды.

#### `POST /api/nodes/:id/netbird/install`

Установить NetBird на ноде.

**Запрос:**
```json
{
  "ssh": { ... },
  "setupKey": "NETBIRD-SETUP-KEY-XXXXX",
  "managementUrl": "https://netbird.example.com",
  "hostname": "proxy1"
}
```

#### `POST /api/nodes/:id/netbird/uninstall`

Удалить NetBird с ноды.

#### `GET /api/nodes/:id/netbird/cached-status`

Получить последний сохранённый статус NetBird из БД (без SSH).

### Endpoints удалённой установки

#### `POST /api/remote-install/test-ssh`

Тест SSH связности с хостом.

#### `POST /api/remote-install/node`

Установить service-node на удалённом хосте.

**Запрос:**
```json
{
  "ssh": { ... },
  "nodePort": 8443,
  "nginxPort": 443,
  "natIp": ""
}
```

**Ответ 200:**
```json
{
  "success": true,
  "serverIp": "1.2.3.4",
  "port": 8443,
  "authToken": "a1b2c3d4...",
  "log": "[1] ...\n[2] ..."
}
```

### Endpoints SSL

#### `POST /api/ssl/cloudflare/test`

Тест Cloudflare API токена.

**Запрос:**
```json
{ "apiToken": "..." }
```

**Ответ 200:**
```json
{ "success": true, "zoneCount": 3 }
```

#### `POST /api/ssl/wildcard/obtain`

Получить wildcard Let's Encrypt сертификат.

**Запрос:**
```json
{
  "wildcardDomain": "*.example.com",
  "rootDomain": "example.com",
  "email": "admin@example.com",
  "staging": false,
  "cloudflare": { "apiToken": "..." }
}
```

**Ответ 200:**
```json
{
  "success": true,
  "certificatePath": "/opt/mtproto-suite/ssl/wildcard/example_com.cert.pem",
  "privateKeyPath": "/opt/mtproto-suite/ssl/wildcard/example_com.key.pem",
  "certInfo": {
    "domain": "example.com",
    "issuer": "C=US, O=Let's Encrypt, CN=R10",
    "validFrom": "2026-07-06T12:00:00.000Z",
    "validTo": "2026-10-04T12:00:00.000Z",
    "serialNumber": "..."
  }
}
```

#### `GET /api/ssl/wildcard/status`

Список всех wildcard сертификатов.

#### `POST /api/ssl/wildcard/renew`

Принудительное обновление сертификата.

#### `GET /api/ssl/zones?apiToken=...`

Список Cloudflare zones для токена.

### Endpoints системы

#### `GET /api/system/version`

Получить версию панели.

**Ответ 200:**
```json
{ "version": "2.0.0" }
```

#### `POST /api/system/update`

Триггернуть self-update панели.

---

## 🖧 API сервис-ноды

Базовый URL: `http://хост-ноды:8443/api`

**Все endpoints требуют:** `Authorization: Bearer <AUTH_TOKEN>`

### Endpoints прокси

#### `GET /api/proxies`

Список всех прокси.

#### `POST /api/proxies`

Создать прокси. Body: `ProxyCreateRequest`

#### `GET /api/proxies/:id`

Получить детали прокси.

#### `PUT /api/proxies/:id`

Обновить прокси. Body: `ProxyUpdateRequest`

#### `DELETE /api/proxies/:id`

Удалить прокси.

#### `POST /api/proxies/:id/restart`

Перезапустить контейнер.

#### `POST /api/proxies/:id/pause`

Приостановить контейнер.

#### `POST /api/proxies/:id/unpause`

Возобновить контейнер.

#### `GET /api/proxies/:id/stats`

Получить статистику контейнера.

#### `GET /api/proxies/:id/link?server_ip=X`

Получить `tg://proxy?...` ссылку.

#### `GET /api/proxies/:id/stats-history`

Получить историческую статистику.

#### `GET /api/proxies/:id/ip-history`

Получить историю IP подключений.

#### `DELETE /api/proxies/:id/clear-history`

Очистить статистику + IP историю.

### Endpoints доменов

#### `GET /api/domains`

Получить кастомные домены (или дефолтный пул).

#### `PUT /api/domains`

Установить кастомные домены. Body: `{ domains: string[] }`

### Endpoints blacklist

#### `GET /api/blacklist`

Получить IP blacklist.

#### `PUT /api/blacklist`

Установить IP blacklist. Body: `{ ips: string[] }`

### Экспорт/Импорт

#### `GET /api/export`

Скачать все прокси как JSON.

#### `POST /api/import`

Импортировать прокси из JSON. Body: `ExportBundle`

### Endpoints системы

#### `POST /api/update`

Триггернуть self-update (запускает `update.sh`).

**Ответ:**
```json
{ "success": true, "output": "Already up to date." }
```

---

## ❌ Обработка ошибок

Все ошибки следуют единому формату:

```json
{ "error": "Человеко-читаемое сообщение об ошибке" }
```

### HTTP коды состояния

| Код | Значение | Когда |
|---|---|---|
| 200 | OK | Нормальный ответ |
| 201 | Created | Ресурс создан успешно |
| 204 | No content | Успех без тела |
| 400 | Bad request | Валидация не прошла, отсутствуют обязательные поля |
| 401 | Unauthorized | Невалидный/отсутствующий токен |
| 403 | Forbidden | Валидный токен, но недостаточно прав |
| 404 | Not found | Ресурс не существует |
| 409 | Conflict | Дубликат (например, порт занят) |
| 429 | Too many requests | Превышен лимит запросов (применяется с v2.0.0) |
| 500 | Server error | Неожиданная ошибка, проверьте логи |
| 502 | Bad gateway | Нода недоступна из панели |
| 503 | Service unavailable | Режим обслуживания (в будущем) |

### Примеры ошибок

```json
// 400 Bad request
{ "error": "ip, port (1-65535), and token (min 16 chars) are required" }

// 401 Unauthorized
{ "error": "Invalid or expired token" }

// 403 Forbidden (невалидный токен на ноде)
{ "error": "Invalid token" }

// 404 Not found
{ "error": "Proxy not found" }

// 409 Conflict
{ "error": "Port 12345 is already in use" }

// 502 Bad gateway (панель → нода)
{ "error": "Failed to connect to node: connect ECONNREFUSED" }

// 500 Server error
{ "error": "Internal server error" }
```

---

## 🚦 Ограничение скорости

Применяется через middleware `express-rate-limit`:

**API панели:**
| Лимитер | Область | Лимит |
|---|---|---|
| `globalLimiter` | Все endpoints | 200 req/min на IP |
| `loginLimiter` | `/api/auth/login` | 10 попыток за 15 мин на IP |
| `sshLimiter` | `/api/remote-install/*` и `/api/nodes/:id/*` (SSH-related) | 10 req за 5 мин на IP |

**API ноды:**
- Rate limiting через `express-rate-limit` — 1000 req/min на token (только панель)
- Рекомендуется для production

**Поведение:**
- Превышение → HTTP 429 с `{ "error": "Too many requests" }`
- Стандартные заголовки `RateLimit-*` (RFC 6585)
- Per-IP (не per-user) — см. Future Work в [SECURITY_AUDIT_SSH.md](SECURITY_AUDIT_SSH.md)

---

## 📝 Примеры

### Полный workflow (curl)

```bash
# 1. Войти в панель
TOKEN=$(curl -fsS -X POST http://panel/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"secret"}' | jq -r .token)

# 2. Список нод
curl -fsS http://panel/api/nodes \
  -H "Authorization: Bearer $TOKEN" | jq .

# 3. Добавить новую ноду
curl -fsS -X POST http://panel/api/nodes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Proxy 1","ip":"1.2.3.4","port":8443,"token":"node-token"}'

# 4. Получить все прокси
curl -fsS http://panel/api/proxies/all \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | .proxies | length'

# 5. Создать прокси
curl -fsS -X POST http://panel/api/nodes/1/proxies \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Proxy","domain":"google.com","maxConnections":50}'

# 6. Получить ссылку прокси
PROXY_ID="abc123"
SERVER_IP="1.2.3.4"
curl -fsS "http://panel/api/nodes/1/proxies/$PROXY_ID/link?server_ip=$SERVER_IP" \
  -H "Authorization: Bearer $TOKEN" | jq -r .link

# 7. Получить метрики (требуется SSH)
curl -fsS -X POST http://panel/api/nodes/1/metrics \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ssh":{"host":"1.2.3.4","port":22,"username":"root","password":"ssh-pass"}}' \
  | jq '{cpu: .cpu.usagePercent, mem: .memory.usagePercent, disk: .disks[0].usagePercent}'

# 8. Перезапустить сервис
curl -fsS -X POST http://panel/api/nodes/1/restart-service \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ssh":{"host":"1.2.3.4","port":22,"username":"root","password":"ssh-pass"}}' \
  | jq .success

# 9. Logout (клиентская сторона: удалить JWT из localStorage)
```

### JavaScript клиент

```javascript
const PANEL_URL = 'http://panel.example.com';
let token = null;

async function apiCall(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${PANEL_URL}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json();
}

// Войти
const { token: t } = await apiCall('POST', '/auth/login', {
  username: 'admin',
  password: 'secret',
});
token = t;

// Использовать API
const nodes = await apiCall('GET', '/nodes');
console.log(nodes);
```

---

## 🔄 Версионирование

API следует **semantic versioning**:
- Major версия (1.x → 2.x): Критические изменения
- Minor версия (1.0 → 1.1): Новые функции, обратно совместимые
- Patch версия (1.0.0 → 1.0.1): Исправления багов

Текущая: **v2.0.0**

Критические изменения с v1.x:
- Новый `/api/nodes/:id/metrics` endpoint (заменяет старый `/api/stats`)
- Новые wildcard SSL endpoints
- Новые NetBird endpoints
- Новые monitoring endpoints

Гайд по миграции: см. [MIGRATION.md](MIGRATION.ru.md)
