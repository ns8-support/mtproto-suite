# Usage Guide

Day-to-day usage of MTProto Suite — creating proxies, monitoring, managing nodes.

[🇷🇺 Русская версия](USAGE.ru.md)

## 📋 Table of Contents

- [Initial Login](#-initial-login)
- [Managing Nodes](#-managing-nodes)
- [Creating Proxies](#-creating-proxies)
- [Monitoring Nodes](#-monitoring-nodes)
- [Remote Actions](#-remote-actions)
- [Wildcard SSL via Cloudflare](#-wildcard-ssl-via-cloudflare)
- [VLESS/Reality VPN](#-vlessreality-vpn)
- [Bulk Operations](#-bulk-operations)
- [Daily Operations](#-daily-operations)

---

## 🔑 Initial Login

After installation, you'll see credentials in the output:

```
✓ Panel installed and running

URL:        https://panel.example.com
Login:      admin
Password:   ********
```

1. Open the URL in your browser
2. Enter username and password
3. Click **"Login"**
4. JWT token stored in `localStorage` for 24 hours

> 🔒 **Change the default password immediately** if you're using the auto-generated one in a shared environment.

---

## 🖥️ Managing Nodes

### Nodes Page

Shows all registered service-nodes with:
- Name, IP, port
- Status (online/offline via periodic health check)
- Number of proxies on the node
- Last update time

### Adding a Node

**Method 1: Manual (existing service-node)**

1. Click **"+ Add node"**
2. Fill in:
   - **Name**: Friendly name (e.g., "Frankfurt #1")
   - **IP**: Public IP or domain
   - **Port**: 8443 (default)
   - **Token**: From `install.sh --mode=node` output
   - **Domain** (optional): For `tg://proxy?...` links
3. Click **"Test connection"** to verify
4. Click **"Add node"**

**Method 2: Remote SSH install (recommended for new servers)**

1. Click **"🛠 Install remotely"**
2. Enter SSH credentials:
   - Host (IP or domain)
   - Port (default 22)
   - Username (default `root`)
   - Password OR private key
3. Click **"🔌 Test connection"** — verifies SSH and shows OS info
4. Configure:
   - Node API port (default 8443)
   - Proxy port (default 443)
   - NAT_IP (for VPN mode)
5. Click **"🚀 Install"** — runs full installation pipeline
6. After success, click **"+ Add as node"**

### Node Actions

Click on a node to see details. Available actions:

| Action | Description |
|---|---|
| 📊 **Monitoring** | Real-time CPU/RAM/Disk/Docker stats |
| 🔄 **Update** | Triggers `update.sh` on the node |
| 🗑️ **Delete** | Removes from panel DB (doesn't uninstall from server) |
| 🔐 **Reconnect** | Re-test connection with new token |

---

## 🌐 Creating Proxies

### Via UI

1. Open node detail page
2. Click **"+ Create proxy"**
3. **Basic settings:**
   - **Name**: Friendly name
   - **Domain**: Auto-selected from pool (or custom)
   - **Max connections** (optional): Limit simultaneous devices
4. **Advanced settings** (click to expand):
   - VPN subscription (VLESS URL)
   - Mask host (redirect non-MTProto traffic)
   - Custom telemt options (30+ parameters)
5. Click **"Create"**

The proxy is now active. To get the shareable link:

1. Find the proxy in the list
2. Click **"📋 Copy tg:// link"**
3. Share with Telegram clients

### Proxy States

| Status | Meaning |
|---|---|
| `running` | Active, accepting connections |
| `paused` | Paused via UI (can resume) |
| `stopped` | Stopped manually or container error |
| `error` | Container not found (likely crashed) |

### Modifying a Proxy

1. Open proxy detail page
2. Edit desired fields
3. Click **"Save"**

Some changes require container restart:
- Domain
- VPN subscription
- Tag
- Custom telemt options

Restart happens automatically when needed.

### Pausing vs Deleting

**Pause** — temporarily disables the proxy (container is paused, state preserved).
**Delete** — removes proxy entirely (container stopped and removed, stats deleted).

### Bulk Export / Import

Export all proxies from one node for migration:

1. Open node detail
2. Click **"📦 Export"**
3. Save `proxies-export.json`

Import on another node:

1. Open target node detail
2. Click **"📥 Import"**
3. Upload `proxies-export.json`
4. Review imported proxies

---

## 📊 Monitoring Nodes

### Real-Time Metrics

When you click on a node, you see:

**System Info:**
- Hostname, OS, kernel version, architecture
- IP addresses
- Uptime
- Current server time

**Metrics (auto-refresh):**
- CPU usage (with load average and core count)
- RAM usage (total/used/free, swap)
- Disk usage (for each mount point)
- Docker container stats (CPU%, RAM, network)

**Refresh interval:** 5s / 10s / 30s / 1m / off (configurable in UI)

### History Graphs

Click **"1h" / "6h" / "24h" / "7d"** buttons to view historical metrics:
- CPU usage over time
- RAM usage over time
- Disk usage over time
- Number of running containers

History is stored in PostgreSQL (last 1000 points per node).

### Container Statistics

Detailed view of each Docker container on the node:
- Name, image, status
- CPU%, memory (used/limit)
- Network I/O (RX/TX)

### Alerts and Warnings

The monitoring page uses color coding:
- 🟢 Green (<50%): Healthy
- 🟡 Yellow (50-75%): Watch
- 🟠 Orange (75-90%): Warning
- 🔴 Red (>90%): Critical

---

## ⚡ Remote Actions

### Restart Service Node

1. Open node detail
2. Click **"🔄 Restart service"**
3. Confirm
4. Panel runs `docker compose restart service-node` via SSH
5. Waits up to 60 seconds for health check
6. Reports success/failure with logs

### Reboot Server

> ⚠️ **DESTRUCTIVE OPERATION** — all running processes will be terminated.

1. Open node detail
2. Click **"🔌 Reboot server"**
3. **Confirmation dialog:** Type the node name exactly
4. Panel runs `sudo reboot` via SSH
5. Connection to node will drop for 1-3 minutes
6. After reboot, node should reconnect automatically

### Security Notes for SSH Operations

When you click any of the above buttons, the panel:

1. Opens a new SSH connection to the target node (per-request)
2. Runs the hardcoded command (no command injection possible)
3. Closes the connection immediately after (try/finally)
4. Logs only the node hostname/username (never password or privateKey)
5. Returns sanitized error if operation fails

**Your SSH credentials are:**
- ✅ Transmitted over HTTPS only
- ✅ Never stored in database, browser storage, or cookies
- ✅ Garbage-collected after each operation
- ❌ NOT cached — you'll need to re-enter them on page reload

**Rate limiting:** 10 SSH-related requests per 5 minutes per IP. If you exceed this limit, you'll see "Too many SSH requests" error — wait 5 minutes or contact admin.

See [`SECURITY_AUDIT_SSH.md`](SECURITY_AUDIT_SSH.md) for the comprehensive audit.

**Requirements:**
- `sudo` with NOPASSWD in `/etc/sudoers`
- Or root SSH access (root has passwordless sudo by default)

### Install NetBird

1. Open node detail
2. Scroll to **"NetBird"** section
3. Enter:
   - **Setup Key** from NetBird dashboard
   - **Management URL** (optional, for self-hosted)
   - **Hostname** in mesh network (optional)
4. Click **"🚀 Install & Connect"**

After success, node has a mesh IP (e.g., `100.64.0.5`).

### Uninstall NetBird

1. Open node detail → NetBird section
2. Click **"🗑️ Uninstall"**
3. Confirm

---

## 🔒 Wildcard SSL via Cloudflare

### Prerequisites

1. **Domain added to Cloudflare** (free tier is sufficient)
2. **API Token** with permissions:
   - `Zone:DNS:Edit` — create/delete TXT records
   - `Zone:Zone:Read` — find zone_id

Create token at: https://dash.cloudflare.com/profile/api-tokens
Use template: **"Edit zone DNS"**

### Get a Wildcard Certificate

1. Open panel → **SSL Certificates** page
2. Click **"+ Get wildcard"**
3. Enter Cloudflare API Token
4. Click **"🔑 Test token"** — verifies and shows available domains
5. Select domain from list (or type manually)
6. Enter email for Let's Encrypt
7. Optionally enable **Staging** (for testing)
8. Click **"🔒 Get wildcard certificate"**

**Process:**
1. ACME account created on Let's Encrypt
2. CSR generated for `*.example.com`
3. TXT record `_acme-challenge.example.com` created via Cloudflare
4. DNS-01 challenge validated
5. Certificate and private key saved to `/opt/mtproto-suite/ssl/wildcard/`
6. TXT record deleted

**Result:**
```
✓ Certificate obtained successfully!

Valid until: 2026-10-04 (90 days)
Certificate: /opt/mtproto-suite/ssl/wildcard/example_com.cert.pem
Private key: /opt/mtproto-suite/ssl/wildcard/example_com.key.pem
```

### Using the Wildcard Certificate

**For nginx:**
```nginx
ssl_certificate /opt/mtproto-suite/ssl/wildcard/example_com.cert.pem;
ssl_certificate_key /opt/mtproto-suite/ssl/wildcard/example_com.key.pem;
```

**For service-nodes:**
```bash
# Copy to node
scp /opt/mtproto-suite/ssl/wildcard/example_com.* root@node1:/opt/mtproto-suite/ssl/

# Use for SNI masking
```

### Auto-Renewal

Let's Encrypt certificates are valid for 90 days. Set up cron auto-renewal:

```bash
# Edit crontab
crontab -e

# Add this line (renews weekly, only if expiring soon)
0 3 * * 1 cd /opt/mtproto-suite/ssl/wildcard && \
  bash /opt/mtproto-suite/install.sh --ssl-renew example.com
```

---

## 🛡️ VLESS/Reality VPN

### What It Does

VLESS/Reality is a censorship-resistant VPN protocol. In MTProto Suite:

**Without VPN:**
```
Client → Service-node:443 → Telegram DC
```

**With VPN (hybrid mode):**
```
Client → Service-node:443 → xray (SOCKS5) → VLESS server → Telegram DC
                              ↑
                              ME traffic via tun0 → EU IP (bypasses RKN)
```

### Setup

**1. Get a VLESS subscription:**

From your VPN provider (e.g., 3x-ui, x-ui, marzban), get either:
- **Subscription URL**: `https://provider.com/sub/abc123`
- **Raw vless:// link**: `vless://uuid@host:port?...`

**2. Configure proxy:**

1. Open panel → Nodes → Create/Edit proxy
2. Scroll to **"VPN"** section
3. Paste subscription URL or vless:// link
4. (Optional) Set **NAT_IP** = public IP of your VPN exit server
5. Click **"Save"**

Panel will:
1. Download and parse VLESS config
2. Create xray container with that config
3. Configure telemt to use it as upstream SOCKS5 proxy
4. Restart telemt container

### Supported Transports

| Transport | Use case |
|---|---|
| `tcp` | Direct TCP (least resistance to DPI) |
| `ws` | WebSocket (good camouflage) |
| `grpc` | gRPC (modern, harder to detect) |
| `xhttp` | XHTTP (newest, best camouflage) |

### Modes

**Hybrid mode** (NAT_IP + VLESS):
- ME traffic: direct via host routing → tunnel → EU IP
- DC traffic: via xray SOCKS5 → VLESS → Telegram DC

**Legacy mode** (VLESS only):
- ME traffic: direct
- DC traffic: via xray SOCKS5

**Simple mode** (NAT_IP only):
- All traffic: direct via tun0 → EU IP
- Use when you have a VPN tunnel but no VLESS

---

## 📦 Bulk Operations

### Export All Proxies from Node

```bash
# Via API
curl -fsS http://node:8443/api/export \
  -H "Authorization: Bearer <token>" \
  > proxies-export.json

# Via UI: node detail → Export button
```

### Import to Another Node

```bash
# Via UI: target node → Import → upload file
```

Import behavior:
- Each proxy in the file is created on the target node
- Errors are collected and shown at the end
- Partial success is possible

### Backup Strategy

```bash
# Daily backup of all nodes
for node in $(cat nodes.txt); do
  ssh root@$node "cd /opt/mtproto-suite && \
    tar czf /backup/node-\$(date +%Y%m%d).tar.gz \
      service-node/data service-node/.env"
done
```

---

## 📅 Daily Operations

### Check Health

```bash
# All nodes at once
for node in $(cat nodes.txt); do
  echo "=== $node ==="
  curl -fsS http://$node:8443/api/health \
    -H "Authorization: Bearer $(cat token-$node)" \
    | jq .
done
```

### Update All Proxies

```bash
# Update specific proxy
curl -X PUT http://panel/api/nodes/1/proxies/abc123 \
  -H "Authorization: Bearer $(cat jwt)" \
  -H "Content-Type: application/json" \
  -d '{"maxConnections": 100}'
```

### Pause Problematic Proxies

```bash
# Pause all proxies with high connection count
curl http://panel/api/proxies/all \
  -H "Authorization: Bearer $(cat jwt)" | \
  jq '.[] | .proxies[] | select(.connectedIps | length > 50) | .id' | \
  while read id; do
    curl -X POST http://panel/api/nodes/1/proxies/$id/pause \
      -H "Authorization: Bearer $(cat jwt)"
  done
```

### Monitor via API

```bash
# Real-time metrics
watch -n 5 'curl -fsS http://node:8443/api/proxies \
  -H "Authorization: Bearer $(cat token)" \
  | jq ".[] | {name, status, connectedIps: (.connectedIps | length)}"'
```

---

## 🔍 Common Tasks

### Find Proxy by Domain

```bash
curl -fsS http://node:8443/api/proxies \
  -H "Authorization: Bearer $(cat token)" | \
  jq '.[] | select(.domain == "google.com")'
```

### Get tg:// Link

```bash
curl -fsS "http://node:8443/api/proxies/abc123/link?server_ip=proxy.example.com" \
  -H "Authorization: Bearer $(cat token)"
# Returns: {"link": "tg://proxy?server=proxy.example.com&port=443&secret=..."}
```

### Export Proxy Configuration

```bash
# Single proxy config
curl -fsS http://node:8443/api/proxies/abc123 \
  -H "Authorization: Bearer $(cat token)" | jq .
```

### Rotate IP Blacklist

```bash
# Get current blacklist
curl http://node:8443/api/blacklist \
  -H "Authorization: Bearer $(cat token)"

# Update blacklist
curl -X PUT http://node:8443/api/blacklist \
  -H "Authorization: Bearer $(cat token)" \
  -H "Content-Type: application/json" \
  -d '{"ips": ["1.2.3.4", "5.6.7.8"]}'
```

### Change Custom Domains

```bash
curl -X PUT http://node:8443/api/domains \
  -H "Authorization: Bearer $(cat token)" \
  -H "Content-Type: application/json" \
  -d '{"domains": ["google.com", "microsoft.com", "apple.com"]}'
```

---

## 🆘 Getting Help

If you encounter issues:
1. Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
2. View logs: `docker compose logs -f`
3. Open an issue with logs and reproduction steps
4. Include environment details (OS, Docker version, panel/node version)
