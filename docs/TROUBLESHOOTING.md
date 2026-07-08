# Troubleshooting Guide

Common issues, solutions, and debugging tips for MTProto Suite.

[🇷🇺 Русская версия](TROUBLESHOOTING.ru.md)

## 📋 Table of Contents

- [Diagnostic Tools](#-diagnostic-tools)
- [Installation Issues](#-installation-issues)
- [Runtime Issues](#-runtime-issues)
- [Network Issues](#-network-issues)
- [Proxy Issues](#-proxy-issues)
- [Performance Issues](#-performance-issues)
- [SSL Issues](#-ssl-issues)
- [Data Recovery](#-data-recovery)

---

## 🔍 Diagnostic Tools

### Essential Commands

```bash
# Docker status
docker ps                    # Running containers
docker ps -a                 # All containers (including stopped)
docker logs <container>      # Logs of specific container
docker logs --tail 100 -f    # Follow last 100 lines
docker stats                 # Resource usage

# Docker compose
docker compose ps            # Services status
docker compose logs          # All services logs
docker compose logs -f backend  # Follow backend logs
docker compose exec backend sh  # Shell into backend container

# Network
netstat -tlnp                # Listening ports
ss -tlnp                     # Modern alternative
curl -v <url>                # Verbose HTTP request
nc -zv <host> <port>         # Test TCP connection
traceroute <host>            # Network path
```

### Health Checks

```bash
# Panel health
curl -fsS http://localhost:80/api/health
echo "Exit code: $?"  # 0 = healthy

# Node health
curl -fsS http://localhost:8443/api/health \
  -H "Authorization: Bearer $(grep AUTH_TOKEN /opt/mtproto-suite/service-node/.env | cut -d= -f2)"
echo "Exit code: $?"

# Docker health
docker inspect --format='{{.State.Health.Status}}' <container>
```

### Log Locations

| Service | Log Location |
|---|---|
| Panel frontend | `docker compose logs frontend` (stdout) |
| Panel backend | `docker compose logs backend` (stdout) |
| PostgreSQL | `docker compose logs db` (stdout) |
| Service node | `docker compose logs service-node` (stdout) |
| telemt proxy | `docker logs mtproto-proxy-abc123` |
| nginx | `docker logs mtproto-nginx` |
| xray (VPN) | `docker logs mtproto-xray-abc123` |

---

## 🔧 Installation Issues

### Issue: "Docker not found" after installation

**Symptoms:** After `install.sh`, `docker` command not found.

**Solution:**
```bash
# Reinstall Docker manually
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Verify
docker version
```

### Issue: "Permission denied" when running Docker

**Symptoms:** `docker ps` returns "permission denied" or "dial unix /var/run/docker.sock: connect: permission denied".

**Solution:**
```bash
# Add current user to docker group
usermod -aG docker $USER
newgrp docker

# Or run as root
sudo docker ps
```

### Issue: Installer exits with "Unsupported architecture"

**Symptoms:** "Unsupported architecture: armv7l" (32-bit ARM).

**Solution:** Only x86_64 and aarch64 (64-bit ARM) are supported.
Use a 64-bit OS:
```bash
uname -m   # Check architecture
# Should show: x86_64 or aarch64
```

### Issue: "Port already in use"

**Symptoms:** "Error response from daemon: Ports are not available: 80: bind: address already in use"

**Solution:**
```bash
# Find what's using port 80
lsof -i :80
# Or
ss -tlnp | grep :80

# Stop conflicting service
systemctl stop apache2  # or nginx, httpd, etc.

# Or choose different port during install
bash install.sh --mode=panel
# Enter 8080 when prompted for port
```

### Issue: Git clone fails

**Symptoms:** "fatal: unable to access 'https://github.com/...'"

**Solution:**
```bash
# Test GitHub connectivity
curl -fsS https://github.com
curl -fsS https://api.github.com

# If behind proxy
git config --global http.proxy http://proxy:8080
git config --global https.proxy https://proxy:8080

# Or use SSH
git config --global url."git@github.com:".insteadOf "https://github.com/"
```

---

## 🚀 Runtime Issues

### Issue: Panel container keeps restarting

**Symptoms:** `docker ps` shows `mtproto-panel-backend` restarting every few seconds.

**Solution:**
```bash
# Check logs
docker compose logs --tail=100 backend

# Common causes:
# 1. JWT_SECRET not set
echo $JWT_SECRET  # Should not be empty

# 2. DB_PASSWORD wrong
grep DB_PASSWORD panel-backend/.env

# 3. PostgreSQL not ready
docker compose logs db
# Wait for "database system is ready to accept connections"
```

### Issue: "AUTH_TOKEN environment variable is not set"

**Symptoms:** Service node refuses to start.

**Solution:**
```bash
# Check .env file
cat /opt/mtproto-suite/service-node/.env

# Should contain:
# AUTH_TOKEN=<64-char-hex>

# Generate new token
openssl rand -hex 32

# Restart
cd /opt/mtproto-suite/service-node
docker compose restart
```

### Issue: "Cannot connect to Docker daemon"

**Symptoms:** Service node logs show Docker connection errors.

**Solution:**
```bash
# Check Docker socket
ls -la /var/run/docker.sock
# Should exist with rw-rw---- root docker

# If missing, restart Docker
systemctl restart docker

# Verify
docker ps
```

### Issue: Out of disk space

**Symptoms:** Containers fail to start with "no space left on device".

**Solution:**
```bash
# Check disk usage
df -h
docker system df

# Clean up Docker
docker system prune -a    # Remove unused images/containers
docker volume prune       # Remove unused volumes

# Clean up old logs
find /var/lib/docker/containers/*/*-json.log -size +100M -delete
```

### Issue: Out of memory

**Symptoms:** Containers killed with OOMKilled status.

**Solution:**
```bash
# Check memory
free -h
docker stats --no-stream

# Identify which container
docker ps -a
docker inspect <container> | grep -i oom

# Increase container memory limit (docker-compose.yml)
services:
  backend:
    deploy:
      resources:
        limits:
          memory: 1G

# Or reduce proxy count per node
```

---

## 🌐 Network Issues

### Issue: Panel cannot reach node

**Symptoms:** `Failed to connect to node: connect ECONNREFUSED` or timeout.

**Solution:**
```bash
# Test connectivity from panel host to node
nc -zv <node-ip> 8443
# Expected: succeeded

# If failed, check firewall on node
ssh root@<node-ip> "ufw status"
# Or
ssh root@<node-ip> "iptables -L -n"

# Allow port 8443 (Ubuntu/Debian)
ssh root@<node-ip> "ufw allow from <panel-ip> to any port 8443"

# Allow port 8443 (CentOS/RHEL)
ssh root@<node-ip> "firewall-cmd --permanent --add-port=8443/tcp"
ssh root@<node-ip> "firewall-cmd --reload"

# Check if service is actually listening
ssh root@<node-ip> "ss -tlnp | grep 8443"
# Should show: 0.0.0.0:8443 (LISTEN)
```

### Issue: Node proxy port (443) not accessible

**Symptoms:** Telegram clients cannot connect, `nc -zv <node> 443` fails.

**Solution:**
```bash
# Check if nginx container is running
docker ps | grep mtproto-nginx
# Should be running

# Check nginx logs
docker logs mtproto-nginx --tail 50

# Check firewall
ufw status | grep 443

# Allow if missing
ufw allow 443/tcp

# Check if port is actually bound
ss -tlnp | grep 443
```

### Issue: DNS resolution fails

**Symptoms:** "getaddrinfo ENOTFOUND" errors.

**Solution:**
```bash
# Test DNS
nslookup google.com
# Or
dig google.com

# Check Docker DNS
docker run --rm alpine nslookup google.com

# Configure DNS in docker-compose.yml
services:
  service-node:
    dns:
      - 8.8.8.8
      - 1.1.1.1
```

### Issue: WebSocket connection fails

**Symptoms:** Browser shows "WebSocket connection failed".

**Solution:**
```bash
# Check if nginx proxies WebSocket correctly
# In panel-frontend/nginx.conf:
location /api/ {
    proxy_pass http://backend:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
}

# Restart nginx
docker compose restart frontend
```

### Issue: "CORS: origin not allowed" in browser console

**Symptoms:** Browser console shows CORS error when trying to access panel API. Panel API requests from frontend fail.

**Solution:**

The panel uses a CORS whitelist via `PANEL_FRONTEND_URL` environment variable. Add your panel's origin to the whitelist:

```bash
# Edit panel-backend/.env
PANEL_FRONTEND_URL=https://panel.example.com,https://www.panel.example.com
```

Or for development:

```bash
PANEL_FRONTEND_URL=http://localhost:5173,http://localhost:80
```

Then restart the panel:

```bash
docker compose restart panel-backend
```

**Verify:**

```bash
# Check logs for blocked CORS requests
docker logs mtproto-panel-backend 2>&1 | grep '"category":"cors"'
```

You should see logs like:
```
{"level":"warn","category":"cors","message":"Blocked CORS request from origin: https://evil.com"}
```

If your origin is in the whitelist, requests will succeed normally.

### Issue: "Too many requests" (HTTP 429) when using panel

**Symptoms:** API calls return HTTP 429 with `{"error": "Too many requests"}`.

**Solution:**

Rate limiting is enforced via `express-rate-limit`. If you're hitting the limits during legitimate use:

| Endpoint | Limit | Possible Cause |
|---|---|---|
| Global | 200 req/min | Too many metrics requests with short polling interval |
| `/api/auth/login` | 10 attempts per 15 min | Brute-force protection triggered (or shared NAT IP) |
| SSH endpoints | 10 req per 5 min | Auto-refresh metrics too frequently |

**Solutions:**

1. **Increase polling interval** in UI: 30s instead of 5s
2. **Disable auto-refresh** when not actively monitoring
3. **For shared NAT**: deploy separate panel instance per user (future: per-user rate limiting)

For development/testing, you can temporarily relax limits by editing `panel-backend/src/index.ts` (not recommended for production).

---

## 🌐 Proxy Issues

### Issue: Proxy created but tg:// link doesn't work

**Symptoms:** Telegram shows "Invalid proxy" when using the link.

**Solution:**
```bash
# Verify proxy is running
curl -fsS http://node:8443/api/proxies \
  -H "Authorization: Bearer <token>" | \
  jq '.[] | select(.domain == "google.com")'

# Check status field — should be "running"

# Verify secret format
# Should be: ee<secret><domain-hex>
# Example: ee1234567890abcdef...676f6f676c652e636f6d (for google.com)

# Check container logs
docker logs mtproto-proxy-abc123 --tail 20

# Test connection from outside
nc -zv <node-ip> 443
```

### Issue: "ECONNREFUSED" connecting to Telegram DC

**Symptoms:** Proxy container logs show connection errors to Telegram.

**Solution:**
```bash
# Check if Telegram DCs are reachable from node
curl -fsS -m 5 https://149.154.167.50:443
# Expected: TLS handshake success (curl error about cert is OK)

# If failed — node is blocked (common in Russia/China)
# Solutions:
# 1. Use VPN mode (VLESS/Reality) — bypasses blocks
# 2. Use NAT_IP for direct ME traffic via tunnel
# 3. Move node to unblocked country

# Check nginx routing
docker exec mtproto-nginx cat /etc/nginx/nginx.conf | grep -A5 "listen 443"
```

### Issue: High connection drop rate

**Symptoms:** Clients connect but disconnect after a few seconds.

**Solution:**
```bash
# Check telemt logs
docker logs mtproto-proxy-abc123 --tail 100

# Common issues:
# 1. Wrong ad_tag format (should be 32 hex chars)
# 2. CensorshipTlsDomain invalid (must be valid domain)
# 3. fastMode too aggressive (try disabling)

# Try disabling fastMode via API
curl -X PUT http://node:8443/api/proxies/abc123 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"fastMode": false}'
```

### Issue: VLESS VPN not connecting

**Symptoms:** xray container logs show connection errors.

**Solution:**
```bash
# Check xray logs
docker logs mtproto-xray-abc123 --tail 50

# Test VLESS connection manually
# 1. Get vless:// URI from panel
# 2. Use v2ray/xray client to test

# Common issues:
# 1. Wrong setup key (expired or already used)
# 2. Server unreachable
# 3. Wrong UUID format (must be UUID v4)

# Regenerate setup key in NetBird dashboard
# Re-install NetBird on node
```

---

## ⚡ Performance Issues

### Issue: High CPU usage on panel

**Symptoms:** Panel host CPU > 80%.

**Solution:**
```bash
# Identify source
docker stats --no-stream
top -c

# Common causes:
# 1. Too many metrics requests (reduce polling frequency)
# 2. Large proxy count (>1000) — increase CPU
# 3. PostgreSQL slow queries

# Check slow queries
docker exec -it <db-container> psql -U mtproto -d mtproto_panel \
  -c "SELECT query, calls, mean_time FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;"

# Increase polling interval in panel UI
# Or reduce node count per request
```

### Issue: Slow proxy throughput

**Symptoms:** Proxies work but throughput < 1 MB/s.

**Solution:**
```bash
# Check telemt CPU usage per container
docker stats --no-stream | grep mtproto-proxy

# If CPU is bottleneck:
# 1. Reduce proxies per host
# 2. Use more powerful host

# Check network
iperf3 -c <node-ip> -p 5201   # Test bandwidth

# If network bottleneck:
# 1. Check ISP limits
# 2. Use TCP BBR
echo "net.core.default_qdisc=fq" >> /etc/sysctl.conf
echo "net.ipv4.tcp_congestion_control=bbr" >> /etc/sysctl.conf
sysctl -p
```

### Issue: Slow metrics collection

**Symptoms:** `/api/nodes/:id/metrics` takes >5 seconds.

**Solution:**
```bash
# Check SSH latency to node
time ssh root@<node-ip> "uptime"

# If high latency:
# 1. Use NetBird mesh network (lower latency)
# 2. Co-locate panel and nodes in same region

# If SSH is slow (auth latency):
# 1. Use SSH key instead of password
# 2. Disable UseDNS in /etc/ssh/sshd_config
ssh root@<node-ip> "sed -i 's/^#UseDNS yes/UseDNS no/' /etc/ssh/sshd_config"
ssh root@<node-ip> "systemctl restart sshd"
```

### Issue: PostgreSQL slow

**Symptoms:** API requests timeout, `psql` queries slow.

**Solution:**
```bash
# Check current config
docker exec -it <db-container> psql -U mtproto -d mtproto_panel \
  -c "SHOW shared_buffers;"
# Default: 128MB

# Increase (needs container restart with new args)
# docker-compose.yml:
db:
  image: postgres:16-alpine
  command: postgres -c shared_buffers=512MB -c max_connections=200

# Vacuum regularly
docker exec -it <db-container> psql -U mtproto -d mtproto_panel -c "VACUUM ANALYZE;"
```

---

## 🔒 SSL Issues

### Issue: "self-signed certificate" warning

**Symptoms:** Browser shows certificate warning.

**Solution:**
- This is expected with self-signed certs.
- For production, use Let's Encrypt:
```bash
bash install.sh --mode=panel --ssl-letsencrypt your-domain.com
```

### Issue: Let's Encrypt certificate renewal fails

**Symptoms:** Cron job fails, cert expires.

**Solution:**
```bash
# Test renewal manually
certbot renew --dry-run

# Check cert expiration
openssl x509 -enddate -noout -in /etc/letsencrypt/live/<domain>/fullchain.pem

# If renewal fails, check:
# 1. Port 80 is free (certbot needs it)
# 2. DNS A record points to server
# 3. Rate limits not exceeded (5 certs/week per domain)
```

### Issue: Wildcard SSL challenge fails

**Symptoms:** "Challenge validation timeout" when getting wildcard cert.

**Solution:**
```bash
# 1. Verify Cloudflare API token has DNS:Edit permission
curl -fsS https://api.cloudflare.com/client/v4/zones \
  -H "Authorization: Bearer <token>"

# 2. Check TXT record was created
dig TXT _acme-challenge.example.com @8.8.8.8

# 3. Verify domain is on Cloudflare (not just using Cloudflare DNS)
# Domain must be added to Cloudflare account with orange cloud enabled

# 4. Check logs in panel
docker compose logs backend | grep -i cloudflare
```

---

## 💾 Data Recovery

### Issue: Corrupted `store.json` on node

**Symptoms:** Node fails to start, "store.json is corrupted, resetting to empty state" in logs.

**Solution:**
```bash
# Backup the corrupted file first
cp /opt/mtproto-suite/service-node/data/store.json /backup/store.json.corrupted

# Check what's recoverable
cat /backup/store.json.corrupted | jq . 2>&1 | head -50

# If valid JSON, restore
cp /backup/store.json.corrupted /opt/mtproto-suite/service-node/data/store.json
docker compose restart service-node

# If corrupted — node will reset to empty state
# Re-add proxies from panel export (if you have backup)
```

### Issue: PostgreSQL database corruption

**Symptoms:** Panel backend fails to start, DB errors.

**Solution:**
```bash
# Stop panel
cd /opt/mtproto-suite
docker compose stop backend frontend

# Try to recover
docker compose exec db pg_dump -U mtproto mtproto_panel > /backup/dump-$(date +%Y%m%d).sql

# If dump fails, recreate DB
docker compose exec db dropdb -U mtproto mtproto_panel
docker compose exec db createdb -U mtproto mtproto_panel

# Restart (will run migrations)
docker compose up -d

# Restore from backup
cat /backup/dump-pre-corrupt.sql | docker compose exec -T db psql -U mtproto -d mtproto_panel
```

### Issue: Lost admin password

**Solution:**
```bash
# Reset admin password directly in PostgreSQL
docker compose exec db psql -U mtproto -d mtproto_panel -c "
UPDATE users SET password_hash = crypt('new-password', gen_salt('bf', 12))
WHERE username = 'admin';
"

# Or set new password via env var and recreate
cd /opt/mtproto-suite
# Edit panel-backend/.env and set new ADMIN_PASSWORD
docker compose up -d backend  # Will update password on startup
```

---

## 📞 Getting Help

### Before Opening an Issue

1. **Check logs** — `docker compose logs -f`
2. **Search issues** — https://github.com/ns8-support/mtproto-suite/issues
3. **Try the docs** — [INSTALLATION.md](INSTALLATION.md), [CONFIGURATION.md](CONFIGURATION.md)
4. **Reproduce** — can you reproduce the issue consistently?

### Information to Include

When opening an issue, include:

```
**Environment:**
- OS: `cat /etc/os-release`
- Docker: `docker version`
- Panel version: (from UI or `/api/system/version`)
- Node version: (from `/api/health`)

**Steps to reproduce:**
1. ...
2. ...

**Expected behavior:**
...

**Actual behavior:**
...

**Logs:**
```
docker compose logs --tail=100 backend
docker compose logs --tail=100 service-node
```
```

### Community Resources

- GitHub Issues: https://github.com/ns8-support/mtproto-suite/issues
- GitHub Discussions: https://github.com/ns8-support/mtproto-suite/discussions
- Telegram (if exists): TBD

### Emergency Recovery

If everything is broken:

```bash
# 1. Stop everything
cd /opt/mtproto-suite
docker compose down

# 2. Backup data
tar czf /backup/mtproto-emergency-$(date +%Y%m%d).tar.gz \
  panel-backend/.env service-node/.env \
  service-node/data pgdata

# 3. Reinstall fresh
bash install.sh --mode=panel --install-dir=/opt/mtproto-suite-new

# 4. Migrate data
# Copy service-node data and .env from backup to new installation
# Restore PostgreSQL from pg_dump if you have one

# 5. Re-add nodes via panel UI
```
