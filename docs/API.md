# API Reference

Complete REST API documentation for MTProto Suite.

[🇷🇺 Русская версия](API.ru.md)

## 📋 Table of Contents

- [Authentication](#-authentication)
- [CORS](#-cors)
- [Panel API](#-panel-api)
- [Service Node API](#-service-node-api)
- [Error Handling](#-error-handling)
- [Rate Limiting](#-rate-limiting)
- [Examples](#-examples)

---

## 🔐 Authentication

### Panel API

**Method:** Bearer token (JWT)

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Obtain token:**
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "secret"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 1, "username": "admin" }
}
```

**Token expiry:** 24 hours (configurable in `panel-backend/src/config/index.ts`)

### Service Node API

**Method:** Bearer token (static)

```http
Authorization: Bearer a1b2c3d4e5f6...
```

**Obtain token:** From `install.sh --mode=node` output, or in `service-node/.env`

**Token length:** 64 hex characters (256 bits)

### Health Endpoints (No Auth)

Both APIs expose `/api/health` without authentication for liveness probes:

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

## 🌐 CORS

Since v2.0.0, the panel API uses a CORS whitelist via the `PANEL_FRONTEND_URL` environment variable:

```bash
# In .env file
PANEL_FRONTEND_URL=https://panel.example.com,https://www.panel.example.com
```

**Behavior:**
- Requests from allowed origins succeed normally
- Requests from disallowed origins are blocked with `CORS: origin not allowed` error
- Server-to-server requests (no `Origin` header, e.g., from curl) are allowed
- Blocked requests are logged via `logger.warn('cors', ...)`

**Default (development):**
```
PANEL_FRONTEND_URL=http://localhost:5173,http://localhost:80
```

**Production:** Always set `PANEL_FRONTEND_URL` to your panel's HTTPS domain(s).

---

## 🖥️ Panel API

Base URL: `http://panel-host:80/api`

### Auth Endpoints

#### `POST /api/auth/login`

Authenticate and obtain JWT token.

**Request:**
```json
{
  "username": "admin",
  "password": "secret"
}
```

**Response 200:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 1, "username": "admin" }
}
```

**Response 401:**
```json
{ "error": "Invalid credentials" }
```

#### `GET /api/auth/me`

Get current user info.

**Headers:** `Authorization: Bearer <token>`

**Response 200:**
```json
{
  "user": { "userId": 1, "username": "admin" }
}
```

### Node Endpoints

#### `GET /api/nodes`

List all registered service-nodes.

**Response 200:**
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

Check connectivity before adding a node.

**Request:**
```json
{
  "ip": "1.2.3.4",
  "port": 8443,
  "token": "a1b2c3d4..."
}
```

**Response 200:**
```json
{ "online": true }
```

#### `POST /api/nodes`

Add a new service-node.

**Request:**
```json
{
  "name": "Frankfurt #1",
  "ip": "1.2.3.4",
  "port": 8443,
  "token": "a1b2c3d4...",
  "domain": "proxy1.example.com"
}
```

**Response 201:**
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

**Response 400:**
```json
{ "error": "ip, port (1-65535), and token (min 16 chars) are required" }
```

#### `GET /api/nodes/:id`

Get node details.

**Response 200:**
```json
{
  "id": 1,
  "name": "Frankfurt #1",
  "ip": "1.2.3.4",
  "port": 8443,
  "token": "a1b2c3d4...",
  "domain": "proxy1.example.com",
  "created_at": "2026-07-06T10:00:00.000Z"
}
```

#### `PUT /api/nodes/:id`

Update node (partial update).

**Request (any subset of fields):**
```json
{
  "name": "Frankfurt #2",
  "ip": "1.2.3.4",
  "port": 8443,
  "token": "new-token...",
  "domain": "new.example.com"
}
```

**Response 200:** Updated node

#### `DELETE /api/nodes/:id`

Remove node from panel.

**Response 200:**
```json
{ "success": true }
```

#### `GET /api/nodes/:id/health`

Check live health of node.

**Response 200:**
```json
{ "online": true, "version": "2.0.0" }
```

#### `POST /api/nodes/:id/update`

Trigger `update.sh` on the node.

**Response 200:**
```json
{ "success": true, "output": "Already up to date." }
```

#### `GET /api/nodes/:id/domains`

Get custom domains from node.

**Response 200:**
```json
{ "domains": ["google.com", "microsoft.com"] }
```

#### `PUT /api/nodes/:id/domains`

Update custom domains on node.

**Request:**
```json
{ "domains": ["google.com", "microsoft.com"] }
```

#### `GET /api/nodes/:id/blacklist`

Get IP blacklist from node.

**Response 200:**
```json
{ "ips": ["1.2.3.4", "5.6.7.8"] }
```

#### `PUT /api/nodes/:id/blacklist`

Update IP blacklist on node.

**Request:**
```json
{ "ips": ["1.2.3.4", "5.6.7.8"] }
```

#### `GET /api/nodes/:id/export`

Export all proxies from node (returns JSON file).

**Response 200:** `Content-Type: application/json` with `Content-Disposition: attachment`

```json
{
  "version": 1,
  "exportedAt": "2026-07-06T12:00:00.000Z",
  "proxies": [...]
}
```

#### `POST /api/nodes/:id/import`

Import proxies to node.

**Request:** Same format as export.

**Response 200:**
```json
{ "imported": 10, "errors": ["proxy-1: port already in use"] }
```

### Proxy Endpoints

#### `GET /api/nodes/:nodeId/proxies`

List all proxies on a node.

**Response 200:**
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

Create new proxy.

**Request (simplified):**
```json
{
  "name": "Proxy Frankfurt",
  "domain": "google.com",
  "maxConnections": 100
}
```

**Request (with all options):**
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

**Response 201:** Created proxy object

#### `GET /api/nodes/:nodeId/proxies/:proxyId`

Get proxy details.

#### `PUT /api/nodes/:nodeId/proxies/:proxyId`

Update proxy (partial update).

**Request:** Any subset of proxy fields.

#### `DELETE /api/nodes/:nodeId/proxies/:proxyId`

Delete proxy.

#### `POST /api/nodes/:nodeId/proxies/:proxyId/restart`

Restart proxy container.

#### `POST /api/nodes/:nodeId/proxies/:proxyId/pause`

Pause proxy (Docker pause).

#### `POST /api/nodes/:nodeId/proxies/:proxyId/unpause`

Unpause proxy.

#### `GET /api/nodes/:nodeId/proxies/:proxyId/stats`

Get current stats for proxy.

**Response 200:**
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

Get `tg://proxy?...` link.

**Query:** `?server_ip=1.2.3.4`

**Response 200:**
```json
{
  "link": "tg://proxy?server=1.2.3.4&port=443&secret=eeabc..."
}
```

#### `GET /api/nodes/:nodeId/proxies/:proxyId/stats-history`

Get historical stats (7-day rolling).

**Response 200:**
```json
[
  {
    "timestamp": "2026-07-06T10:00:00.000Z",
    "cpuPercent": 5.2,
    "memoryBytes": 13107200,
    "networkRxBytes": 1500000,
    "networkTxBytes": 2300000,
    "connectedCount": 42
  }
]
```

#### `GET /api/nodes/:nodeId/proxies/:proxyId/ip-history`

Get IP connection history.

**Response 200:**
```json
[
  {
    "ip": "1.2.3.4",
    "country": "Russia",
    "countryCode": "RU",
    "firstSeen": "2026-07-01T10:00:00.000Z",
    "lastSeen": "2026-07-06T12:00:00.000Z"
  }
]
```

#### `DELETE /api/nodes/:nodeId/proxies/:proxyId/clear-history`

Clear stats + IP history for proxy.

### Aggregated Proxy Endpoints

#### `GET /api/proxies/all`

Get proxies from ALL nodes (parallel).

**Response 200:**
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

**Note:** Uses `Promise.allSettled` — offline nodes don't break the response.

### Monitoring Endpoints

All monitoring endpoints require SSH credentials in body.

#### `POST /api/nodes/:id/metrics`

Collect all metrics (CPU, RAM, Disk, Docker).

**Request:**
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

**Response 200:**
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

Get metrics history from DB (no SSH needed).

**Query:** `?range=1h|6h|24h|7d` (default: `1h`)

**Response 200:** Array of `MetricsHistoryPoint`

#### `POST /api/nodes/:id/system-info`

Get OS/hardware info.

**Request:** Same SSH credentials as metrics.

**Response 200:**
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

Extended Docker statistics.

**Response 200:**
```json
{
  "stats": [...],          // ContainerStats array (like metrics.containers)
  "containers": [
    {
      "id": "abc123def456",
      "name": "mtproxy-proxy-abc123",
      "image": "telemt-proxy-v4",
      "status": "Up 2 hours",
      "created": "2026-07-06T10:00:00.000Z",
      "ports": "443/tcp"
    }
  ]
}
```

#### `POST /api/nodes/:id/restart-service`

Restart service-node via `docker compose restart`.

**Response 200:**
```json
{
  "success": true,
  "log": "[1] ...\n[2] ...\n..."
}
```

#### `POST /api/nodes/:id/reboot`

Reboot server via `sudo reboot`.

**Request:**
```json
{
  "ssh": { ... },
  "confirm": true      // REQUIRED
}
```

**Response 200:**
```json
{
  "success": true,
  "log": "[1] ...\n[2] ...\n[3] reboot-initiated"
}
```

### NetBird Endpoints

#### `POST /api/nodes/:id/netbird/status`

Get NetBird status from node.

**Request:** Same SSH credentials.

**Response 200:**
```json
{
  "installed": true,
  "connected": true,
  "meshIp": "100.64.0.5",
  "peerName": "node-proxy1",
  "managementUrl": "https://app.netbird.io",
  "version": "0.27.0",
  "peers": [
    { "name": "node-proxy2", "ip": "100.64.0.6", "connected": true }
  ]
}
```

#### `POST /api/nodes/:id/netbird/install`

Install NetBird on node.

**Request:**
```json
{
  "ssh": { ... },
  "setupKey": "NETBIRD-SETUP-KEY-XXXXX",
  "managementUrl": "https://netbird.example.com",
  "hostname": "proxy1"
}
```

**Response 200:**
```json
{
  "success": true,
  "log": "[1] ...\n[2] ...",
  "status": { ...NetBirdStatus }
}
```

#### `POST /api/nodes/:id/netbird/uninstall`

Remove NetBird from node.

#### `GET /api/nodes/:id/netbird/cached-status`

Get last saved NetBird status from DB (no SSH).

**Response 200:** `NetBirdStatus` or `null`

### Remote Install Endpoints

#### `POST /api/remote-install/test-ssh`

Test SSH connectivity to a host.

**Request:**
```json
{
  "host": "1.2.3.4",
  "port": 22,
  "username": "root",
  "password": "secret"
}
```

**Response 200:**
```json
{ "success": true, "system": "Linux proxy1 6.5.0-91-generic ..." }
```

#### `POST /api/remote-install/node`

Install service-node on remote host.

**Request:**
```json
{
  "ssh": { ... },
  "nodePort": 8443,
  "nginxPort": 443,
  "natIp": ""
}
```

**Response 200:**
```json
{
  "success": true,
  "serverIp": "1.2.3.4",
  "port": 8443,
  "authToken": "a1b2c3d4...",
  "log": "[1] ...\n[2] ..."
}
```

### SSL Endpoints

#### `POST /api/ssl/cloudflare/test`

Test Cloudflare API token.

**Request:**
```json
{ "apiToken": "..." }
```

**Response 200:**
```json
{ "success": true, "zoneCount": 3 }
```

#### `POST /api/ssl/wildcard/obtain`

Obtain wildcard Let's Encrypt certificate.

**Request:**
```json
{
  "wildcardDomain": "*.example.com",
  "rootDomain": "example.com",
  "email": "admin@example.com",
  "staging": false,
  "cloudflare": { "apiToken": "..." }
}
```

**Response 200:**
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

List all wildcard certificates.

#### `POST /api/ssl/wildcard/renew`

Force renew a certificate.

#### `GET /api/ssl/zones?apiToken=...`

List Cloudflare zones for a token.

### System Endpoints

#### `GET /api/system/version`

Get panel version.

**Response 200:**
```json
{ "version": "2.0.0" }
```

#### `POST /api/system/update`

Trigger panel self-update.

**Response 200:**
```json
{
  "success": true,
  "message": "Update started. Panel will restart in a few minutes."
}
```

---

## 🖧 Service Node API

Base URL: `http://node-host:8443/api`

**All endpoints require:** `Authorization: Bearer <AUTH_TOKEN>`

### Proxy Endpoints

#### `GET /api/proxies`

List all proxies.

#### `POST /api/proxies`

Create proxy. Body: `ProxyCreateRequest`

#### `GET /api/proxies/:id`

Get proxy details.

#### `PUT /api/proxies/:id`

Update proxy. Body: `ProxyUpdateRequest`

#### `DELETE /api/proxies/:id`

Delete proxy.

#### `POST /api/proxies/:id/restart`

Restart container.

#### `POST /api/proxies/:id/pause`

Pause container.

#### `POST /api/proxies/:id/unpause`

Unpause container.

#### `GET /api/proxies/:id/stats`

Get container stats.

#### `GET /api/proxies/:id/link?server_ip=X`

Get `tg://proxy?...` link.

#### `GET /api/proxies/:id/stats-history`

Get historical stats.

#### `GET /api/proxies/:id/ip-history`

Get IP connection history.

#### `DELETE /api/proxies/:id/clear-history`

Clear stats + IP history.

### Domain Endpoints

#### `GET /api/domains`

Get custom domains (or default pool).

#### `PUT /api/domains`

Set custom domains. Body: `{ domains: string[] }`

### Blacklist Endpoints

#### `GET /api/blacklist`

Get IP blacklist.

#### `PUT /api/blacklist`

Set IP blacklist. Body: `{ ips: string[] }`

### Export/Import

#### `GET /api/export`

Download all proxies as JSON.

#### `POST /api/import`

Import proxies from JSON. Body: `ExportBundle`

### System Endpoints

#### `POST /api/update`

Trigger self-update (runs `update.sh`).

**Response:**
```json
{ "success": true, "output": "Already up to date." }
```

---

## ❌ Error Handling

All errors follow consistent format:

```json
{ "error": "Human-readable error message" }
```

### HTTP Status Codes

| Code | Meaning | When |
|---|---|---|
| 200 | Success | Normal response |
| 201 | Created | Resource created successfully |
| 204 | No content | Success with no body |
| 400 | Bad request | Validation failed, missing required fields |
| 401 | Unauthorized | Invalid/missing auth token |
| 403 | Forbidden | Valid token but insufficient permissions |
| 404 | Not found | Resource doesn't exist |
| 409 | Conflict | Duplicate (e.g., port in use) |
| 429 | Too many requests | Rate limit exceeded (enforced since v2.0.0) |
| 500 | Server error | Unexpected error, check logs |
| 502 | Bad gateway | Node unreachable from panel |
| 503 | Service unavailable | Maintenance mode (future) |

### Error Examples

```json
// 400 Bad request
{ "error": "ip, port (1-65535), and token (min 16 chars) are required" }

// 401 Unauthorized
{ "error": "Invalid or expired token" }

// 403 Forbidden (invalid token on node)
{ "error": "Invalid token" }

// 404 Not found
{ "error": "Proxy not found" }

// 409 Conflict
{ "error": "Port 12345 is already in use" }

// 502 Bad gateway (panel → node)
{ "error": "Failed to connect to node" }

// 500 Server error
{ "error": "Internal server error" }
```

### Error Message Sanitization

**Security:** Since v2.0.0, all error messages are sanitized via `sanitizeErrorMessage()` before being returned to the client:

- **Internal IPs** (10.0.0.x, 192.168.x.x, 127.0.0.1) are replaced with `Internal server error`
- **Stack traces** (file paths, line numbers) are stripped
- **SSH errors** are mapped to generic messages (`SSH connection failed`, `SSH authentication failed`)
- **Docker errors** are mapped to generic messages (`Container not found`, `Container operation failed`)
- **PostgreSQL errors** are mapped to generic messages (`Duplicate entry`, `Database operation failed`)

The full error (with internal details) is logged server-side via `logger.error()` for debugging.

**Example:**

```
// Internal error message in server logs:
{"level":"error","time":"...","category":"panel.proxy","message":"Failed to proxy GET /api/proxies to 10.0.0.5:8443","error":"connect ECONNREFUSED 10.0.0.5:8443"}

// What client sees:
{"error":"Failed to connect to node"}
```

See [`SECURITY_AUDIT_SSH.md`](SECURITY_AUDIT_SSH.md) for the full security audit.

---

## 🚦 Rate Limiting

Enforced via `express-rate-limit` middleware:

**Panel API:**
| Limiter | Scope | Limit |
|---|---|---|
| `globalLimiter` | All endpoints | 200 req/min per IP |
| `loginLimiter` | `/api/auth/login` | 10 attempts per 15 min per IP |
| `sshLimiter` | `/api/remote-install/*` and `/api/nodes/:id/*` (SSH-related) | 10 req per 5 min per IP |

**Node API:**
- Rate limiting via `express-rate-limit` is configured per token (panel only)
- 1000 req/min per token recommended for production

**Behavior:**
- Exceeded limits return HTTP 429 with `{ "error": "Too many requests" }`
- Standard `RateLimit-*` headers (RFC 6585) are included
- Per-IP (not per-user) — see Future Work in [SECURITY_AUDIT_SSH.md](SECURITY_AUDIT_SSH.md)

---

## 📝 Examples

### Complete Workflow (curl)

```bash
# 1. Login to panel
TOKEN=$(curl -fsS -X POST http://panel/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"secret"}' | jq -r .token)

# 2. List nodes
curl -fsS http://panel/api/nodes \
  -H "Authorization: Bearer $TOKEN" | jq .

# 3. Add new node
curl -fsS -X POST http://panel/api/nodes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Proxy 1","ip":"1.2.3.4","port":8443,"token":"node-token"}'

# 4. Get all proxies
curl -fsS http://panel/api/proxies/all \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | .proxies | length'

# 5. Create proxy
curl -fsS -X POST http://panel/api/nodes/1/proxies \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Proxy","domain":"google.com","maxConnections":50}'

# 6. Get proxy link
PROXY_ID="abc123"
SERVER_IP="1.2.3.4"
curl -fsS "http://panel/api/nodes/1/proxies/$PROXY_ID/link?server_ip=$SERVER_IP" \
  -H "Authorization: Bearer $TOKEN" | jq -r .link

# 7. Get metrics (requires SSH)
curl -fsS -X POST http://panel/api/nodes/1/metrics \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ssh":{"host":"1.2.3.4","port":22,"username":"root","password":"ssh-pass"}}' \
  | jq '{cpu: .cpu.usagePercent, mem: .memory.usagePercent, disk: .disks[0].usagePercent}'

# 8. Restart service
curl -fsS -X POST http://panel/api/nodes/1/restart-service \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ssh":{"host":"1.2.3.4","port":22,"username":"root","password":"ssh-pass"}}' \
  | jq .success

# 9. Logout (client-side: delete JWT from localStorage)
```

### JavaScript Client

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

// Login
const { token: t } = await apiCall('POST', '/auth/login', {
  username: 'admin',
  password: 'secret',
});
token = t;

// Use API
const nodes = await apiCall('GET', '/nodes');
console.log(nodes);
```

---

## 📊 OpenAPI Specification

A machine-readable OpenAPI 3.0 spec is available at `/docs/openapi.yaml` (planned for v2.1).

Generate clients automatically:

```bash
# Generate TypeScript client
npx openapi-typescript-codegen --input docs/openapi.yaml --output src/api-client/

# Generate Python client
openapi-generator-cli generate -i docs/openapi.yaml -g python -o python-client/
```

---

## 🔄 Versioning

API follows **semantic versioning**:
- Major version (1.x → 2.x): Breaking changes
- Minor version (1.0 → 1.1): New features, backward-compatible
- Patch version (1.0.0 → 1.0.1): Bug fixes

Current: **v2.0.0**

Breaking changes from v1.x:
- New `/api/nodes/:id/metrics` endpoint (replaces old `/api/stats`)
- New wildcard SSL endpoints
- New NetBird endpoints
- New monitoring endpoints

Migration guide: see [MIGRATION.md](MIGRATION.md)
