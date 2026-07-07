# Migration Guide

How to migrate from the original `danielVNru/mtproto-panel` and `danielVNru/mtproto-node` to MTProto Suite v2.0.

[🇷🇺 Русская версия](MIGRATION.ru.md)

## 📋 Table of Contents

- [Overview](#-overview)
- [Compatibility](#-compatibility)
- [Pre-Migration Checklist](#-pre-migration-checklist)
- [Migration Strategies](#-migration-strategies)
- [Step-by-Step Migration](#-step-by-step-migration)
- [Data Migration](#-data-migration)
- [Post-Migration Verification](#-post-migration-verification)
- [Rollback Plan](#-rollback-plan)
- [API Changes](#-api-changes)

---

## 🌟 Overview

MTProto Suite v2.0 is a **drop-in replacement** for the original two-repo setup:

- ✅ All proxy configurations are compatible
- ✅ All node configurations are compatible
- ✅ API endpoints are backward-compatible
- ✅ Data formats (JSON store, env files) are preserved
- ⚠️ Some new features require migration of secrets (JWT_SECRET)

**Migration time:** 15-30 minutes per server (panel + each node)

**Downtime:** ~5 minutes per server (container restart)

---

## ✅ Compatibility

### What Works Without Changes

| Component | Compatibility |
|---|---|
| Proxy configs (`store.json`) | ✅ Same format |
| Custom domains | ✅ Same format |
| IP blacklist | ✅ Same format |
| nginx config generation | ✅ Same algorithm |
| xray/VLESS configs | ✅ Same format |
| telemt configs | ✅ Same format |
| Statistics history | ✅ Same format |
| IP history | ✅ Same format |
| Service node API endpoints | ✅ 100% compatible |
| Panel API endpoints | ✅ 100% compatible (deprecated endpoints still work) |

### What Needs Manual Update

| Component | Reason | Action |
|---|---|---|
| `JWT_SECRET` | No default in v2.0 | Generate new or copy from old |
| `DB_PASSWORD` | No default in v2.0 | Generate new or copy from old |
| Admin password | Hashed with bcrypt cost 12 | Reset via install or env var |
| Node `AUTH_TOKEN` | Was optional in v1.x | Required, min 16 chars |
| Container names | Now use stable prefixes | Auto-migrated on startup |
| Data directory | Was `./data` in node root | Now `service-node/data` (path change) |
| `PANEL_FRONTEND_URL` | NEW in v2.0.0 | Set to your panel HTTPS domain for CORS whitelist |

### What Will Be Replaced

| Old Repo | New Location |
|---|---|
| `danielVNru/mtproto-panel` | `mtproto-suite/` (panel-backend, panel-frontend) |
| `danielVNru/mtproto-node` | `mtproto-suite/service-node/` |

---

## ✅ Pre-Migration Checklist

### Before Starting

- [ ] **Backup current installation**
  ```bash
  # Panel backup
  cp -r /opt/mtproto-panel /opt/mtproto-panel.bak
  
  # Each node backup
  ssh root@node1 "cp -r /opt/mtproto-node /opt/mtproto-node.bak"
  ```

- [ ] **Backup PostgreSQL data**
  ```bash
  cd /opt/mtproto-panel
  docker compose exec db pg_dump -U mtproto mtproto_panel > /backup/panel-db-$(date +%Y%m%d).sql
  ```

- [ ] **Backup secrets**
  ```bash
  # Panel .env
  cp /opt/mtproto-panel/.env /backup/panel.env
  
  # Each node .env
  ssh root@node1 "cp /opt/mtproto-node/.env /backup/node1.env"
  ```

- [ ] **Backup proxy data**
  ```bash
  # From each node
  ssh root@node1 "tar czf /backup/node1-data.tar.gz /opt/mtproto-node/data"
  
  # Or use built-in export
  curl -fsS http://node1:8443/api/export \
    -H "Authorization: Bearer $(cat /backup/node1-token)" \
    > /backup/node1-proxies.json
  ```

- [ ] **Document current state**
  ```bash
  # Note down:
  # - Admin URL and credentials
  # - Number of nodes
  # - Number of proxies per node
  # - Active VLESS subscriptions
  ```

- [ ] **Schedule maintenance window**
  - Panel: 30 minutes downtime acceptable
  - Each node: 5 minutes per node (proxies restart)
  - Best time: low-traffic hours

- [ ] **Test on non-production first**
  - Spin up test instance
  - Restore backup data
  - Verify all features work

---

## 🔄 Migration Strategies

### Strategy 1: In-Place Upgrade (Recommended)

**Best for:** Small deployments (1-10 nodes)

**Pros:** Simple, fast, no IP changes
**Cons:** Some downtime, must work in-place

```bash
# On panel host
cd /opt/mtproto-panel
docker compose down

# Backup .env files
cp .env /backup/old-panel.env
cp panel-backend/.env /backup/old-backend.env  # if exists

# Clone new repo alongside
cd /opt
git clone https://github.com/mtproto-suite/mtproto-suite.git mtproto-suite-new

# Build new images
cd mtproto-suite-new
cd shared && npm install && npm run build && cd ..
cd panel-backend && npm install && npm run build && cd ..
cd panel-frontend && npm install && npm run build && cd ..

# Migrate data (see Data Migration section below)

# Stop old, start new
docker compose down -v
cd /opt/mtproto-suite-new
docker compose up -d --build
```

### Strategy 2: Side-by-Side (Safer)

**Best for:** Production with zero-downtime requirement

**Pros:** Can rollback instantly, A/B test
**Cons:** Requires extra resources, port conflicts

```bash
# Install MTProto Suite on different ports
bash install.sh --mode=panel --install-dir=/opt/mtproto-suite-v2
# Use port 8080 (different from old 80)

# Migrate data
# Test new instance with old data

# Switch DNS / load balancer when ready
```

### Strategy 3: Fresh Install

**Best for:** Greenfield deployment, learning the system

**Pros:** Clean slate, no legacy issues
**Cons:** Manual proxy recreation required

```bash
# Install new
bash install.sh --mode=panel

# Manually recreate each proxy via UI
# Or import from old export files (see below)
```

---

## 📝 Step-by-Step Migration

### Step 1: Stop Old Services

**On panel host:**
```bash
cd /opt/mtproto-panel
docker compose down  # Stops containers, preserves volumes
```

**On each node:**
```bash
# Stop only the API service (proxies keep running for now)
# Or stop everything for maintenance window:
cd /opt/mtproto-node
docker compose down
```

### Step 2: Install MTProto Suite

**On panel host:**
```bash
bash <(wget -qO- https://raw.githubusercontent.com/mtproto-suite/mtproto-suite/master/install.sh) --mode=panel
```

When prompted, **use the SAME port** as the old installation (or different if you want side-by-side).

### Step 3: Migrate Database (Panel)

**Option A: Restore from SQL dump**

```bash
# Stop new panel DB
cd /opt/mtproto-suite
docker compose stop db

# Restore old database
docker compose exec -T db dropdb -U mtproto mtproto_panel
docker compose exec -T db createdb -U mtproto mtproto_panel
cat /backup/panel-db-20260706.sql | docker compose exec -T db psql -U mtproto -d mtproto_panel

# Restart
docker compose start db
```

**Option B: Migrate manually**

If the schema differs significantly, migrate manually:

```bash
# Export from old
cd /opt/mtproto-panel.bak
docker compose up -d db
docker compose exec db pg_dump -U mtproto mtproto_panel --data-only > /tmp/old-data.sql

# Import to new
cd /opt/mtproto-suite
# The new migrations will add the new columns (ssl_certificates, etc.)
# Restore data (ignore errors for incompatible rows)
cat /tmp/old-data.sql | docker compose exec -T db psql -U mtproto -d mtproto_panel

# Verify
docker compose exec db psql -U mtproto -d mtproto_panel -c "SELECT COUNT(*) FROM nodes;"
```

### Step 4: Migrate Node Data

**Option A: Copy data directory**

```bash
# On each node, after stopping old service:
cd /opt/mtproto-node
cp -r data /backup/data.bak  # Backup

# Install MTProto Suite
bash <(wget -qO- https://raw.githubusercontent.com/mtproto-suite/mtproto-suite/master/install.sh) --mode=node

# Copy old data to new location
cp -r /backup/data.bak/* /opt/mtproto-suite/service-node/data/

# Use the same AUTH_TOKEN
grep AUTH_TOKEN /backup/node.env > /opt/mtproto-suite/service-node/.env.tmp
# Edit service-node/.env and set AUTH_TOKEN from old

# Restart
cd /opt/mtproto-suite/service-node
docker compose restart
```

**Option B: Use built-in export/import**

```bash
# From old node
curl -fsS http://node-old:8443/api/export \
  -H "Authorization: Bearer $(cat /backup/old-token)" \
  > /tmp/proxies.json

# On new node (via panel)
# 1. Add new node in panel
# 2. Open node detail
# 3. Click "Import" → upload /tmp/proxies.json

# Note: This recreates proxies (new container IDs)
# Stats history and IP history are NOT transferred
```

### Step 5: Update Panel Configuration

```bash
# Edit /opt/mtproto-suite/panel-backend/.env
# Match values from old /opt/mtproto-panel/.env:

# Copy JWT_SECRET (so existing user tokens keep working)
JWT_SECRET=<old-value>

# Copy DB credentials (if you want to reuse old DB)
DB_PASSWORD=<old-value>

# Admin user is automatically updated to ADMIN_PASSWORD from env
# If you want to reuse old password:
ADMIN_PASSWORD=<old-admin-password>
```

### Step 6: Start New Services

```bash
# On panel host
cd /opt/mtproto-suite
docker compose up -d

# On each node
cd /opt/mtproto-suite/service-node
docker compose up -d
```

### Step 7: Verify and Test

```bash
# Panel health
curl -fsS http://panel:80/api/health

# Each node health (from panel)
curl -fsS http://node:8443/api/health \
  -H "Authorization: Bearer $(cat /opt/mtproto-suite/service-node/.env | grep AUTH_TOKEN | cut -d= -f2)"

# Login to panel UI and verify all nodes are listed
# Open browser: http://panel:80
```

---

## 💾 Data Migration Details

### Panel Data

**Users table:**
```sql
-- Old users still work (bcrypt-hashed passwords compatible)
-- Only password_hash needs to be present
-- No manual action needed if DB_PASSWORD was reused
```

**Nodes table:**
```sql
-- Same schema in v2.0 (just adds domain column if missing)
-- Migration runs `ALTER TABLE nodes ADD COLUMN IF NOT EXISTS domain`
```

**New tables (auto-created):**
- `proxy_overrides`
- `ssl_certificates`
- `cloudflare_credentials`
- `node_metrics_history`
- `netbird_status`

### Node Data

**`store.json`** — same format, drop-in compatible.

**`stats-history.json`** — same format.

**`ip-history.json`** — same format.

**Container state:**
- All existing containers will be detected by name prefix
- Containers with old names (`mtproto-proxy-X` → still work due to name matching)
- Containers with new names will be created fresh

### Network State

**Docker network `mtproto-net`:**
- Created by new installer
- Same name, same subnet
- Existing containers automatically reconnected

---

## 🔌 API Changes

### Deprecated Endpoints (Still Work)

These endpoints work but show deprecation warnings:

| Old Endpoint | New Endpoint |
|---|---|
| `GET /api/system/stats` | `POST /api/nodes/:id/metrics` |
| `GET /api/proxies/stats/all` | `GET /api/proxies/all` (extended) |

### New Endpoints

| Endpoint | Description |
|---|---|
| `POST /api/remote-install/test-ssh` | Test SSH connection |
| `POST /api/remote-install/node` | Install service-node remotely |
| `POST /api/nodes/:id/metrics` | Collect metrics |
| `GET /api/nodes/:id/metrics/history` | Metrics history |
| `POST /api/nodes/:id/system-info` | OS info |
| `POST /api/nodes/:id/docker-stats` | Docker stats |
| `POST /api/nodes/:id/restart-service` | Restart service |
| `POST /api/nodes/:id/reboot` | Reboot server |
| `POST /api/nodes/:id/netbird/install` | Install NetBird |
| `GET /api/nodes/:id/netbird/cached-status` | NetBird status (cached) |
| `POST /api/ssl/cloudflare/test` | Test Cloudflare token |
| `POST /api/ssl/wildcard/obtain` | Get wildcard cert |
| `GET /api/ssl/wildcard/status` | List certs |
| `POST /api/ssl/zones` | List Cloudflare zones |

### Response Format Changes

| Aspect | Old | New |
|---|---|---|
| Error format | `{ message: '...' }` | `{ error: '...' }` |
| Timestamps | ISO string | ISO string (same) |
| IDs | Number | String (UUID-based) |

**Migration impact:** If you have scripts using `response.message`, update to `response.error`.

---

## ✅ Post-Migration Verification

### Checklist

- [ ] **Panel accessible** at expected URL
- [ ] **Login works** with old admin credentials
- [ ] **All nodes listed** in panel
- [ ] **Node health checks pass** (green dots)
- [ ] **Proxies listed** with correct count per node
- [ ] **tg:// links** still work (test with Telegram)
- [ ] **Statistics collection** working (check stats after 5 min)
- [ ] **No errors in logs** (`docker compose logs`)
- [ ] **Backup new installation** (`cp -r /opt/mtproto-suite /opt/mtproto-suite.bak`)

### Commands to Verify

```bash
# Panel: list all nodes with health
curl -fsS http://panel/api/proxies/all \
  -H "Authorization: Bearer $(cat jwt)" | \
  jq '.[] | {node: .nodeName, online: .online, proxies: (.proxies | length)}'

# Should show: all nodes online, correct proxy count

# Node: check each container is running
docker ps --filter "name=mtproto-" --format "table {{.Names}}\t{{.Status}}"

# Should show: mtproto-nginx (Up), mtproto-proxy-* (Up), etc.

# Test proxy connection from outside
# Open Telegram, paste tg:// link, verify connection
```

### Monitor for Issues

After migration, monitor for 24 hours:

```bash
# Watch panel logs
cd /opt/mtproto-suite
docker compose logs -f

# Watch node logs
ssh root@node1 "cd /opt/mtproto-suite/service-node && docker compose logs -f"
```

Watch for:
- ✅ Proxies accepting connections (check via Telegram)
- ✅ No crash loops in containers
- ✅ Statistics being collected every 5 min
- ⚠️ SSH connection issues (network changes)
- ⚠️ Memory leaks (compare baseline metrics)

---

## ⏪ Rollback Plan

If migration fails:

### Quick Rollback (5 minutes)

```bash
# Stop new installation
cd /opt/mtproto-suite
docker compose down

# Start old installation
cd /opt/mtproto-panel
docker compose up -d

# Verify
curl -fsS http://panel/api/health
```

### Full Rollback (15 minutes)

```bash
# Restore from backups
cd /
rm -rf /opt/mtproto-suite
mv /opt/mtproto-panel.bak /opt/mtproto-panel

# Restore DB
cd /opt/mtproto-panel
docker compose up -d db
cat /backup/panel-db-20260706.sql | docker compose exec -T db psql -U mtproto -d mtproto_panel

# Restore node data
ssh root@node1 "rm -rf /opt/mtproto-node; mv /opt/mtproto-node.bak /opt/mtproto-node"
ssh root@node1 "cd /opt/mtproto-node && docker compose up -d"

# Verify old panel
# Open browser, test
```

### Rollback Considerations

- **Proxies will have new container IDs** (even if you rollback, proxy configs in DB need re-import)
- **Statistics history is preserved** in JSON files (just copy back)
- **IP history is preserved** (just copy back)
- **JWT tokens issued in new panel become invalid** in old panel (users re-login)

---

## 🤔 Common Migration Issues

### Issue: JWT_SECRET mismatch causes existing users to be logged out

**Solution:**
```bash
# Copy old JWT_SECRET to new
grep '^JWT_SECRET=' /backup/old-panel.env
# Edit /opt/mtproto-suite/panel-backend/.env
# Set JWT_SECRET to same value
docker compose restart backend
# Users don't need to re-login
```

### Issue: DB_PASSWORD changed, panel can't connect to DB

**Solution:**
```bash
# Option A: Reuse old DB_PASSWORD
grep '^DB_PASSWORD=' /backup/old-panel.env
# Update /opt/mtproto-suite/panel-backend/.env AND docker-compose.yml

# Option B: Restore old DB to new container
docker compose exec db psql -U mtproto -d mtproto_panel -c "ALTER USER mtproto WITH PASSWORD 'old-password';"
```

### Issue: AUTH_TOKEN mismatch between panel DB and node

**Solution:**
```bash
# Update in panel UI:
# Nodes → Edit → New token

# OR via API:
curl -X PUT http://panel/api/nodes/1 \
  -H "Authorization: Bearer $(cat jwt)" \
  -H "Content-Type: application/json" \
  -d '{"token": "actual-token-from-node"}'
```

### Issue: Proxy containers have old names and don't appear in new system

**Solution:**
```bash
# Recreate containers with new naming convention
# On node, for each old container:
docker stop <old-container>
docker rm <old-container>

# Trigger recreation via panel:
# Node detail → Click on proxy → "Restart"
```

### Issue: nginx config not reloaded after migration

**Solution:**
```bash
# On node
cd /opt/mtproto-suite/service-node
docker exec mtproto-nginx nginx -s reload

# Or recreate container
docker compose restart mtproto-nginx
```

---

## 📞 Getting Help

If you encounter issues during migration:

1. **Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md)** for common issues
2. **Search existing issues**: https://github.com/mtproto-suite/mtproto-suite/issues
3. **Open new issue** with:
   - Old version (panel v1.x.x, node v1.x.x)
   - New version (v2.0.0)
   - Step where stuck
   - Full error output
   - Backup files available

---

## 🎉 Post-Migration Benefits

After successful migration, you'll have:

✅ **Better security** — JWT_SECRET required, timingSafeEqual, validation
✅ **Better monitoring** — CPU/RAM/Disk graphs, real-time metrics
✅ **Better management** — Remote install, NetBird mesh, wildcard SSL
✅ **Better performance** — Async I/O, atomic writes, caching
✅ **Active development** — Regular updates, security patches
✅ **Unified project** — One repo, shared types, easier upgrades
