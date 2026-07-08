# Руководство по конфигурации

Полный справочник по всем переменным окружения, конфигурационным файлам и параметрам тюнинга.

[🇬🇧 English version](CONFIGURATION.md)

## 📋 Содержание

- [Переменные окружения](#-переменные-окружения)
- [Структура файла `.env`](#-структура-файла-env)
- [Конфигурация Panel Backend](#-конфигурация-panel-backend)
- [Конфигурация Service Node](#-конфигурация-service-node)
- [Опции Telemt Proxy](#-опции-telemt-proxy)
- [Тюнинг Nginx](#-тюнинг-nginx)
- [Конфигурация SSL/TLS](#-конфигурация-ssltls)
- [Конфигурация GeoIP](#-конфигурация-geoip)
- [Логирование](#-логирование)
- [Тюнинг производительности](#-тюнинг-производительности)

---

## 🔧 Переменные окружения

### Panel Backend

| Переменная | Обязательная | По умолчанию | Описание |
|---|---|---|---|
| `PORT` | Нет | `3000` | Порт backend (внутренний, не публичный) |
| `JWT_SECRET` | **Да** | — | Секрет для JWT токенов (≥ 32 символов рекомендуется) |
| `NODE_ENV` | Нет | `production` | `production` или `development` |
| `DB_HOST` | Нет | `localhost` | Хост PostgreSQL |
| `DB_PORT` | Нет | `5432` | Порт PostgreSQL |
| `DB_NAME` | Нет | `mtproto_panel` | Имя базы данных |
| `DB_USER` | Нет | `mtproto` | Пользователь БД |
| `DB_PASSWORD` | **Да** | — | Пароль БД (≥ 16 символов) |
| `ADMIN_USERNAME` | **Да** | — | Начальный логин админа (3-64 символа) |
| `ADMIN_PASSWORD` | **Да** | — | Начальный пароль админа (≥ 8 символов) |
| `NODE_REQUEST_TIMEOUT_MS` | Нет | `30000` | Таймаут для запросов к нодам (мс) |
| `LOG_LEVEL` | Нет | `info` | `debug`, `info`, `warn`, `error` |
| `PANEL_FRONTEND_URL` | Нет | `http://localhost:5173,http://localhost:80` | CORS whitelist разрешённых origins (через запятую) |

### Service Node

| Переменная | Обязательная | По умолчанию | Описание |
|---|---|---|---|
| `PORT` | Нет | `8443` | Порт API ноды |
| `NGINX_PORT` | Нет | `443` | Порт прокси трафика (nginx listen) |
| `AUTH_TOKEN` | **Да** | — | Bearer токен для доступа панели (≥ 16 символов) |
| `DATA_DIR` | Нет | `/app/data` | Директория для постоянных данных |
| `NAT_IP` | Нет | `""` | Публичный IP VPN exit-ноды (для hybrid режима) |
| `TUNNEL_INTERFACE` | Нет | `""` | Имя TUN/TAP интерфейса (например, `tun0`) |
| `GEO_API_URL` | Нет | `http://ip-api.com/batch` | Сервис GeoIP lookup |
| `GEO_CACHE_TTL_MS` | Нет | `3600000` | TTL кеша GeoIP (1 час) |
| `STATS_INTERVAL_MS` | Нет | `300000` | Интервал фонового сбора статистики (5 мин) |
| `IP_HISTORY_FLUSH_MS` | Нет | `10000` | Интервал сброса IP истории |
| `INITIAL_STATS_DELAY_MS` | Нет | `30000` | Задержка перед первым сбором статистики |
| `DOMAIN_CACHE_TTL_MS` | Нет | `30000` | TTL кеша domain→proxy |
| `LOG_LEVEL` | Нет | `info` | Уровень логирования |

### SSL (Панель)

Устанавливается через флаги `install.sh --ssl-*`, или вручную:

| Переменная | По умолчанию | Описание |
|---|---|---|
| `SSL_OUTPUT_DIR` | `/opt/mtproto-suite/ssl/wildcard` | Куда сохранять wildcard сертификаты |

SSL сертификаты хранятся как PEM файлы:
- `<домен_с_подчёркиваниями>.cert.pem` — сертификат
- `<домен_с_подчёркиваниями>.key.pem` — приватный ключ (mode 0600)

---

## 📝 Структура файла `.env`

### Панель: `panel-backend/.env`

```bash
# HTTP
PORT=3000

# JWT
JWT_SECRET=<64-char-hex-string>     # openssl rand -hex 32
JWT_EXPIRES_IN=86400                # 24 часа (захардкожено)

# PostgreSQL
DB_HOST=db
DB_PORT=5432
DB_NAME=mtproto_panel
DB_USER=mtproto
DB_PASSWORD=<32-char-hex-string>    # openssl rand -hex 16

# Админ
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<plain-text-password>

# Таймауты
NODE_REQUEST_TIMEOUT_MS=30000

# Окружение
NODE_ENV=production

# Логирование
LOG_LEVEL=info

# Безопасность: CORS whitelist (через запятую)
# Только эти origins могут делать запросы к panel API
PANEL_FRONTEND_URL=https://panel.example.com,https://www.panel.example.com
```

### Нода: `service-node/.env`

```bash
# API
PORT=8443
AUTH_TOKEN=<64-char-hex-string>     # openssl rand -hex 32

# Прокси
NGINX_PORT=443

# VPN (опционально)
NAT_IP=                              # Публичный IP VPN exit-ноды
TUNNEL_INTERFACE=                    # tun0 если используется TUN/TAP

# Данные
DATA_DIR=/app/data

# Производительность
GEO_CACHE_TTL_MS=3600000
STATS_INTERVAL_MS=300000
IP_HISTORY_FLUSH_MS=10000

# Логирование
LOG_LEVEL=info
```

### Корень: `.env` (для `--mode=both`)

Объединяет переменные панели и ноды (см. [INSTALLATION.md](INSTALLATION.ru.md)).

---

## 🖥️ Конфигурация Panel Backend

### Настройки JWT

```typescript
// panel-backend/src/config/index.ts
jwtSecret: requireEnv('JWT_SECRET'),  // Без дефолта — падает если не задан
jwtExpiresIn: 24 * 60 * 60,           // 24 часа в секундах
```

### PostgreSQL Pool

```typescript
{
  max: 10,                           // Макс. соединений
  idleTimeoutMillis: 30000,           // Закрывать idle через 30с
  connectionTimeoutMillis: 5000,      // Таймаут соединения
}
```

Для тюнинга под высокую нагрузку, отредактируйте `panel-backend/src/db/index.ts`:

```typescript
export const pool = new Pool({
  ...config.db,
  max: 50,                           // Увеличить для высокой параллельности
  statement_timeout: 30000,          // Таймаут запроса (мс)
});
```

---

## ⚙️ Конфигурация Service Node

### Диапазон портов

Диапазон по умолчанию для авто-назначения портов прокси: `10001-19999`.

Для изменения отредактируйте `service-node/src/config/index.ts`:
```typescript
portRangeStart: 10001,
portRangeEnd: 19999,
```

### Docker сеть

```typescript
dockerNetwork: 'mtproto-net',        // Общая сеть для всех контейнеров
```

### Имена контейнеров

| Префикс | Пример | Назначение |
|---|---|---|
| `mtproto-proxy-` | `mtproto-proxy-abc123` | Контейнеры прокси |
| `mtproto-xray-` | `mtproto-xray-abc123` | Контейнеры VPN клиента |
| `mtproto-nginx` | `mtproto-nginx` | SNI роутер (один) |
| `telemt-proxy-v4` | (имя образа) | Собранный образ |

Для изменения отредактируйте `service-node/src/config/index.ts` и `shared/types/constants.ts`.

---

## 🎛️ Опции Telemt Proxy

Каждый прокси можно настроить с 30+ опциями. Устанавливается через UI панели или API.

### Режим соединения

| Опция | По умолчанию | Описание |
|---|---|---|
| `useMiddleProxy` | `true` | Использовать ME серверы для обфускации |
| `fastMode` | `true` | Агрессивная оптимизация соединения |
| `me2dcFallback` | `true` | Fallback с ME на прямой DC |
| `me2dcFast` | `true` | Быстрый переход ME→DC |

### Keepalive

| Опция | По умолчанию | Описание |
|---|---|---|
| `meKeepaliveEnabled` | `true` | Отправлять keepalive пинги |
| `meKeepaliveIntervalSecs` | `5` | Интервал пинга |
| `meKeepaliveJitterSecs` | `1` | Случайный jitter |
| `meKeepalivePayloadRandom` | `true` | Рандомизировать payload |

### Переподключение

| Опция | По умолчанию | Описание |
|---|---|---|
| `meReconnectBackoffBaseMs` | `200` | Начальный backoff |
| `meReconnectBackoffCapMs` | `1000` | Макс. backoff |
| `meReconnectFastRetryCount` | `12` | Быстрые повторы перед backoff |
| `meInitRetryAttempts` | `5` | Повторы инициализации |

### Warmup (постепенный scale-up)

| Опция | По умолчанию | Описание |
|---|---|---|
| `meWarmupStaggerEnabled` | `true` | Распределять соединения |
| `meWarmupStepDelayMs` | `30` | Задержка между шагами |
| `meWarmupStepJitterMs` | `5` | Случайный jitter |

### Устойчивость к цензуре

| Опция | По умолчанию | Описание |
|---|---|---|
| `censorshipTlsDomain` | `<домен прокси>` | SNI домен для TLS |
| `censorshipTlsEmulation` | `true` | Эмулировать TLS client hello |
| `censorshipTlsFrontDir` | `""` | Директория TLS fronting |
| `desyncAllFull` | `true` | Полный режим desync |

### Сеть

| Опция | По умолчанию | Описание |
|---|---|---|
| `networkPrefer` | `"system"` | `system` или `dual-stack` |
| `stunServers` | `["stun.l.google.com:19302"]` | STUN серверы для NAT traversal |
| `serverClientMss` | `1360` | Client MSS |
| `updateEvery` | `30` | Интервал перезагрузки конфига (сек) |

### Наблюдаемость

| Опция | По умолчанию | Описание |
|---|---|---|
| `beobachten` | `true` | Включить observation логи |
| `beobachtenMinutes` | `15` | Окно observation |
| `beobachtenFlushSecs` | `5` | Интервал сброса |
| `beobachtenFile` | `/tmp/telemt-beobachten.json` | Файл вывода |
| `logLevel` | `"silent"` | Уровень лога telemt |
| `unknownDcFileLogEnabled` | `true` | Логировать неизвестные DC |

### Антифлуд

| Опция | По умолчанию | Описание |
|---|---|---|
| `tgConnect` | `10` | Макс. одновременных соединений к Telegram |
| `upstreamConnectRetryAttempts` | `5` | Повторы при сбое upstream |
| `upstreamConnectRetryBackoffMs` | `500` | Backoff между повторами |
| `rstOnClose` | `"off"` | Отправлять RST при закрытии |

---

## 🌐 Тюнинг Nginx

### Worker процессы

По умолчанию: `auto` (один на ядро CPU). Отредактируйте `nginx.conf`:
```
worker_processes auto;
worker_connections 4096;
```

### Таймауты прокси

По умолчанию в `nginx.ts`:
```
proxy_connect_timeout 10s;
proxy_timeout 300s;
```

Для изменения отредактируйте `service-node/src/services/nginx.ts`:
```typescript
proxy_connect_timeout 10s;   // Увеличить для медленных соединений
proxy_timeout 300s;         // Макс. 5 мин idle
```

### Limit_conn

Лимиты соединений на прокси через опцию `maxConnections`:
```
limit_conn <zone> <count>;
```

### IP Blacklist

Устанавливается через UI панели (секция `Blacklist IPs`) — применяется как директивы `deny <ip>;`.

### Пул доменов

50+ доменов по умолчанию в `shared/types/constants.ts`. Для добавления кастомных:

1. Установить через панель: **"Domains"** → ввести список → Сохранить
2. Или отредактировать константы и пересобрать

---

## 🔒 Конфигурация SSL/TLS

### HTTPS панели

Три режима (устанавливается при install):

**HTTP** (по умолчанию, только для dev):
```
listen 80;
```

**Самоподписанный:**
```
ssl_certificate /etc/nginx/ssl/cert.pem;
ssl_certificate_key /etc/nginx/ssl/key.pem;
```

**Let's Encrypt:**
```
ssl_certificate /etc/letsencrypt/live/<домен>/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/<домен>/privkey.pem;
```

### Wildcard сертификаты

Хранятся в `/opt/mtproto-suite/ssl/wildcard/`:

```
example_com.cert.pem    # Полная цепочка
example_com.key.pem     # Приватный ключ (mode 0600)
```

Для использования в nginx:
```
ssl_certificate /opt/mtproto-suite/ssl/wildcard/example_com.cert.pem;
ssl_certificate_key /opt/mtproto-suite/ssl/wildcard/example_com.key.pem;
```

### TLS настройки

`nginx-ssl.conf` использует современный TLS:
```
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:...;
ssl_prefer_server_ciphers off;
```

Security headers:
```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
```

---

## 🌍 Конфигурация GeoIP

По умолчанию: `http://ip-api.com/batch` (бесплатно, лимит 45 запросов/мин).

Для использования другого сервиса установите:
```
GEO_API_URL=https://your-geoip-service.com/batch
```

Ожидаемый формат ответа (ip-api.com):
```json
[
  {"query": "1.2.3.4", "country": "Russia", "countryCode": "RU"},
  {"query": "5.6.7.8", "country": "Germany", "countryCode": "DE"}
]
```

Если ваш сервис использует другие имена полей, отредактируйте `service-node/src/services/nginx.ts`:
```typescript
result.set(entry.query, {
  country: entry.country ?? entry.country_name,
  countryCode: entry.countryCode ?? entry.country_code,
});
```

### Тюнинг кеша

```
GEO_CACHE_TTL_MS=3600000    # 1 час
```

Для большей точности (меньше кеша) уменьшите до `1800000` (30 мин).
Для меньшего количества API вызовов (больше кеша) увеличьте до `86400000` (24 часа).

---

## 📋 Логирование

### Структурированные логи (JSON)

И панель и нода выводят JSON логи в stdout/stderr:

```json
{"level":"info","time":"2026-07-06T12:34:56Z","category":"proxy","message":"Container started","proxyId":"abc123"}
```

### Уровни логирования

| Уровень | Когда использовать |
|---|---|
| `debug` | Разработка, troubleshooting |
| `info` | Production (по умолчанию) |
| `warn` | Production с дополнительной видимостью |
| `error` | Только ошибки |

Устанавливается per-service:
- Панель: `LOG_LEVEL` в `panel-backend/.env`
- Нода: `LOG_LEVEL` в `service-node/.env`

### Docker логи

```bash
# Все сервисы
docker compose logs -f

# Конкретный сервис
docker compose logs -f backend

# Последние 100 строк
docker compose logs --tail=100 backend

# С определённого времени
docker compose logs --since="2026-07-06T12:00:00"
```

### Ротация логов

Docker обрабатывает ротацию через `log-driver: json-file` с ограничениями размера:
```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

Это хранит 3 файла × 10 MB = 30 MB максимум на контейнер.

---

## ⚡ Тюнинг производительности

### Панели с высокой нагрузкой (>1000 прокси)

1. **Тюнинг PostgreSQL:**
   ```yaml
   # docker-compose.yml
   db:
     image: postgres:16-alpine
     command: postgres -c shared_buffers=256MB -c max_connections=200
   ```

2. **Panel backend:**
   ```typescript
   // db/index.ts
   max: 50,                          // Больше соединений
   statement_timeout: 60000,         // 60с для сложных запросов
   ```

3. **Frontend polling:**
   - Увеличить интервал обновления (30с вместо 5с)
   - Отключить автообновление на медленных соединениях

### Ноды с высокой пропускной способностью (>100 соединений/прокси)

1. **Увеличить file descriptors:**
   ```yaml
   # docker-compose.yml
   service-node:
     ulimits:
       nofile:
         soft: 65536
         hard: 65536
   ```

2. **Тюнинг nginx:**
   ```
   worker_processes auto;
   worker_connections 8192;
   worker_rlimit_nofile 65536;
   ```

3. **Telemt keepalive тюнинг:**
   ```
   meKeepaliveIntervalSecs: 3    # Более агрессивно
   ```

### Сетевая оптимизация

```bash
# Включить TCP BBR congestion control (Linux kernel 4.9+)
echo "net.core.default_qdisc=fq" >> /etc/sysctl.conf
echo "net.ipv4.tcp_congestion_control=bbr" >> /etc/sysctl.conf
sysctl -p

# Увеличить буферы сокетов
echo "net.core.rmem_max=16777216" >> /etc/sysctl.conf
echo "net.core.wmem_max=16777216" >> /etc/sysctl.conf
sysctl -p
```

---

## 📂 Расположение конфигурационных файлов

| Файл | Назначение |
|---|---|
| `/opt/mtproto-suite/.env` | Корневая конфигурация (режим both) |
| `/opt/mtproto-suite/panel-backend/.env` | Конфигурация панели |
| `/opt/mtproto-suite/service-node/.env` | Конфигурация ноды |
| `/opt/mtproto-suite/service-node/data/store.json` | Конфигурации прокси (JSON) |
| `/opt/mtproto-suite/service-node/data/stats-history.json` | История метрик |
| `/opt/mtproto-suite/service-node/data/ip-history.json` | История IP |
| `/opt/mtproto-suite/ssl/wildcard/*.pem` | Wildcard SSL сертификаты |
| `/etc/letsencrypt/live/<домен>/` | Let's Encrypt сертификаты |

---

## 🔄 Перезагрузка конфигурации

Большинство конфигов требуют перезапуска:

```bash
# Панель
cd /opt/mtproto-suite
docker compose restart backend

# Нода
cd /opt/mtproto-suite/service-node
docker compose restart
```

**Не требуют перезапуска:**
- GeoIP кеш (авто-обновление по TTL)
- Domain→proxy кеш (30 сек TTL)
- Сбор статистики (5 мин интервал)
