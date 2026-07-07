# MTProto Suite

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/docker-required-blue.svg)](https://docker.com)
[![Platform](https://img.shields.io/badge/platform-linux-lightgrey.svg)](#-compatibility)

**Unified management panel and service-node runtime for MTProto Telegram proxies with VPN tunneling.**

MTProto Suite combines a centralized management panel (Web UI) with distributed service-nodes (proxy runtime on each server) into a single Docker-based project. Designed for deploying and managing hundreds of MTProto proxies across multiple servers, with optional VLESS/Reality VPN tunneling for bypassing regional blocks.

[🇷🇺 Русская версия документации](README.ru.md)

---

## ✨ Features

### 🖥️ Management Panel (Web UI)

- **Multi-node management** — control unlimited service-nodes from one panel
- **Real-time monitoring** — CPU, RAM, Disk, Docker container stats via SSH
- **History graphs** — interactive time-series charts for all metrics
- **Remote actions** — restart service, reboot server, install NetBird
- **Remote SSH installation** — install service-node on a new server with one click
- **Wildcard SSL** — automated Let's Encrypt certificates via Cloudflare DNS-01
- **VLESS/Reality VPN tunneling** — per-proxy SOCKS5 via xray
- **Multi-port proxies** — assign individual ports to each proxy
- **Connection limits** — `limit_conn` per-proxy via nginx
- **IP blacklist** — at node level, applied via nginx `deny` directives
- **Custom fake TLS domains** — pool of 50+ domains, user-extensible
- **Statistics** — CPU/RAM/traffic/uptime, history (7 days), JSON exports
- **IP geolocation** — country flags via ip-api.com (cached 1 hour)
- **Live IP tracking** — real-time connection logging from nginx access logs
- **JWT authentication** — bearer-token based, 24h expiry
- **Role-based actions** — restart, pause, resume, update via UI
- **Export/Import** — move proxy configurations between nodes
- **Self-update** — panel can update itself via UI button

### ⚙️ Service Node (Runtime)

- **High-performance proxy** — Rust-based `telemt` MTProto proxy
- **SNI-based routing** — single nginx, multi-domain via `$ssl_preread_server_name`
- **VLESS VPN integration** — Reality/TLS/WS/grpc/xhttp transports
- **Hybrid mode** — ME traffic via tun0 (EU IP), DC traffic via SOCKS5 (bypass RKN)
- **Legacy mode** — DC traffic only via SOCKS5
- **Per-proxy configuration** — 30+ advanced options (keepalive, reconnect, stun, etc.)
- **Auto-recovery** — containers restart on failure (`unless-stopped` policy)
- **GeoIP lookup** — automatic country detection for connecting IPs
- **Real-time stats** — collected every 5 minutes, 7-day rolling history
- **Hash-based image caching** — telemt image rebuilt only on Dockerfile change

### 🛡️ Security

- **JWT secret mandatory** — no insecure default (`change-me-in-production` removed)
- **AUTH_TOKEN validation** — minimum 16 chars, `timingSafeEqual` comparison
- **Username enumeration protection** — identical bcrypt response for unknown users
- **IP/port/token validation** — strict regex on all inputs
- **CHECK constraints** — PostgreSQL enforces port ranges
- **SSL-only recommendation** — install script supports Let's Encrypt / self-signed
- **bcrypt cost 12** — admin password hashing
- **Secrets in `.env` chmod 600** — only root can read
- **HTTPS-only API** — TLS 1.2/1.3 with HSTS, security headers
- **AES-256-GCM encryption** — Cloudflare tokens and SSH credentials at rest
- **CORS whitelist** — only panel frontend can make API requests
- **Rate limiting** — 10 SSH requests per 5 min, 10 login attempts per 15 min
- **Error message sanitization** — no internal IPs, paths, or stack traces leaked
- **Logger auto-redaction** — passwords, tokens, and private keys never logged
- **SSH security audited** — see [SECURITY_AUDIT_SSH.md](docs/SECURITY_AUDIT_SSH.md) (10 findings, all fixed)

### 🔒 NetBird Mesh VPN (Optional)

- **WireGuard-based mesh** — connect nodes over private network
- **Bypass NAT/firewall** — no public IP required for inter-node communication
- **Self-hosted support** — bring your own management server
- **Auto-discovery** — peers visible in panel after setup
- **Easy setup** — one-click install with setup key

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     PANEL HOST                           │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   Frontend   │→│   Backend    │→│  PostgreSQL  │   │
│  │  (Nginx SPA) │  │  (Express)  │  │   (16-alpine) │   │
│  │   Port: 80   │  │  Port: 3000  │  │   Port: 5432  │   │
│  └──────────────┘  └──────┬───────┘  └──────────────┘   │
│                           │                               │
│                           │ JWT-authenticated REST API   │
│                           │ (timeout, validation, audit) │
└───────────────────────────┼───────────────────────────────┘
                            │
                            │ SSH (password or private key)
                            │ + Bearer-token API
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Node #1     │    │  Node #2     │    │  Node #N     │
│  (VPS/Host)  │    │  (VPS/Host)  │    │  (VPS/Host)  │
│              │    │              │    │              │
│ ┌──────────┐ │    │ ┌──────────┐ │    │ ┌──────────┐ │
│ │ Express  │ │    │ │ Express  │ │    │ │ Express  │ │
│ │ API:8443 │ │    │ │ API:8443 │ │    │ │ API:8443 │ │
│ └──────────┘ │    │ └──────────┘ │    │ └──────────┘ │
│ ┌──────────┐ │    │ ┌──────────┐ │    │ ┌──────────┐ │
│ │  nginx   │ │    │ │  nginx   │ │    │ │  nginx   │ │
│ │  :443    │ │    │ │  :443    │ │    │ │  :443    │ │
│ └──────────┘ │    │ └──────────┘ │    │ └──────────┘ │
│ ┌──────────┐ │    │ ┌──────────┐ │    │ ┌──────────┐ │
│ │ telemt   │ │    │ │ telemt   │ │    │ │ telemt   │ │
│ │ proxy #1 │ │    │ │ proxy #N │ │    │ │ proxy #N │ │
│ └──────────┘ │    │ └──────────┘ │    │ └──────────┘ │
│              │    │              │    │              │
│ Docker net:  │    │ Docker net:  │    │ Docker net:  │
│ mtproto-net  │    │ mtproto-net  │    │ mtproto-net  │
└──────────────┘    └──────────────┘    └──────────────┘
```

All components run in Docker containers — no native Node.js installation required.

---

## 📦 Project Structure

```
mtproto-suite/
├── shared/                    # Common types and utilities (TypeScript)
├── service-node/              # Proxy runtime (Express + Docker + Nginx + xray)
│   ├── src/                   # All TypeScript source files
│   ├── Dockerfile             # Multi-stage build
│   └── docker-compose.yml     # Standalone service-node deployment
├── panel-backend/             # API server (Express + PostgreSQL)
│   ├── src/                   # All TypeScript source files
│   ├── Dockerfile
│   └── update.sh
├── panel-frontend/            # React SPA (Vite + Gravity UI)
│   ├── src/                   # TypeScript + React components
│   ├── Dockerfile
│   ├── nginx.conf             # HTTP-only default config
│   └── nginx-ssl.conf         # HTTPS config (Let's Encrypt)
├── docs/                      # 📚 Documentation
│   ├── INSTALLATION.md        # Step-by-step installation guide
│   ├── CONFIGURATION.md       # All environment variables explained
│   ├── USAGE.md               # Day-to-day usage guide
│   ├── ARCHITECTURE.md        # Technical architecture deep-dive
│   ├── API.md                 # REST API reference
│   ├── TROUBLESHOOTING.md     # Common issues and solutions
│   ├── SECURITY.md            # Security model and best practices
│   ├── SECURITY_AUDIT_SSH.md  # SSH credentials audit report
│   └── MIGRATION.md           # Migrating from original repos
├── docker-compose.yml         # Panel stack (frontend + backend + db)
├── docker-compose.ssl.yml     # Overlay for HTTPS
├── docker-compose.both.yml    # Panel + node on one host (testing)
├── install.sh                 # 🔧 Unified interactive installer
├── install-node.sh            # Alias for `install.sh --mode=node`
├── uninstall.sh
├── CHANGELOG.md               # Version history
├── LICENSE                    # MIT License
├── CONTRIBUTING.md            # How to contribute
├── README.md                  # This file
└── README.ru.md               # Russian version
```

---

## 🚀 Quick Start

### Option 1: Production Deployment (Recommended)

**Step 1: Install the panel on your management server**

```bash
# SSH into your panel server
ssh root@panel.example.com

# Run the installer
bash <(wget -qO- https://raw.githubusercontent.com/mtproto-suite/mtproto-suite/master/install.sh) --mode=panel
```

The installer will:
1. Check and install Docker if needed
2. Clone the repository to `/opt/mtproto-suite`
3. Ask for: port, admin username, admin password
4. Generate JWT_SECRET (32 bytes) and DB_PASSWORD (16 bytes) automatically
5. Build and start containers

**Step 2: Install service-node on each proxy server**

```bash
# SSH into each proxy server
ssh root@proxy1.example.com

# Run the installer
bash <(wget -qO- https://raw.githubusercontent.com/mtproto-suite/mtproto-suite/master/install.sh) --mode=node
```

**Or use the panel's "🛠 Install remotely" feature** — paste SSH credentials in the panel and it will install the service-node for you.

**Step 3: Add the node in the panel**

1. Open `http://panel.example.com:80` in your browser
2. Login with your admin credentials
3. Click "**🛠 Install remotely**" → enter SSH credentials → click Install
4. After installation, click "**+ Add as node**" (auto-fills IP/port/token)

### Option 2: Test Deployment (Single Host)

For testing or home use, install everything on one server:

```bash
bash <(wget -qO- https://raw.githubusercontent.com/mtproto-suite/mtproto-suite/master/install.sh) --mode=both -y
```

This starts:
- PostgreSQL + backend + frontend (panel on port 80)
- service-node (proxy runtime on port 8443 + proxy port 443)

After installation, add the node in the panel: `IP=127.0.0.1, Port=8443, Token=<from-output>`.

### Option 3: Manual Build (Developers)

```bash
git clone https://github.com/mtproto-suite/mtproto-suite.git
cd mtproto-suite

# Build all 4 packages
cd shared && npm install && npm run build && cd ..
cd service-node && npm install && npm run build && cd ..
cd panel-backend && npm install && npm run build && cd ..
cd panel-frontend && npm install && npm run build

# Start with docker-compose
cd ..
docker compose up -d --build
```

---

## 📖 Documentation

Detailed documentation is available in the [`docs/`](docs/) directory. **All documents are available in both English and Russian.**

### English Documentation

| Document | Description |
|---|---|
| [📥 INSTALLATION.md](docs/INSTALLATION.md) | Step-by-step installation for all scenarios |
| [⚙️ CONFIGURATION.md](docs/CONFIGURATION.md) | All environment variables and `.env` examples |
| [📘 USAGE.md](docs/USAGE.md) | Day-to-day usage, creating proxies, monitoring |
| [🏗️ ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical architecture, data flow, security model |
| [🔌 API.md](docs/API.md) | Complete REST API reference (panel ↔ service-node) |
| [🔧 TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common issues, logs, debugging |
| [🔒 SECURITY.md](docs/SECURITY.md) | Security model, hardening, threat model |
| [🔍 SECURITY_AUDIT_SSH.md](docs/SECURITY_AUDIT_SSH.md) | SSH credentials audit (10 findings, all fixed) |
| [🔄 MIGRATION.md](docs/MIGRATION.md) | Migrating from original danielVNru repos |
| [❓ FAQ.md](docs/FAQ.md) | Frequently asked questions |

### Русская документация

| Документ | Описание |
|---|---|
| [📥 INSTALLATION.ru.md](docs/INSTALLATION.ru.md) | Пошаговая инструкция по установке для всех сценариев |
| [⚙️ CONFIGURATION.ru.md](docs/CONFIGURATION.ru.md) | Все переменные окружения и примеры `.env` |
| [📘 USAGE.ru.md](docs/USAGE.ru.md) | Повседневное использование, создание прокси, мониторинг |
| [🏗️ ARCHITECTURE.ru.md](docs/ARCHITECTURE.ru.md) | Техническая архитектура, потоки данных, модель безопасности |
| [🔌 API.ru.md](docs/API.ru.md) | Полный REST API reference (panel ↔ service-node) |
| [🔧 TROUBLESHOOTING.ru.md](docs/TROUBLESHOOTING.ru.md) | Частые проблемы, логи, отладка |
| [🔒 SECURITY.ru.md](docs/SECURITY.ru.md) | Модель безопасности, hardening, threat model |
| [🔄 MIGRATION.ru.md](docs/MIGRATION.ru.md) | Миграция с оригинальных репозиториев danielVNru |
| [❓ FAQ.ru.md](docs/FAQ.ru.md) | Часто задаваемые вопросы |

---

## 🌐 Compatibility

### Operating Systems

| OS | Versions | Package Manager |
|---|---|---|
| Ubuntu | 20.04, 22.04, 24.04 | apt |
| Debian | 11, 12 | apt |
| CentOS / RHEL | 8, 9 | yum / dnf |
| AlmaLinux / Rocky Linux | 8, 9 | yum |

> ⚠️ **Linux x86_64 and aarch64 only.** Windows and macOS are not supported as proxy hosts.
> The **panel** can technically run anywhere Docker works, but only Linux is officially tested.

### Docker

- Docker Engine **≥ 20.10** (for `condition: service_healthy` support)
- Docker Compose plugin **≥ 2.0** (auto-installed if missing)

### Browsers (for Panel UI)

- Chrome / Edge ≥ 90
- Firefox ≥ 88
- Safari ≥ 14

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development setup
- Coding standards
- Testing requirements
- Pull request process

---

## 📜 License

MIT License — see [LICENSE](LICENSE) for details.

Original projects:
- [danielVNru/mtproto-panel](https://github.com/danielVNru/mtproto-panel) © danielVNru
- [danielVNru/mtproto-node](https://github.com/danielVNru/mtproto-node) © danielVNru

---

## 🙏 Acknowledgments

- **telemt** — high-performance Rust MTProto proxy by [telemt/telemt](https://github.com/telemt/telemt)
- **xray** — VLESS proxy by [XTLS/Xray-core](https://github.com/XTLS/Xray-core)
- **nginx** — SNI-based traffic routing
- **Let's Encrypt** — free wildcard certificates
- **Cloudflare** — DNS API for ACME challenges
- **NetBird** — mesh VPN for inter-node connectivity
- **acme-client** — ACME protocol implementation
- **ssh2** — SSH client library
- **PostgreSQL** — reliable database
- **React + Gravity UI** — modern frontend stack
