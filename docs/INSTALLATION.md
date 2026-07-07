# Installation Guide

This guide covers all installation scenarios for MTProto Suite.

[🇷🇺 Русская версия](INSTALLATION.ru.md)

## 📋 Table of Contents

- [Prerequisites](#-prerequisites)
- [Quick Installation](#-quick-installation)
- [Scenario 1: Production — Panel + Multiple Nodes](#-scenario-1-production--panel--multiple-nodes)
- [Scenario 2: Single-Host (Panel + Node)](#-scenario-2-single-host-panel--node)
- [Scenario 3: Development Build](#-scenario-3-development-build)
- [SSL/TLS Configuration](#-ssltls-configuration)
- [NetBird Mesh VPN Setup](#-netbird-mesh-vpn-setup)
- [Updating](#-updating)
- [Uninstallation](#-uninstallation)

---

## ✅ Prerequisites

### System Requirements

**Panel host:**
- Linux x86_64 or aarch64
- 1 CPU core, 1 GB RAM (minimum)
- 10 GB disk space
- Root or sudo access (for installer)

**Each node host:**
- Linux x86_64 or aarch64
- 1 CPU core, 512 MB RAM (minimum for 10 proxies)
- 5 GB disk space
- Root or sudo access
- Public IP address (or NetBird mesh IP for private network)

### Software Dependencies

The installer will automatically install missing dependencies. However, if you prefer to install manually:

**Ubuntu / Debian:**
```bash
apt-get update && apt-get install -y curl openssl git docker.io docker-compose-plugin
```

**CentOS / RHEL:**
```bash
yum install -y curl openssl git docker docker-compose-plugin
systemctl enable --now docker
```

**AlmaLinux / Rocky:**
```bash
dnf install -y curl openssl git docker docker-compose-plugin
systemctl enable --now docker
```

### Docker Version

- Docker Engine **≥ 20.10** (for `condition: service_healthy`)
- Docker Compose plugin **≥ 2.0**

Verify:
```bash
docker version    # Should show Server.Version ≥ 20.10
docker compose version    # Should show ≥ 2.0
```

### Network Requirements

**Inbound to panel host:**
- TCP 80 (HTTP) or 443 (HTTPS) — Web UI
- Optional: TCP 22 (SSH) for installation only

**Inbound to node host:**
- TCP 443 (default proxy port) — Telegram clients
- TCP 8443 (default API port) — Panel access
- Optional: TCP 22 (SSH) for installation only

**Outbound from panel host:**
- TCP 443 to each node's public IP — API communication
- TCP 80 to api.ipify.org — server IP detection during remote install

**Outbound from node host:**
- UDP 53 (DNS) — required
- TCP 443 to Telegram DC IPs
- TCP 443 to Cloudflare API (if using wildcard SSL)

---

## 🚀 Quick Installation

The unified `install.sh` script handles all scenarios. Show help:

```bash
bash install.sh --help
```

```
MTProto Suite — Installer

Usage:
  bash install.sh [options]

Options:
  --mode=panel|node|both   What to install (default — interactive choice)
  --ssl-self               Self-signed SSL for panel (only in panel mode)
  --ssl-letsencrypt DOM    Let's Encrypt for specified domain
  --install-dir DIR        Where to clone (default /opt/mtproto-suite)
  --repo URL               Repository URL
  -y, --yes                Don't ask for confirmation
  --uninstall              Remove installation
  --help                   This help

Examples:
  bash install.sh --mode=panel
  bash install.sh --mode=node
  bash install.sh --mode=both -y
  bash install.sh --mode=panel --ssl-letsencrypt panel.example.com
```

---

## 🌐 Scenario 1: Production — Panel + Multiple Nodes

This is the **recommended** deployment for managing many proxies across many servers.

### Step 1: Install Panel Server

Choose a server with a **stable public IP** and good connectivity to all your proxy servers.

```bash
ssh root@panel.example.com

bash <(wget -qO- https://raw.githubusercontent.com/mtproto-suite/mtproto-suite/master/install.sh) --mode=panel
```

**Interactive prompts:**
```
What to install?
  1) panel — Web UI management
  2) node  — Proxy runtime
  3) both  — Panel + node on one host
Choose mode [1/2/3]: 1

External panel port (HTTP) [80]: 80
Admin username [admin]: admin
Admin password (min 8 chars): ********
Confirm password: ********

SSL for panel?
  1) No SSL (HTTP)
  2) Self-signed certificate
  3) Let's Encrypt (requires domain)
Choose [1/2/3]: 3
Domain for Let's Encrypt: panel.example.com

[INFO] Email for Let's Encrypt notifications: admin@example.com
```

**Output:**
```
✓ Panel installed and running

URL:        https://panel.example.com
Login:      admin
Password:   ********
Directory:  /opt/mtproto-suite

Next step: install service-node on proxy server
  bash <(wget -qO- https://...install.sh) --mode=node
```

### Step 2: Install Each Service Node

On each proxy server:

```bash
ssh root@proxy1.example.com

bash <(wget -qO- https://raw.githubusercontent.com/mtproto-suite/mtproto-suite/master/install.sh) --mode=node
```

**Interactive prompts:**
```
Node API port [8443]: 8443
Proxy port (nginx) [443]: 443
NAT_IP (public IP of VPN server, optional):  # leave empty if no VPN
```

**Output:**
```
✓ Service node installed

API:        http://proxy1.example.com:8443/api/health
Proxy port: 443
Token:      a1b2c3d4e5f6...
Directory:  /opt/mtproto-suite

Add this node to panel:
  Name:     Node proxy1.example.com
  IP:       proxy1.example.com
  Port:     8443
  Token:    a1b2c3d4e5f6...
```

> 💡 **Save the token!** You'll need it to add the node to the panel.

### Step 3: Add Nodes in Panel

**Method A: Use Panel's Remote Install (Easiest)**

1. Open `https://panel.example.com` in browser
2. Login with admin credentials
3. Click **"🛠 Install remotely"** button
4. Enter SSH credentials of proxy server
5. Click **"🚀 Install"** — panel installs service-node automatically
6. After success, click **"+ Add as node"** — credentials auto-fill

**Method B: Add Existing Node Manually**

1. Open panel UI → **"Nodes"** page
2. Click **"+ Add node"** button
3. Fill in:
   - **Name**: Friendly name (e.g., "Frankfurt #1")
   - **IP**: Proxy server's public IP
   - **Port**: 8443 (default)
   - **Token**: From Step 2 output
   - **Domain** (optional): For `tg://proxy?...` link generation
4. Click **"Add node"**

### Step 4: Create Your First Proxy

1. Click on the added node
2. Click **"+ Create proxy"**
3. Configure:
   - **Name**: Friendly name
   - **Domain**: Auto-selected from pool or custom
   - **Max connections**: Optional limit
   - **VPN subscription** (optional): VLESS URL if using VPN
4. Click **"Create"**

The proxy is now active. Click **"📋 Copy tg:// link"** to share with Telegram clients.

---

## 🖥️ Scenario 2: Single-Host (Panel + Node)

For testing, demos, or home use — everything runs on one machine.

```bash
ssh root@localhost

bash <(wget -qO- https://raw.githubusercontent.com/mtproto-suite/mtproto-suite/master/install.sh) --mode=both -y
```

This installs:
- PostgreSQL + backend + frontend (panel on port 80)
- service-node (proxy on port 8443 + proxy port 443)

**After installation:**
1. Open `http://<server-ip>:80` in browser
2. Login with admin credentials (shown in output)
3. Add the local node:
   - **IP**: `127.0.0.1` (or your server IP)
   - **Port**: `8443`
   - **Token**: From installation output

> 💡 **Production note**: Single-host mode uses port 443 for the proxy and forwards to localhost. If your panel also needs port 443 (HTTPS), you'll need to use non-standard ports.

---

## 💻 Scenario 3: Development Build

For contributing to MTProto Suite or running custom modifications.

### Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- Docker (for testing)
- Git

### Setup

```bash
git clone https://github.com/mtproto-suite/mtproto-suite.git
cd mtproto-suite

# Install dependencies for all packages
cd shared && npm install && cd ..
cd service-node && npm link ../shared && npm install && cd ..
cd panel-backend && npm link ../shared && npm install && cd ..
cd panel-frontend && npm link ../shared && npm install && cd ..

# Build everything
cd shared && npm run build && cd ..
cd service-node && npm run build && cd ..
cd panel-backend && npm run build && cd ..
cd panel-frontend && npm run build && cd ..

# Run dev mode for any package
cd panel-backend && npm run dev   # ts-node watcher
cd panel-frontend && npm run dev # vite dev server
```

### Development URLs

- **Backend dev**: `http://localhost:3000/api/*`
- **Frontend dev**: `http://localhost:5173` (Vite default)
- **Frontend → Backend proxy**: Configured in `vite.config.ts`

### Hot Reload

Backend uses `ts-node` for instant reload on file changes.
Frontend uses Vite HMR for instant UI updates.

---

## 🔒 SSL/TLS Configuration

Three options for securing your panel:

### Option 1: No SSL (HTTP — Development Only)

```bash
bash install.sh --mode=panel
# Choose "No SSL" when prompted
```

> ⚠️ **Never use HTTP in production.** All credentials are transmitted in cleartext.

### Option 2: Self-Signed Certificate

```bash
bash install.sh --mode=panel --ssl-self
```

Generates a self-signed certificate valid for 365 days. Browsers will show a warning — clients must manually trust it.

**Use case:** Internal networks, testing, staging.

### Option 3: Let's Encrypt (Production)

```bash
bash install.sh --mode=panel --ssl-letsencrypt panel.example.com
```

Requirements:
- Domain must point to your panel server's IP (A record)
- Port 80 must be free during initial certificate issuance
- Email address for Let's Encrypt notifications

The installer:
1. Installs `certbot` if missing
2. Obtains certificate via HTTP-01 challenge
3. Configures nginx with TLS 1.2/1.3, HSTS, security headers
4. Sets up cron job for auto-renewal

### Option 4: Wildcard SSL via Cloudflare

For multiple subdomains (e.g., `panel.example.com`, `proxy1.example.com`, `proxy2.example.com`):

1. Add your domain to Cloudflare
2. Create API Token with `Zone:DNS:Edit` permission
3. Open panel → **SSL Certificates** → **"Get Wildcard"**
4. Enter API Token → select domain → enter email
5. Click **"Obtain Certificate"**

The panel:
1. Creates ACME account on Let's Encrypt
2. Generates CSR for `*.example.com`
3. Creates TXT record `_acme-challenge.example.com` via Cloudflare API
4. Completes DNS-01 challenge
5. Saves certificate and private key to `/opt/mtproto-suite/ssl/wildcard/`

See [SSL.md](USAGE.md#-wildcard-ssl-via-cloudflare) for details.

---

## 🔐 NetBird Mesh VPN Setup

Optional: connect all nodes through a private WireGuard mesh network, bypassing NAT/firewall issues.

### 1. Get a Setup Key

**SaaS (netbird.io):**
- Sign up at https://app.netbird.io
- Go to Setup Keys → Create
- Copy the key (e.g., `NETBIRD-SETUP-KEY-XXXXX`)

**Self-hosted:**
- Deploy NetBird management server (see https://docs.netbird.io/selfhosted/)
- Create setup key via admin panel

### 2. Install on Each Node

In the panel:
1. Open node detail page
2. Scroll to **NetBird** section
3. Enter setup key + (optional) management URL
4. Click **"Install & Connect"**

After installation, each node has a **mesh IP** (e.g., `100.64.0.5`). You can use mesh IPs instead of public IPs in panel node configuration.

### 3. Verify

```bash
# SSH into a node
netbird status

# Should show:
#   Management: Connected to https://app.netbird.io
#   Status: Connected
#   Peers: 3
```

---

## 🔄 Updating

### Panel Self-Update (via UI)

1. Login to panel
2. Open Settings page (or use API)
3. Click **"Update panel"**
4. Wait 2-5 minutes for containers to rebuild

Or via CLI:
```bash
cd /opt/mtproto-suite
git pull origin master
docker compose pull 2>/dev/null || docker compose build
docker compose up -d
```

### Node Self-Update (via Panel)

1. Open panel → Nodes
2. Click on node
3. Click **"Update"** button
4. Panel triggers `update.sh` on the node via SSH

Or via CLI on node:
```bash
cd /opt/mtproto-suite
git pull origin master
docker compose pull 2>/dev/null || docker compose build
docker compose up -d
```

### Update All Nodes Automatically

```bash
# From panel host
for node in node1.example.com node2.example.com; do
  ssh root@$node "cd /opt/mtproto-suite && git pull && docker compose up -d"
done
```

---

## 🗑️ Uninstallation

### Interactive

```bash
bash /opt/mtproto-suite/install.sh --uninstall
```

Confirms before removing:
- `/opt/mtproto-suite` directory
- All containers
- Docker volumes (PostgreSQL data, service-node data)
- SSL certificates

### Non-Interactive (for automation)

```bash
bash /opt/mtproto-suite/install.sh --uninstall -y
```

### Partial Uninstall (keep data)

```bash
# Stop containers but keep data
cd /opt/mtproto-suite
docker compose down  # Stops containers, preserves volumes

# Or stop and remove containers but keep data directory
docker compose down --remove-orphans
rm -rf /opt/mtproto-suite/service-node/data  # Optional: remove node data
```

---

## 🔧 Post-Installation

### Verify Installation

**Panel:**
```bash
curl -fsS http://localhost:80/api/health
# Expected: {"status":"ok"}
```

**Node:**
```bash
curl -fsS http://localhost:8443/api/health \
  -H "Authorization: Bearer <your-token>"
# Expected: {"status":"ok","timestamp":"...","version":"2.0.0"}
```

### Configure Firewall

**Panel (UFW example):**
```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 22/tcp  # SSH
```

**Node (UFW example):**
```bash
ufw allow 443/tcp   # Proxy traffic
ufw allow 8443/tcp  # API (from panel IP only)
ufw allow from <panel-ip> to any port 8443
ufw allow 22/tcp    # SSH
```

### Backup

**Panel data:**
```bash
docker compose exec -T db pg_dump -U mtproto mtproto_panel > backup.sql
tar czf panel-config.tar.gz .env panel-backend/.env
```

**Node data:**
```bash
tar czf node-data.tar.gz /opt/mtproto-suite/service-node/data
tar czf node-config.tar.gz /opt/mtproto-suite/service-node/.env
```

---

## 🆘 Getting Help

If installation fails:

1. Check logs: `docker compose logs`
2. See [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
3. Open an issue: https://github.com/mtproto-suite/mtproto-suite/issues
4. Include in your report:
   - OS version (`cat /etc/os-release`)
   - Docker version (`docker version`)
   - Installation log
   - Output of `docker compose logs`
