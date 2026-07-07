# Architecture

Technical deep-dive into MTProto Suite's architecture, design decisions, and data flows.

[🇷🇺 Русская версия](ARCHITECTURE.ru.md)

## 📋 Table of Contents

- [System Overview](#-system-overview)
- [Component Architecture](#-component-architecture)
- [Data Flow](#-data-flow)
- [Storage Architecture](#-storage-architecture)
- [Network Architecture](#-network-architecture)
- [Security Architecture](#-security-architecture)
- [Performance Considerations](#-performance-considerations)
- [Scaling Strategy](#-scaling-strategy)

---

## 🌐 System Overview

MTProto Suite is a **distributed control plane** for managing MTProto proxies. It follows the classic **control plane / data plane** separation:

```
┌─────────────────────────────────────────────────────────────────┐
│                      CONTROL PLANE                                │
│                       (Panel Host)                                │
│                                                                   │
│  ┌─────────┐    ┌──────────┐    ┌─────────┐    ┌──────────────┐  │
│  │ Web UI  │───▶│  API     │───▶│   DB    │    │  Monitoring  │  │
│  │ (React) │    │ (Express)│    │ (PG)    │    │  (SSH pool)  │  │
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
│                      (Service Nodes)                               │
│                                                                   │
│   Node #1              Node #2              Node #N                │
│  ┌──────────┐         ┌──────────┐         ┌──────────┐          │
│  │ Express  │         │ Express  │         │ Express  │          │
│  │  API     │         │  API     │         │  API     │          │
│  └────┬─────┘         └────┬─────┘         └────┬─────┘          │
│       │                    │                    │               │
│  ┌────▼─────┐         ┌────▼─────┐         ┌────▼─────┐          │
│  │  nginx   │         │  nginx   │         │  nginx   │          │
│  │ SNI 443  │         │ SNI 443  │         │ SNI 443  │          │
│  └────┬─────┘         └────┬─────┘         └────┬─────┘          │
│       │                    │                    │               │
│  ┌────▼─────┐         ┌────▼─────┐         ┌────▼─────┐          │
│  │ telemt   │         │ telemt   │         │ telemt   │          │
│  │ proxies  │         │ proxies  │         │ proxies  │          │
│  └────┬─────┘         └────┬─────┘         └────┬─────┘          │
│       │                    │                    │               │
│  ┌────▼─────┐         ┌────▼─────┐         ┌────▼─────┐          │
│  │  xray    │         │  xray    │         │  xray    │          │
│  │ (VPN)    │         │ (VPN)    │         │ (VPN)    │          │
│  └──────────┘         └──────────┘         └──────────┘          │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Stateless control plane** — panel can be restarted without data loss (DB is persistent)
2. **Stateless data plane** — service-nodes persist state in JSON files, but can rebuild from panel config
3. **Pull-based configuration** — service-nodes pull config changes from panel
4. **Push-based commands** — panel can push commands (restart, reboot, install)
5. **Async everything** — no blocking operations, all I/O is async
6. **Fail-safe defaults** — strict validation prevents invalid configs from being saved

---

## 🧩 Component Architecture

### Shared Package (`@mtproto-suite/shared`)

Common TypeScript types and utilities used by both panel-backend and service-node.

**Types:**
- `ProxyConfig` — proxy state (id, name, port, domain, status, ...)
- `ProxyStats` — runtime metrics (CPU, memory, network, uptime)
- `VlessConfig` — VLESS subscription structure
- `NodeMetrics` — system metrics (CPU, memory, disk)
- `SystemInfo` — OS info (hostname, kernel, IP)
- `ContainerStats` — Docker container metrics

**Utilities:**
- `createTarBuffer()` — single-file TAR archive (used for `docker putArchive`)
- `extractIp()` — IP regex parser
- `fetchWithTimeout()` — fetch with AbortController-based timeout
- `mergeSignals()` — combines multiple AbortSignals into one
- `logger` — structured JSON logger

**Constants:**
- `TELEGRAM_DC_RANGES` — IP prefixes of Telegram data centers
- `FAKE_TLS_DOMAINS` — pool of 50+ domains for fake TLS
- `DOCKER_NETWORK_NAME` — `mtproto-net`
- `CONTAINER_PREFIXES` — naming conventions
- `PORT_RANGE` — auto-assign port range

### Panel Backend

**Stack:**
- Express 4 + TypeScript
- PostgreSQL 16 (jsonb, uuid, indices)
- bcrypt (cost 12) for passwords
- jsonwebtoken for JWT
- ssh2 for SSH client (remote install, monitoring)
- acme-client v5 + node-forge (wildcard SSL)
- axios (Cloudflare API)
- pg (PostgreSQL client)

**Responsibilities:**
1. **Authentication** — JWT issuance and validation
2. **User management** — admin user creation, password hashing
3. **Node registry** — CRUD for service-nodes in PostgreSQL
4. **Proxy proxying** — REST API that forwards requests to nodes
5. **Remote install** — SSH-based service-node installation
6. **Monitoring proxy** — SSH-based metrics collection
7. **NetBird management** — installation and status tracking
8. **Wildcard SSL** — ACME protocol + Cloudflare DNS-01

**Directory structure:**
```
panel-backend/src/
├── config/         # Env validation, port parsing
├── db/             # Pool, migrations, schema
├── middleware/     # JWT auth, validation
├── routes/         # REST endpoints
│   ├── auth.ts
│   ├── nodes.ts
│   ├── proxies.ts
│   ├── allProxies.ts
│   ├── remote-install.ts
│   ├── ssl.ts
│   └── nodes-monitoring.ts
├── services/       # Business logic
│   ├── ssh/        # SSH client, metrics, actions
│   ├── ssl/        # ACME + Cloudflare
│   └── netbird/    # Mesh VPN
└── utils/          # Helpers (validation, fetchWithTimeout)
```

### Service Node

**Stack:**
- Express 4 + TypeScript
- dockerode (Docker API client)
- Built-in Node.js fetch for external APIs (ip-api.com)

**Responsibilities:**
1. **Container lifecycle** — create/start/stop/remove Docker containers
2. **nginx SNI routing** — generate config, write to nginx, reload
3. **VLESS integration** — parse subscriptions, create xray containers
4. **Statistics collection** — Docker stats, real-time nginx log watcher
5. **IP history** — track connections, lookup geolocation
6. **Custom domains** — manage user-provided domain pool
7. **IP blacklist** — apply to nginx deny directives

**Directory structure:**
```
service-node/src/
├── config/         # Env validation
├── middleware/     # Bearer-token auth (timingSafeEqual)
├── routes/         # REST endpoints
│   ├── health.ts
│   └── proxy.ts
├── services/       # Business logic
│   ├── docker.ts   # telemt container management
│   ├── nginx.ts    # SNI router + log watcher
│   ├── xray.ts     # VLESS → SOCKS5
│   └── proxy.ts    # CRUD orchestrator
├── store/          # JSON storage with mutex
└── utils/          # Crypto, helpers
```

### Panel Frontend

**Stack:**
- React 18 + TypeScript
- Vite 5 (build, dev server)
- React Router 6 (SPA routing)
- Custom CSS modules (no UI framework dependencies)

**Responsibilities:**
1. **Authentication UI** — login form, JWT storage
2. **Node management UI** — list, add, monitor
3. **Proxy management UI** — CRUD with advanced config
4. **Real-time monitoring UI** — auto-refresh metrics, charts
5. **NetBird UI** — install, status, peer list
6. **SSL UI** — wildcard certificate wizard
7. **Bulk operations** — export/import proxies

**Directory structure:**
```
panel-frontend/src/
├── api/            # Typed API client
├── hooks/          # useAsync, useNodes, etc.
├── components/     # Reusable UI
│   ├── Monitoring/ # MetricsCard, MetricsChart, ActionPanel
│   ├── NetBird/    # NetBirdPanel
│   ├── SSL/        # WildcardSslDialog
│   └── RemoteInstall/ # RemoteInstallDialog
├── pages/          # Route components
│   ├── Login/
│   ├── Nodes/
│   ├── NodeDetail/
│   └── SSL/
└── utils/          # chart, format, clipboard
```

---

## 🔄 Data Flow

### Creating a Proxy (User Action → Container Running)

```
┌──────┐    ┌─────────┐    ┌─────────┐    ┌──────────┐    ┌─────────┐
│ UI   │    │ Panel   │    │ Panel   │    │ Service  │    │ Docker  │
│      │    │ Frontend│    │ Backend │    │ Node     │    │         │
└──┬───┘    └────┬────┘    └────┬────┘    └────┬─────┘    └────┬────┘
   │            │              │              │              │
   │ 1. POST /api/nodes/1/proxies              │              │
   ├───────────▶│              │              │              │
   │            │ 2. Forward to node           │              │
   │            ├─────────────▶│              │              │
   │            │              │ 3. POST /api/proxies        │
   │            │              ├─────────────▶│              │
   │            │              │              │ 4. create    │
   │            │              │              ├─────────────▶│
   │            │              │              │ 5. start     │
   │            │              │              │◀─────────────┤
   │            │              │ 6. Update store.json        │
   │            │              │◀─────────────┤              │
   │            │              │ 7. Update nginx.conf        │
   │            │              │◀─────────────┤              │
   │            │              │ 8. nginx -s reload          │
   │            │              │◀─────────────┤              │
   │            │ 9. Return proxy config          │              │
   │            │◀─────────────┤              │              │
   │ 10. Show success          │              │              │
   │◀───────────┤              │              │              │
```

**Time:** ~2 seconds total

### Connecting Client → Telegram DC (Request Path)

```
┌────────┐    ┌─────────┐    ┌─────────┐    ┌──────────┐    ┌─────────────┐
│Client  │    │nginx    │    │telemt   │    │xray      │    │Telegram DC  │
│(Telegram)   │(SNI)    │    │(proxy) │    │(VLESS)   │    │             │
└───┬────┘    └────┬────┘    └────┬────┘    └────┬─────┘    └────┬───────┘
    │             │              │              │              │
    │ 1. TLS ClientHello (SNI: google.com)      │              │
    ├────────────▶│              │              │              │
    │             │ 2. Route by SNI             │              │
    │             ├─────────────▶│              │              │
    │             │              │ 3. Decode MTProto secret    │
    │             │              │              │              │
    │             │              │ 4. (Hybrid mode)            │
    │             │              │ - ME: direct (host routes  │
    │             │              │   to tun0 → EU IP)         │
    │             │              │ - DC: via xray SOCKS5      │
    │             │              ├─────────────▶│              │
    │             │              │              │ 5. VLESS to  │
    │             │              │              │   VPN server │
    │             │              │              ├─────────────▶│
    │             │              │              │ 6. Connect   │
    │             │              │              │   to DC      │
    │             │              │              │◀─────────────┤
    │             │              │ 7. Proxy data              │
    │◀────────────┴──────────────┴──────────────┴──────────────┤
```

**Latency:** ~50-200ms (depending on VPN path)

### Collecting Metrics (User Action → Metrics Displayed)

```
┌──────┐    ┌─────────┐    ┌─────────┐    ┌──────────┐    ┌─────────┐
│ UI   │    │ Panel   │    │ Panel   │    │ Service  │    │ Linux   │
│      │    │ Frontend│    │ Backend │    │ Node     │    │ server  │
└──┬───┘    └────┬────┘    └────┬────┘    └────┬─────┘    └────┬────┘
   │            │              │              │              │
   │ 1. GET /api/nodes/1/metrics               │              │
   ├───────────▶│              │              │              │
   │            │ 2. POST /api/nodes/1/metrics              │
   │            ├─────────────▶│              │              │
   │            │              │ 3. SSH exec (parallel):      │
   │            │              │    - top -bn1                │
   │            │              │    - free -b                 │
   │            │              │    - df -B1 -P               │
   │            │              │    - docker stats            │
   │            │              ├─────────────▶│              │
   │            │              │              ├─────────────▶│
   │            │              │              │◀─────────────┤
   │            │              │ 4. Parse responses           │
   │            │              │◀─────────────┤              │
   │            │              │ 5. Save to history table     │
   │            │              │              │              │
   │            │ 6. Return NodeMetrics          │              │
   │            │◀─────────────┤              │              │
   │ 7. Display in UI          │              │              │
   │◀───────────┤              │              │              │
```

**Time:** ~1-2 seconds (4 parallel SSH calls)

---

## 💾 Storage Architecture

### Panel: PostgreSQL

**Database:** `mtproto_panel`

**Tables:**

#### `users`
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(60) NOT NULL,  -- bcrypt, exactly 60 chars
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Indexes:
- UNIQUE on `username` (automatic)

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

Indexes:
- `idx_nodes_ip` (B-tree on `ip`)

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

Indexes:
- `idx_node_metrics_history_node_time` (`node_id`, `timestamp DESC`)

Data retention: 1000 points per node (auto-trimmed)

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

### Service Node: JSON Files

**Location:** `/opt/mtproto-suite/service-node/data/`

**Files:**

#### `store.json` — proxy configurations
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

**Atomic writes:** `.tmp` + `rename` (no corruption on crash)

#### `stats-history.json` — metrics history
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

**Trim:** Max 2016 snapshots per proxy (~7 days at 5-min intervals)

#### `ip-history.json` — IP connection history
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

**Flush:** Debounced, written every 10 seconds (not on every nginx log line)

### Why JSON, not SQL?

For service-node state, JSON is preferred because:
1. **Single file = single source of truth** — easy backup/restore
2. **No SQL client dependency** — only Node.js fs module
3. **Atomic writes via tmp + rename** — no corruption on crash
4. **Easy to inspect** — `cat data/store.json | jq`
5. **No migrations** — schema is in TypeScript types

For panel, PostgreSQL is required because:
1. **Relational data** — nodes ↔ proxies ↔ metrics
2. **Concurrent access** — multiple users, multiple API calls
3. **Aggregations** — GROUP BY, JOIN, time-series queries
4. **ACID guarantees** — financial-level data integrity

---

## 🌐 Network Architecture

### Ports

| Port | Service | Protocol | Direction |
|---|---|---|---|
| 80 | Panel HTTP | TCP | Inbound (panel host) |
| 443 | Panel HTTPS | TCP | Inbound (panel host) |
| 443 | Node proxy | TCP | Inbound (node host) |
| 3000 | Panel backend | TCP | Internal (panel network) |
| 5432 | PostgreSQL | TCP | Internal (panel network) |
| 8443 | Node API | TCP | Inbound (from panel) |
| 22 | SSH | TCP | Inbound (from panel/admin) |

### Docker Networks

**Panel:**
- Default bridge network (frontend ↔ backend ↔ db)

**Nodes:**
- External bridge network `mtproto-net`
- Connects: nginx, proxy containers, xray containers

**Container connectivity:**
```
nginx (host network, port 443) → proxy-1 (mtproto-net) → telegram DC
                                ↓
                                proxy-2 (mtproto-net) → telegram DC
```

**Why host network for nginx?**
- Listens on privileged port 443
- Direct access to client IPs (for geo-IP and IP blocking)
- No docker-proxy overhead

### TLS/SSL

**Panel:**
- TLS 1.2/1.3 only
- HSTS enabled (`Strict-Transport-Security: max-age=31536000; includeSubDomains`)
- Modern cipher suite (ECDHE)
- Security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- CORS whitelist via `PANEL_FRONTEND_URL` env var (only known origins can make requests)
- Rate limiting: 200 req/min global, 10 SSH requests/5 min, 10 login attempts/15 min
- Error message sanitization — no internal IPs, paths, stack traces leaked
- Logger auto-redaction for credentials (password, token, privateKey, secret)

**Nodes:**
- fake TLS via nginx `$ssl_preread_server_name`
- Uses domains like `google.com`, `microsoft.com` for camouflage
- TLS client hello is real, but no actual TLS handshake (MTProto inside)

### DNS

**Default:** `8.8.8.8`, `1.1.1.1` (configured in docker-compose)

**For wildcard SSL:**
- `_acme-challenge.example.com` TXT records (TTL 60s during challenge)

---

## 🔐 Security Architecture

### Authentication Layers

1. **JWT (panel API)**
   - Algorithm: HS256
   - Expiry: 24 hours
   - Secret: 64-char hex (256-bit)
   - Payload: `{ userId, username }`

2. **Bearer-token (node API)**
   - Static token, 64-char hex (256-bit)
   - Stored in `AUTH_TOKEN` env var
   - Comparison via `crypto.timingSafeEqual` (constant-time)

3. **SSH (panel → node)**
   - Password OR private key (OpenSSH format)
   - Optional passphrase
   - Not persisted in panel (transmitted per-request)

### Threat Model

**Threats addressed:**

| Threat | Mitigation |
|---|---|
| Password brute-force | bcrypt cost 12 (slow); login rate limit 10/15min |
| Token theft (XSS) | localStorage (not cookie); no JS access to JWT |
| Timing attack on token | `crypto.timingSafeEqual` |
| Username enumeration | identical bcrypt response for unknown users |
| SQL injection | Parameterized queries (pg library) |
| CSRF | Bearer-token (not cookies) — CSRF irrelevant |
| MITM on API | TLS 1.2/1.3 only |
| SSH brute-force | rate limit 10/5min; credentials not persisted |
| Cross-origin attacks | CORS whitelist via `PANEL_FRONTEND_URL` env var |
| Information disclosure via errors | `sanitizeErrorMessage()` — no internal IPs/paths leaked |
| Credentials in logs | `sanitizeMeta()` in logger — auto-redacts passwords/tokens |
| Unauthorized node access | SSH credentials required per request |
| Container escape | Docker isolation; node runs as non-root where possible |
| Fake TLS fingerprinting | `tls_emulation: true` in telemt config |

**Detailed security audit:** See [`SECURITY_AUDIT_SSH.md`](SECURITY_AUDIT_SSH.md) for the comprehensive SSH credentials audit (10 findings, all addressed).

**Threats NOT addressed (out of scope):**

- Physical access to servers
- Compromised Docker daemon (use `userland-proxy: false` + disable if needed)
- Insider threats with admin panel access
- Telegram-side bans (handled via ME servers, not by us)

### Secrets Storage

| Secret | Storage | Encryption |
|---|---|---|
| Admin password | PostgreSQL `users.password_hash` | bcrypt (one-way) |
| JWT_SECRET | Panel `.env` (chmod 600) | None (filesystem perms) |
| DB_PASSWORD | Panel `.env` (chmod 600) | None |
| Node AUTH_TOKEN | Node `.env` (chmod 600) | None |
| SSH credentials | Per-request in HTTP body | HTTPS in transit |
| Cloudflare API token | PostgreSQL `cloudflare_credentials.api_token_encrypted` | AES-256-GCM (planned) |
| SSL private keys | Filesystem (`chmod 600`) | None |

**Recommended hardening:**
1. Use Vault / AWS Secrets Manager for production deployments
2. Enable disk encryption (LUKS)
3. Use SSH key auth for all servers (disable password SSH)
4. Run panel behind reverse proxy with WAF (Cloudflare, etc.)

### Network Isolation

**Production recommendation:**
- Panel in private subnet (e.g., 10.0.0.0/16)
- Nodes in private subnet
- Access only via:
  - VPN (WireGuard, NetBird)
  - Bastion host with MFA
- Public exposure:
  - Panel: only via HTTPS (with strict firewall rules)
  - Nodes: only port 443 (proxy traffic)

---

## ⚡ Performance Considerations

### Bottlenecks

| Layer | Bottleneck | Mitigation |
|---|---|---|
| Browser → Panel API | Network latency | CDN, gzip, HTTP/2 |
| Panel → Node API | SSH round-trips | Parallel SSH calls, caching |
| Node → Docker API | Docker daemon overhead | `dockerode` connection pool |
| Node → Linux commands | SSH overhead | Execute in parallel |
| nginx → telemt | Stream proxy overhead | `proxy_timeout`, `proxy_buffering off` |

### Optimizations

**Backend:**
- Pool connections (`pg.Pool` max=10)
- Async I/O everywhere
- JSON atomic writes
- Mutex for serialization (prevents race conditions)

**Frontend:**
- `useAsync` with AbortController (cancels on unmount)
- `manualChunks` in Vite (gravity-ui and chart split)
- `mergeSignals` (compatibility with older browsers)

**Node:**
- `top -bn1` (single snapshot, not continuous)
- `df -B1 -P` (POSIX format for consistent parsing)
- In-memory caches (GeoIP, domain→proxy, store)
- Debounced IP history flush (10 sec, not per-event)

### Throughput Estimates

**Per proxy container:**
- ~1000 connections (depends on RAM)
- ~50 MB/s throughput (single core limit)
- ~10k messages/sec (MTProto decode overhead)

**Per node host:**
- ~100 proxies (4-8 CPU cores, 8 GB RAM)
- ~5 GB/s aggregate throughput
- ~1M messages/sec

**Per panel host:**
- ~1000 nodes (with proper DB tuning)
- ~10k API req/min
- PostgreSQL bottleneck for >10k nodes

---

## 📈 Scaling Strategy

### Horizontal Scaling (Nodes)

Add more service-nodes as needed:
- Each node is independent (no shared state)
- Panel scales linearly with node count (one SSH connection per action)
- PostgreSQL scales to millions of nodes (single instance)

### Vertical Scaling (Single Host)

Increase host resources:
- CPU: 1 core per ~50 proxies
- RAM: 256 MB per proxy container + 512 MB system
- Disk: 1 GB per proxy container + 10 GB base

### Database Scaling

For >10k nodes:
- **PostgreSQL read replicas** — separate reads (metrics) from writes (configs)
- **Partitioning** — split `node_metrics_history` by month
- **Archival** — move old metrics to cold storage (S3 + Parquet)

### CDN for Panel UI

For global access:
- CloudFlare in front (free tier sufficient)
- nginx as origin (with cache-control headers)
- Automatic HTTPS via CF

### Container Orchestration

For >100 nodes:
- Kubernetes (with Helm chart)
- Each node = a Deployment
- Panel = StatefulSet (for DB)
- Auto-scaling based on metrics

**Not yet implemented** — current design assumes docker-compose for simplicity.

---

## 🔄 Future Roadmap

### Planned Features

- [ ] **Multi-user roles** — admin, operator, viewer (RBAC)
- [ ] **Audit log** — all panel actions logged to PostgreSQL
- [ ] **Webhooks** — Slack/Telegram notifications on events
- [ ] **Proxy analytics** — per-proxy traffic graphs, top countries
- [ ] **Backup/restore UI** — automated backups to S3
- [ ] **Multi-tenancy** — multiple isolated panels on one host
- [ ] **High availability** — panel failover (active-passive)
- [ ] **gRPC API** — alternative to REST for service-nodes

### Under Consideration

- **Prometheus exporter** — metrics for Grafana
- **OpenTelemetry tracing** — distributed tracing
- **HashiCorp Vault integration** — secret management
- **OPA (Open Policy Agent)** — declarative policy enforcement
