# Configuration Guide

Complete reference for all environment variables, configuration files, and tuning options.

[🇷🇺 Русская версия](CONFIGURATION.ru.md)

## 📋 Table of Contents

- [Environment Variables](#-environment-variables)
- [`.env` File Structure](#-env-file-structure)
- [Panel Backend Config](#-panel-backend-config)
- [Service Node Config](#-service-node-config)
- [Telemt Proxy Options](#-telemt-proxy-options)
- [Nginx Tuning](#-nginx-tuning)
- [SSL/TLS Configuration](#-ssltls-configuration)
- [GeoIP Configuration](#-geoip-configuration)
- [Logging](#-logging)
- [Performance Tuning](#-performance-tuning)

---

## 🔧 Environment Variables

### Panel Backend

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Backend port (internal, not exposed) |
| `JWT_SECRET` | **Yes** | — | Secret for JWT tokens (≥ 32 chars recommended) |
| `NODE_ENV` | No | `production` | `production` or `development` |
| `DB_HOST` | No | `localhost` | PostgreSQL host |
| `DB_PORT` | No | `5432` | PostgreSQL port |
| `DB_NAME` | No | `mtproto_panel` | Database name |
| `DB_USER` | No | `mtproto` | Database user |
| `DB_PASSWORD` | **Yes** | — | Database password (≥ 16 chars) |
| `ADMIN_USERNAME` | **Yes** | — | Initial admin username (3-64 chars) |
| `ADMIN_PASSWORD` | **Yes** | — | Initial admin password (≥ 8 chars) |
| `NODE_REQUEST_TIMEOUT_MS` | No | `30000` | Timeout for node API requests (ms) |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, `error` |
| `PANEL_FRONTEND_URL` | No | `http://localhost:5173,http://localhost:80` | Comma-separated CORS whitelist of allowed frontend origins |

### Service Node

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8443` | Node API port |
| `NGINX_PORT` | No | `443` | Proxy traffic port (nginx listen) |
| `AUTH_TOKEN` | **Yes** | — | Bearer token for panel access (≥ 16 chars) |
| `DATA_DIR` | No | `/app/data` | Persistent data directory |
| `NAT_IP` | No | `""` | Public IP of VPN exit node (for hybrid mode) |
| `TUNNEL_INTERFACE` | No | `""` | TUN/TAP interface name (e.g., `tun0`) |
| `GEO_API_URL` | No | `http://ip-api.com/batch` | GeoIP lookup service |
| `GEO_CACHE_TTL_MS` | No | `3600000` | GeoIP cache TTL (1 hour) |
| `STATS_INTERVAL_MS` | No | `300000` | Background stats collection (5 min) |
| `IP_HISTORY_FLUSH_MS` | No | `10000` | IP history flush interval |
| `INITIAL_STATS_DELAY_MS` | No | `30000` | Delay before first stats collection |
| `DOMAIN_CACHE_TTL_MS` | No | `30000` | Domain→proxy cache TTL |
| `LOG_LEVEL` | No | `info` | Log verbosity |

### SSL (Panel)

Set via `install.sh --ssl-*` flags, or manually:

| Variable | Default | Description |
|---|---|---|
| `SSL_OUTPUT_DIR` | `/opt/mtproto-suite/ssl/wildcard` | Where wildcard certs are saved |

SSL certificates are stored as PEM files:
- `<domain_with_underscores>.cert.pem` — certificate
- `<domain_with_underscores>.key.pem` — private key (mode 0600)

---

## 📝 `.env` File Structure

### Panel: `panel-backend/.env`

```bash
# HTTP
PORT=3000

# JWT
JWT_SECRET=<64-char-hex-string>     # openssl rand -hex 32
JWT_EXPIRES_IN=86400                # 24 hours (hardcoded)

# PostgreSQL
DB_HOST=db
DB_PORT=5432
DB_NAME=mtproto_panel
DB_USER=mtproto
DB_PASSWORD=<32-char-hex-string>    # openssl rand -hex 16

# Admin
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<plain-text-password>

# Timeouts
NODE_REQUEST_TIMEOUT_MS=30000

# Environment
NODE_ENV=production

# Logging
LOG_LEVEL=info

# Security: CORS whitelist (comma-separated)
# Only these origins can make requests to the panel API
PANEL_FRONTEND_URL=https://panel.example.com,https://www.panel.example.com
```

### Node: `service-node/.env`

```bash
# API
PORT=8443
AUTH_TOKEN=<64-char-hex-string>     # openssl rand -hex 32

# Proxy
NGINX_PORT=443

# VPN (optional)
NAT_IP=                              # Public IP of VPN exit node
TUNNEL_INTERFACE=                    # tun0 if using TUN/TAP

# Data
DATA_DIR=/app/data

# Performance
GEO_CACHE_TTL_MS=3600000
STATS_INTERVAL_MS=300000
IP_HISTORY_FLUSH_MS=10000

# Logging
LOG_LEVEL=info
```

### Root: `.env` (for `--mode=both`)

Combines both panel and node variables (see [INSTALLATION.md](INSTALLATION.md)).

---

## 🖥️ Panel Backend Config

### JWT Settings

```typescript
// panel-backend/src/config/index.ts
jwtSecret: requireEnv('JWT_SECRET'),  // No default — fails if missing
jwtExpiresIn: 24 * 60 * 60,           // 24 hours in seconds
```

### PostgreSQL Pool

```typescript
{
  max: 10,                           // Max connections
  idleTimeoutMillis: 30000,           // Close idle after 30s
  connectionTimeoutMillis: 5000,      // Connection timeout
}
```

To tune for high load, edit `panel-backend/src/db/index.ts`:

```typescript
export const pool = new Pool({
  ...config.db,
  max: 50,                           // Increase for high concurrency
  statement_timeout: 30000,          // Query timeout (ms)
});
```

---

## ⚙️ Service Node Config

### Port Range

Default range for auto-assigned proxy ports: `10001-19999`.

To change, edit `service-node/src/config/index.ts`:
```typescript
portRangeStart: 10001,
portRangeEnd: 19999,
```

### Docker Network

```typescript
dockerNetwork: 'mtproto-net',        // Shared network for all containers
```

### Container Naming

| Prefix | Example | Purpose |
|---|---|---|
| `mtproto-proxy-` | `mtproto-proxy-abc123` | Per-proxy containers |
| `mtproto-xray-` | `mtproto-xray-abc123` | VPN client containers |
| `mtproto-nginx` | `mtproto-nginx` | SNI router (single) |
| `telemt-proxy-v4` | (image name) | Built image |

To change, edit `service-node/src/config/index.ts` and `shared/types/constants.ts`.

---

## 🎛️ Telemt Proxy Options

Each proxy can be configured with 30+ options. Set via panel UI or API.

### Connection Mode

| Option | Default | Description |
|---|---|---|
| `useMiddleProxy` | `true` | Use ME servers for obfuscation |
| `fastMode` | `true` | Aggressive connection optimization |
| `me2dcFallback` | `true` | Fallback from ME to direct DC |
| `me2dcFast` | `true` | Fast ME→DC transition |

### Keepalive

| Option | Default | Description |
|---|---|---|
| `meKeepaliveEnabled` | `true` | Send keepalive pings |
| `meKeepaliveIntervalSecs` | `5` | Ping interval |
| `meKeepaliveJitterSecs` | `1` | Random jitter |
| `meKeepalivePayloadRandom` | `true` | Randomize payload |

### Reconnection

| Option | Default | Description |
|---|---|---|
| `meReconnectBackoffBaseMs` | `200` | Initial backoff |
| `meReconnectBackoffCapMs` | `1000` | Max backoff |
| `meReconnectFastRetryCount` | `12` | Fast retries before backoff |
| `meInitRetryAttempts` | `5` | Init retries |

### Warmup (gradual scale-up)

| Option | Default | Description |
|---|---|---|
| `meWarmupStaggerEnabled` | `true` | Stagger connections |
| `meWarmupStepDelayMs` | `30` | Delay between steps |
| `meWarmupStepJitterMs` | `5` | Random jitter |

### Censorship Resistance

| Option | Default | Description |
|---|---|---|
| `censorshipTlsDomain` | `<proxy domain>` | SNI domain for TLS |
| `censorshipTlsEmulation` | `true` | Emulate TLS client hello |
| `censorshipTlsFrontDir` | `""` | TLS fronting directory |
| `desyncAllFull` | `true` | Full desync mode |

### Network

| Option | Default | Description |
|---|---|---|
| `networkPrefer` | `"system"` | `system` or `dual-stack` |
| `stunServers` | `["stun.l.google.com:19302"]` | STUN servers for NAT traversal |
| `serverClientMss` | `1360` | Client MSS |
| `updateEvery` | `30` | Config reload interval (sec) |

### Observability

| Option | Default | Description |
|---|---|---|
| `beobachten` | `true` | Enable observation logs |
| `beobachtenMinutes` | `15` | Observation window |
| `beobachtenFlushSecs` | `5` | Flush interval |
| `beobachtenFile` | `/tmp/telemt-beobachten.json` | Output file |
| `logLevel` | `"silent"` | telemt log level |
| `unknownDcFileLogEnabled` | `true` | Log unknown DCs |

### Anti-Flood

| Option | Default | Description |
|---|---|---|
| `tgConnect` | `10` | Max concurrent connections to Telegram |
| `upstreamConnectRetryAttempts` | `5` | Retry on upstream failure |
| `upstreamConnectRetryBackoffMs` | `500` | Backoff between retries |
| `rstOnClose` | `"off"` | Send RST on close |

---

## 🌐 Nginx Tuning

### Worker Processes

Default: `auto` (one per CPU core). Edit `nginx.conf`:
```
worker_processes auto;
worker_connections 4096;
```

### Proxy Timeouts

Default in `nginx.ts`:
```
proxy_connect_timeout 10s;
proxy_timeout 300s;
```

To change, edit `service-node/src/services/nginx.ts`:
```typescript
proxy_connect_timeout 10s;   // Increase for slow connections
proxy_timeout 300s;         // Max 5 min idle
```

### Limit_conn

Per-proxy connection limits via `maxConnections` option:
```
limit_conn <zone> <count>;
```

### IP Blacklist

Set via panel UI (`Blacklist IPs` section) — applied as `deny <ip>;` directives.

### Domain Pool

50+ default domains in `shared/types/constants.ts`. To add custom:

1. Set via panel: **"Domains"** → enter list → Save
2. Or edit constants and rebuild

---

## 🔒 SSL/TLS Configuration

### Panel HTTPS

Three modes (set during install):

**HTTP** (default, dev only):
```
listen 80;
```

**Self-signed:**
```
ssl_certificate /etc/nginx/ssl/cert.pem;
ssl_certificate_key /etc/nginx/ssl/key.pem;
```

**Let's Encrypt:**
```
ssl_certificate /etc/letsencrypt/live/<domain>/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/<domain>/privkey.pem;
```

### Wildcard Certificates

Stored in `/opt/mtproto-suite/ssl/wildcard/`:

```
example_com.cert.pem    # Full chain
example_com.key.pem     # Private key (mode 0600)
```

For Nginx to use:
```
ssl_certificate /opt/mtproto-suite/ssl/wildcard/example_com.cert.pem;
ssl_certificate_key /opt/mtproto-suite/ssl/wildcard/example_com.key.pem;
```

### TLS Settings

`nginx-ssl.conf` uses modern TLS:
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

## 🌍 GeoIP Configuration

Default: `http://ip-api.com/batch` (free, 45 req/min limit).

To use a different service, set:
```
GEO_API_URL=https://your-geoip-service.com/batch
```

Expected response format (ip-api.com):
```json
[
  {"query": "1.2.3.4", "country": "Russia", "countryCode": "RU"},
  {"query": "5.6.7.8", "country": "Germany", "countryCode": "DE"}
]
```

If your service uses different field names, edit `service-node/src/services/nginx.ts`:
```typescript
result.set(entry.query, {
  country: entry.country ?? entry.country_name,
  countryCode: entry.countryCode ?? entry.country_code,
});
```

### Cache Tuning

```
GEO_CACHE_TTL_MS=3600000    # 1 hour
```

For higher accuracy (less cache), decrease to `1800000` (30 min).
For less API calls (more cache), increase to `86400000` (24 hours).

---

## 📋 Logging

### Structured Logs (JSON)

Both panel and node output JSON logs to stdout/stderr:

```json
{"level":"info","time":"2026-07-06T12:34:56Z","category":"proxy","message":"Container started","proxyId":"abc123"}
```

### Log Levels

| Level | When to use |
|---|---|
| `debug` | Development, troubleshooting |
| `info` | Production (default) |
| `warn` | Production with extra visibility |
| `error` | Only errors |

Set per-service:
- Panel: `LOG_LEVEL` in `panel-backend/.env`
- Node: `LOG_LEVEL` in `service-node/.env`

### Docker Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend

# Last 100 lines
docker compose logs --tail=100 backend

# Since timestamp
docker compose logs --since="2026-07-06T12:00:00"
```

### Log Rotation

Docker handles rotation via `log-driver: json-file` with size limits:
```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

This keeps 3 files × 10 MB = 30 MB max per container.

---

## ⚡ Performance Tuning

### High-Load Panels (>1000 proxies)

1. **PostgreSQL tuning:**
   ```yaml
   # docker-compose.yml
   db:
     image: postgres:16-alpine
     command: postgres -c shared_buffers=256MB -c max_connections=200
   ```

2. **Panel backend:**
   ```typescript
   // db/index.ts
   max: 50,                          // More connections
   statement_timeout: 60000,         // 60s for complex queries
   ```

3. **Frontend polling:**
   - Increase refresh interval (30s instead of 5s)
   - Disable auto-refresh on slow connections

### High-Throughput Nodes (>100 connections/proxy)

1. **Increase file descriptors:**
   ```yaml
   # docker-compose.yml
   service-node:
     ulimits:
       nofile:
         soft: 65536
         hard: 65536
   ```

2. **Tune nginx:**
   ```
   worker_processes auto;
   worker_connections 8192;
   worker_rlimit_nofile 65536;
   ```

3. **Telemt keepalive tuning:**
   ```
   meKeepaliveIntervalSecs: 3    # More aggressive
   ```

### Network Optimization

```bash
# Enable TCP BBR congestion control (Linux kernel 4.9+)
echo "net.core.default_qdisc=fq" >> /etc/sysctl.conf
echo "net.ipv4.tcp_congestion_control=bbr" >> /etc/sysctl.conf
sysctl -p

# Increase socket buffers
echo "net.core.rmem_max=16777216" >> /etc/sysctl.conf
echo "net.core.wmem_max=16777216" >> /etc/sysctl.conf
sysctl -p
```

---

## 📂 Config File Locations

| File | Purpose |
|---|---|
| `/opt/mtproto-suite/.env` | Root config (both mode) |
| `/opt/mtproto-suite/panel-backend/.env` | Panel backend config |
| `/opt/mtproto-suite/service-node/.env` | Service node config |
| `/opt/mtproto-suite/service-node/data/store.json` | Proxy configs (JSON) |
| `/opt/mtproto-suite/service-node/data/stats-history.json` | Metrics history |
| `/opt/mtproto-suite/service-node/data/ip-history.json` | IP history |
| `/opt/mtproto-suite/ssl/wildcard/*.pem` | Wildcard SSL certificates |
| `/etc/letsencrypt/live/<domain>/` | Let's Encrypt certificates |

---

## 🔄 Configuration Reload

Most configs require restart:

```bash
# Panel
cd /opt/mtproto-suite
docker compose restart backend

# Node
cd /opt/mtproto-suite/service-node
docker compose restart
```

**No restart needed:**
- GeoIP cache (auto-refreshes on TTL)
- Domain→proxy cache (30 sec TTL)
- Statistics collection (5 min interval)
