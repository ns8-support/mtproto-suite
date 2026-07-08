# Frequently Asked Questions (FAQ)

Common questions about MTProto Suite.

[🇷🇺 Русская версия](FAQ.ru.md)

## 📋 Table of Contents

- [General](#-general)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Proxies](#-proxies)
- [Security](#-security)
- [Performance](#-performance)
- [Troubleshooting](#-troubleshooting)

---

## 🌐 General

### What is MTProto Suite?

MTProto Suite is a unified Docker-based project for managing MTProto Telegram proxies at scale. It combines:
- A **web panel** (UI) for centralized management
- **Service nodes** (runtime) on each proxy server
- Optional **VPN tunneling** (VLESS/Reality) for bypassing blocks

### How is it different from the original `danielVNru` repos?

| Aspect | Original | MTProto Suite |
|---|---|---|
| Repositories | 2 (panel + node) | 1 unified |
| Security | JWT default `'change-me-in-production'` | Required, no default |
| Monitoring | Basic (Docker stats only) | Full CPU/RAM/Disk + history |
| Remote install | ❌ | ✅ SSH-based |
| SSL | Manual | Automated Let's Encrypt / Cloudflare |
| NetBird | ❌ | ✅ Mesh VPN |
| Docker compose | One per service | Unified |
| Tests | None | (in progress) |

### Can I use this commercially?

Yes! MIT license allows commercial use. Just retain the copyright notice.

### Is this affiliated with Telegram?

No. This is an independent open-source project. "MTProto" and "Telegram" are trademarks of Telegram Messenger LLP.

---

## 📦 Installation

### What Linux distributions are supported?

- Ubuntu 20.04, 22.04, 24.04
- Debian 11, 12
- CentOS / RHEL 8, 9
- AlmaLinux / Rocky Linux 8, 9

Only x86_64 and aarch64 (64-bit ARM). 32-bit systems are not supported.

### Can I install on macOS or Windows?

Technically yes for the **panel** (Docker Desktop), but not recommended for production. macOS/Windows cannot be used as **service nodes** (proxy servers).

### Do I need to install Node.js?

**No!** All components run in Docker containers. The only requirement is Docker Engine 20.10+ and Docker Compose plugin.

### How much disk space do I need?

- **Panel**: 2 GB minimum
- **Each node**: 5 GB minimum + 100 MB per proxy container
- **SSL certificates**: < 1 MB

### Can I install panel and node on the same machine?

Yes! Use `--mode=both` for testing or home use. For production, use separate servers.

### What's the minimum RAM?

- **Panel**: 1 GB (2 GB recommended)
- **Each node**: 512 MB (1 GB per 50 proxies)

---

## ⚙️ Configuration

### Where are config files stored?

| File | Location |
|---|---|
| Panel .env | `/opt/mtproto-suite/panel-backend/.env` |
| Node .env | `/opt/mtproto-suite/service-node/.env` |
| Proxy configs (node) | `/opt/mtproto-suite/service-node/data/store.json` |
| Stats history | `/opt/mtproto-suite/service-node/data/stats-history.json` |
| IP history | `/opt/mtproto-suite/service-node/data/ip-history.json` |
| SSL certificates | `/opt/mtproto-suite/ssl/wildcard/` |

### Can I use an external PostgreSQL?

Yes. Set `DB_HOST` to external host in `panel-backend/.env`. The installer expects PostgreSQL 16+, but older versions may work.

### How do I change the panel port?

1. Edit `/opt/mtproto-suite/panel-backend/.env`: `PORT=<new-port>`
2. Restart: `cd /opt/mtproto-suite && docker compose restart frontend`
3. Update firewall rules

### How do I add custom fake TLS domains?

Via panel UI: **"Domains"** → enter comma-separated list → Save.
Or via API:
```bash
curl -X PUT http://node:8443/api/domains \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domains":["google.com","microsoft.com"]}'
```

### How do I limit connections per proxy?

When creating/editing a proxy, set `maxConnections`. nginx will apply `limit_conn` directive.

---

## 🌐 Proxies

### What's the difference between ME and DC?

**ME (Middle End) servers** — Telegram proxies used for initial connection. Bypasses direct IP blocks.

**DC (Data Center)** — Telegram's actual servers. Blocked in some countries.

**telemt** automatically uses ME for obfuscation, falls back to DC if needed.

### What is fake TLS?

A technique where the proxy traffic looks like HTTPS to a legitimate domain (e.g., `google.com`). Telegram clients connect to port 443 on your server, but the connection is actually MTProto, disguised as TLS to evade DPI.

### Why do I need VLESS/Reality VPN?

In Russia, China, Iran, and other countries, Telegram DCs are blocked. ME servers partially work, but traffic patterns can be detected.

**VLESS/Reality** routes all traffic through a VPN server in an unblocked country (Netherlands, Germany, etc.). The traffic looks like legitimate TLS to a popular website (e.g., `google.com`), making it impossible to block.

### How many proxies per node?

Depends on host resources:
- 1 vCPU / 1 GB RAM: ~10 proxies
- 2 vCPU / 2 GB RAM: ~50 proxies
- 4 vCPU / 4 GB RAM: ~100 proxies
- 8 vCPU / 8 GB RAM: ~300 proxies

### Can I run the same proxy on multiple nodes?

Yes! Export from one node, import to another. Each node gets a separate container, but the proxy URL (tg://) is the same.

### How do I share a proxy with users?

1. In panel, find the proxy
2. Click **"Copy tg:// link"**
3. Share the link with users (Telegram, website, etc.)
4. Users open it in Telegram → Settings → Proxy → Paste

---

## 🔒 Security

### Is my data encrypted?

- **In transit**: HTTPS (TLS 1.2/1.3)
- **At rest**: Admin password is bcrypt-hashed. Other secrets (JWT_SECRET, AUTH_TOKEN) are in plaintext `.env` files (filesystem permissions only).
- **Database**: PostgreSQL on private Docker network

For production, use disk encryption (LUKS, BitLocker) and a secrets manager (Vault).

### What if someone gets my AUTH_TOKEN?

They can access the node API. Mitigation:
1. Rotate token: `openssl rand -hex 32`
2. Update in panel UI
3. Update in node's `.env`
4. Restart: `docker compose restart`

### Should I expose panel to the internet?

Only if necessary. Best practice:
- Run panel on private network (e.g., 10.0.0.0/16)
- Access via VPN (WireGuard, NetBird)
- Or use bastion host with MFA

### What happens if I lose my admin password?

Reset via PostgreSQL:
```bash
docker exec -it <db-container> psql -U mtproto -d mtproto_panel -c "
UPDATE users SET password_hash = crypt('new-password', gen_salt('bf', 12))
WHERE username = 'admin';
"
```

### How often should I rotate secrets?

- **JWT_SECRET**: Every 90 days (invalidates all sessions)
- **AUTH_TOKEN**: Every 180 days
- **DB_PASSWORD**: Every 365 days
- **Admin password**: Every 90 days
- **SSH keys**: Every 2 years

### Are SSH credentials stored anywhere?

**No.** SSH credentials are transmitted per-request from the frontend to the panel backend via HTTPS, used to establish a single SSH connection to the target node, and then garbage-collected when the request completes.

- ❌ Not stored in PostgreSQL
- ❌ Not stored in localStorage (frontend)
- ❌ Not stored in cookies
- ✅ Only in React component state (lost on page reload)
- ✅ Logger auto-redacts any leaked credentials in logs

See [`SECURITY_AUDIT_SSH.md`](SECURITY_AUDIT_SSH.md) for the detailed audit.

### What happens if the panel detects CORS violations?

Since v2.0.0, the panel API uses a CORS whitelist configured via `PANEL_FRONTEND_URL`. If a request comes from an origin not in the whitelist:

1. The request is rejected with `CORS: origin not allowed`
2. The blocked origin is logged via `logger.warn('cors', ...)`
3. The browser will show a CORS error in the developer console

This protects against cross-origin attacks where malicious sites try to invoke panel API endpoints using the user's JWT token.

### What are the rate limits?

Since v2.0.0, rate limiting is enforced via `express-rate-limit`:

| Endpoint | Limit |
|---|---|
| All endpoints (global) | 200 req/min per IP |
| `/api/auth/login` | 10 attempts per 15 min per IP |
| SSH endpoints (`/api/remote-install/*`, `/api/nodes/:id/*`) | 10 req per 5 min per IP |

Exceeding limits returns HTTP 429 with `{"error": "Too many requests"}`.

### Can I see internal error details for debugging?

By design, **no** — error messages returned to the client are sanitized to prevent information disclosure. Full error details (with stack traces, internal IPs, file paths) are only available in server logs:

```bash
# View panel backend logs
docker logs -f mtproto-panel-backend

# Or follow specific category
docker logs mtproto-panel-backend 2>&1 | grep '"category":"panel.proxy"'
```

---

## ⚡ Performance

### How fast is MTProto Suite?

Throughput depends on:
- Node CPU (telemt is CPU-bound)
- Network bandwidth between node and Telegram DCs
- Whether VPN is used (adds latency)

Typical: **1-10 MB/s per proxy**, **50-200 MB/s per node**.

### Why is my proxy slow?

Common causes:
1. **CPU bottleneck**: Too many proxies per host
2. **Network bottleneck**: ISP throttling or limited bandwidth
3. **VPN overhead**: VLESS adds 50-200ms latency
4. **DPI blocking**: Use fake TLS or VLESS for camouflage

### How do I scale beyond 100 nodes?

- **Vertical**: Increase panel host resources (CPU, RAM, PostgreSQL tuning)
- **Horizontal**: Add more panel instances behind load balancer (complex)
- **Sharding**: One panel per region/datacenter

For 1000+ nodes, consider:
- PostgreSQL read replicas
- Redis cache for frequent queries
- Prometheus for metrics aggregation

### Does NetBird affect performance?

NetBird adds ~1-5ms latency for mesh routing. Not noticeable for proxy traffic.

### Should I use SSD or HDD?

**SSD strongly recommended** for nodes. nginx access logs and IP history writes are I/O-intensive.

---

## 🐛 Troubleshooting

### The installer fails with "Docker not found"

Install Docker manually:
```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

### My proxy stops working after a few hours

Check container restart count:
```bash
docker ps -a --filter "name=mtproto-proxy"
# Look for "Restarting" or high restart count in Status column
```

Common causes:
- OOM (out of memory) — increase host RAM
- Network timeout — check ISP limits
- Telegram DC ban — rotate IP, use VPN

### tg:// link works in Telegram but proxy is slow

Use ME servers (default) instead of direct DC. Set `useMiddleProxy: true` and `me2dcFallback: true`.

### I see "ECONNREFUSED" in logs

Check:
1. Container is running: `docker ps | grep mtproto-proxy`
2. Port is open: `netstat -tlnp | grep 443`
3. Firewall allows: `ufw status`

### How do I enable debug logging?

Set `LOG_LEVEL=debug` in respective `.env` file, restart container.

### Where do I report bugs?

https://github.com/ns8-support/mtproto-suite/issues

Include:
- OS version
- Docker version
- Panel/node versions
- Reproduction steps
- Full logs

---

## 🤔 Still have questions?

- 📖 Read the [docs](../README.md)
- 🐛 Search [GitHub issues](https://github.com/ns8-support/mtproto-suite/issues)
- 💬 Open a [GitHub discussion](https://github.com/ns8-support/mtproto-suite/discussions)
- 📧 Email (TBD)

---

## 📚 Glossary

**MTProto** — Telegram's native protocol for client-server communication.

**ME (Middle End)** — Telegram's intermediate proxy servers for connection obfuscation.

**DC (Data Center)** — Telegram's actual message-routing servers.

**SNI (Server Name Indication)** — TLS extension indicating which domain the client wants to connect to (used for fake TLS).

**fake TLS** — MTProto traffic disguised as HTTPS to bypass DPI.

**VLESS** — Modern VPN protocol based on XTLS, resistant to detection.

**Reality** — TLS extension by XTLS that mimics legitimate websites (e.g., `google.com`).

**ACME** — Automatic Certificate Management Environment (protocol used by Let's Encrypt).

**DNS-01 challenge** — Domain validation method that requires creating TXT records (used for wildcard certs).

**ACME client** — Software implementing ACME protocol (we use `acme-client` for Node.js).

**WireGuard** — Modern VPN protocol (used by NetBird under the hood).

**Mesh VPN** — Decentralized VPN where peers connect to each other (no central server after setup).

**NetBird** — Open-source mesh VPN built on WireGuard.

**SOCKS5** — Proxy protocol (xray in our setup listens on SOCKS5 port 10808).

**proxychains** — Linux tool that forces TCP connections through SOCKS proxies (telemt uses this to reach Telegram via xray).

**fake TLS** — Disguising MTProto as legitimate HTTPS traffic.

**tg://proxy** — Telegram's protocol for sharing proxy configurations.

**JWT (JSON Web Token)** — Token format for stateless authentication (HS256 algorithm with shared secret).

**Bearer token** — Authentication scheme where token is passed in `Authorization: Bearer <token>` header.

**bcrypt** — Password hashing function (intentionally slow, with configurable cost).

**timingSafeEqual** — Constant-time comparison function (prevents timing attacks).

**SSH (Secure Shell)** — Encrypted protocol for remote server access.

**DHCP** — Dynamic Host Configuration Protocol (not used here).

**Docker** — Container runtime (we use 20.10+).

**docker-compose** — Tool for multi-container Docker applications (we use the plugin version 2.0+).
