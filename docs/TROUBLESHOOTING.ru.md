# Руководство по устранению неполадок

Частые проблемы, решения и советы по отладке MTProto Suite.

[🇬🇧 English version](TROUBLESHOOTING.md)

## 📋 Содержание

- [Инструменты диагностики](#-инструменты-диагностики)
- [Проблемы с установкой](#-проблемы-с-установкой)
- [Проблемы во время работы](#-проблемы-во-время-работы)
- [Сетевые проблемы](#-сетевые-проблемы)
- [Проблемы с прокси](#-проблемы-с-прокси)
- [Проблемы с производительностью](#-проблемы-с-производительностью)
- [Проблемы с SSL](#-проблемы-с-ssl)
- [Восстановление данных](#-восстановление-данных)

---

## 🔍 Инструменты диагностики

### Основные команды

```bash
# Статус Docker
docker ps                    # Запущенные контейнеры
docker ps -a                 # Все контейнеры (включая остановленные)
docker logs <container>      # Логи конкретного контейнера
docker logs --tail 100 -f    # Следить за последними 100 строками
docker stats                 # Использование ресурсов

# Docker compose
docker compose ps            # Статус сервисов
docker compose logs          # Логи всех сервисов
docker compose logs -f backend  # Следить за логами backend
docker compose exec backend sh  # Shell внутрь контейнера backend

# Сеть
netstat -tlnp                # Слушающие порты
ss -tlnp                     # Современная альтернатива
curl -v <url>                # Подробный HTTP запрос
nc -zv <хост> <порт>         # Тест TCP соединения
traceroute <хост>            # Сетевой путь
```

### Health checks

```bash
# Здоровье панели
curl -fsS http://localhost:80/api/health
echo "Код выхода: $?"  # 0 = здорова

# Здоровье ноды
curl -fsS http://localhost:8443/api/health \
  -H "Authorization: Bearer $(grep AUTH_TOKEN /opt/mtproto-suite/service-node/.env | cut -d= -f2)"
echo "Код выхода: $?"

# Docker health
docker inspect --format='{{.State.Health.Status}}' <container>
```

### Расположение логов

| Сервис | Расположение логов |
|---|---|
| Панель frontend | `docker compose logs frontend` (stdout) |
| Панель backend | `docker compose logs backend` (stdout) |
| PostgreSQL | `docker compose logs db` (stdout) |
| Service node | `docker compose logs service-node` (stdout) |
| telemt прокси | `docker logs mtproto-proxy-abc123` |
| nginx | `docker logs mtproto-nginx` |
| xray (VPN) | `docker logs mtproto-xray-abc123` |

---

## 🔧 Проблемы с установкой

### Проблема: "Docker не найден" после установки

**Симптомы:** После `install.sh` команда `docker` не найдена.

**Решение:**
```bash
# Переустановить Docker вручную
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Проверить
docker version
```

### Проблема: "Permission denied" при запуске Docker

**Симптомы:** `docker ps` возвращает "permission denied" или "dial unix /var/run/docker.sock: connect: permission denied".

**Решение:**
```bash
# Добавить текущего пользователя в группу docker
usermod -aG docker $USER
newgrp docker

# Или запустить от root
sudo docker ps
```

### Проблема: Установщик завершается с "Unsupported architecture"

**Симптомы:** "Unsupported architecture: armv7l" (32-битный ARM).

**Решение:** Поддерживается только x86_64 и aarch64 (64-битный ARM). Используйте 64-битную ОС:
```bash
uname -m   # Проверить архитектуру
# Должно показать: x86_64 или aarch64
```

### Проблема: "Порт уже используется"

**Симптомы:** "Error response from daemon: Ports are not available: 80: bind: address already in use"

**Решение:**
```bash
# Найти, что использует порт 80
lsof -i :80
# Или
ss -tlnp | grep :80

# Остановить конфликтующий сервис
systemctl stop apache2  # или nginx, httpd и т.д.

# Или выбрать другой порт при установке
bash install.sh --mode=panel
# Введите 8080 когда попросят порт
```

### Проблема: Git clone завершается с ошибкой

**Симптомы:** "fatal: unable to access 'https://github.com/...'"

**Решение:**
```bash
# Проверить связность с GitHub
curl -fsS https://github.com
curl -fsS https://api.github.com

# Если за прокси
git config --global http.proxy http://proxy:8080
git config --global https.proxy https://proxy:8080

# Или используйте SSH
git config --global url."git@github.com:".insteadOf "https://github.com/"
```

---

## 🚀 Проблемы во время работы

### Проблема: Контейнер панели постоянно перезапускается

**Симптомы:** `docker ps` показывает `mtproto-panel-backend` перезапускается каждые несколько секунд.

**Решение:**
```bash
# Проверить логи
docker compose logs --tail=100 backend

# Распространённые причины:
# 1. JWT_SECRET не установлен
echo $JWT_SECRET  # Не должно быть пустым

# 2. DB_PASSWORD неверный
grep DB_PASSWORD panel-backend/.env

# 3. PostgreSQL не готов
docker compose logs db
# Подождите "database system is ready to accept connections"
```

### Проблема: "AUTH_TOKEN environment variable is not set"

**Симптомы:** Service node отказывается запускаться.

**Решение:**
```bash
# Проверить файл .env
cat /opt/mtproto-suite/service-node/.env

# Должно содержать:
# AUTH_TOKEN=<64-char-hex>

# Сгенерировать новый токен
openssl rand -hex 32

# Перезапустить
cd /opt/mtproto-suite/service-node
docker compose restart
```

### Проблема: "Cannot connect to Docker daemon"

**Симптомы:** В логах сервис-ноды ошибки соединения с Docker.

**Решение:**
```bash
# Проверить Docker сокет
ls -la /var/run/docker.sock
# Должен существовать с правами rw-rw---- root docker

# Если отсутствует, перезапустить Docker
systemctl restart docker

# Проверить
docker ps
```

### Проблема: Закончилось место на диске

**Симптомы:** Контейнеры не запускаются с "no space left on device".

**Решение:**
```bash
# Проверить использование диска
df -h
docker system df

# Очистить Docker
docker system prune -a    # Удалить неиспользуемые образы/контейнеры
docker volume prune       # Удалить неиспользуемые volumes

# Очистить старые логи
find /var/lib/docker/containers/*/*-json.log -size +100M -delete
```

### Проблема: Нехватка памяти

**Симптомы:** Контейнеры убиты со статусом OOMKilled.

**Решение:**
```bash
# Проверить память
free -h
docker stats --no-stream

# Определить, какой контейнер
docker ps -a
docker inspect <container> | grep -i oom

# Увеличить лимит памяти контейнера (docker-compose.yml)
services:
  backend:
    deploy:
      resources:
        limits:
          memory: 1G

# Или уменьшить количество прокси на ноду
```

---

## 🌐 Сетевые проблемы

### Проблема: Панель не может подключиться к ноде

**Симптомы:** `Failed to connect to node: connect ECONNREFUSED` или таймаут.

**Решение:**
```bash
# Тест связности с хоста панели до ноды
nc -zv <ip-ноды> 8443
# Ожидается: succeeded

# Если неудачно, проверить firewall на ноде
ssh root@<ip-ноды> "ufw status"
# Или
ssh root@<ip-ноды> "iptables -L -n"

# Разрешить порт 8443 (Ubuntu/Debian)
ssh root@<ip-ноды> "ufw allow from <ip-панели> to any port 8443"

# Разрешить порт 8443 (CentOS/RHEL)
ssh root@<ip-ноды> "firewall-cmd --permanent --add-port=8443/tcp"
ssh root@<ip-ноды> "firewall-cmd --reload"

# Проверить, что сервис действительно слушает
ssh root@<ip-ноды> "ss -tlnp | grep 8443"
# Должно показать: 0.0.0.0:8443 (LISTEN)
```

### Проблема: Порт прокси ноды (443) недоступен

**Симптомы:** Telegram клиенты не могут подключиться, `nc -zv <нода> 443` завершается с ошибкой.

**Решение:**
```bash
# Проверить, работает ли контейнер nginx
docker ps | grep mtproto-nginx
# Должен быть запущен

# Проверить логи nginx
docker logs mtproto-nginx --tail 50

# Проверить firewall
ufw status | grep 443

# Разрешить, если отсутствует
ufw allow 443/tcp

# Проверить, что порт действительно привязан
ss -tlnp | grep 443
```

### Проблема: Сбой DNS резолвинга

**Симптомы:** Ошибки "getaddrinfo ENOTFOUND".

**Решение:**
```bash
# Тест DNS
nslookup google.com
# Или
dig google.com

# Проверить Docker DNS
docker run --rm alpine nslookup google.com

# Настроить DNS в docker-compose.yml
services:
  service-node:
    dns:
      - 8.8.8.8
      - 1.1.1.1
```

### Проблема: WebSocket соединение не работает

**Симптомы:** Браузер показывает "WebSocket connection failed".

**Решение:**
```bash
# Проверить, правильно ли nginx проксирует WebSocket
# В panel-frontend/nginx.conf:
location /api/ {
    proxy_pass http://backend:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
}

# Перезапустить nginx
docker compose restart frontend
```

### Проблема: "CORS: origin not allowed" в консоли браузера

**Симптомы:** Консоль браузера показывает CORS ошибку при попытке доступа к panel API. Запросы frontend к panel API завершаются ошибкой.

**Решение:**

Панель использует CORS whitelist через `PANEL_FRONTEND_URL`. Добавьте origin вашей панели в whitelist:

```bash
# Отредактируйте panel-backend/.env
PANEL_FRONTEND_URL=https://panel.example.com,https://www.panel.example.com
```

Или для разработки:

```bash
PANEL_FRONTEND_URL=http://localhost:5173,http://localhost:80
```

Затем перезапустите панель:

```bash
docker compose restart panel-backend
```

**Проверка:**

```bash
# Проверить логи на заблокированные CORS запросы
docker logs mtproto-panel-backend 2>&1 | grep '"category":"cors"'
```

Вы должны увидеть логи типа:
```
{"level":"warn","category":"cors","message":"Blocked CORS request from origin: https://evil.com"}
```

Если ваш origin в whitelist — запросы будут проходить нормально.

### Проблема: "Too many requests" (HTTP 429) при использовании панели

**Симптомы:** API запросы возвращают HTTP 429 с `{"error": "Too many requests"}`.

**Решение:**

Rate limiting применяется через `express-rate-limit`. Если вы упираетесь в лимиты при легитимном использовании:

| Endpoint | Лимит | Возможная причина |
|---|---|---|
| Глобально | 200 req/min | Слишком частые запросы метрик с коротким интервалом |
| `/api/auth/login` | 10 попыток за 15 мин | Anti-brute-force сработал (или shared NAT IP) |
| SSH endpoints | 10 req за 5 мин | Слишком частый auto-refresh метрик |

**Решения:**

1. **Увеличить интервал polling** в UI: 30s вместо 5s
2. **Отключить auto-refresh** когда активно не мониторите
3. **Для shared NAT**: разверните отдельный instance панели для каждого пользователя (в будущем: per-user rate limiting)

Для разработки/тестирования можно временно ослабить лимиты в `panel-backend/src/index.ts` (не рекомендуется для production).

---

## 🌐 Проблемы с прокси

### Проблема: Прокси создан, но tg:// ссылка не работает

**Симптомы:** Telegram показывает "Invalid proxy" при использовании ссылки.

**Решение:**
```bash
# Проверить, что прокси запущен
curl -fsS http://node:8443/api/proxies \
  -H "Authorization: Bearer <token>" | \
  jq '.[] | select(.domain == "google.com")'

# Проверить поле status — должно быть "running"

# Проверить формат secret
# Должно быть: ee<secret><домен-hex>
# Пример: ee1234567890abcdef...676f6f676c652e636f6d (для google.com)

# Проверить логи контейнера
docker logs mtproto-proxy-abc123 --tail 20

# Тест подключения снаружи
nc -zv <ip-ноды> 443
```

### Проблема: "ECONNREFUSED" при подключении к Telegram DC

**Симптомы:** В логах контейнера прокси ошибки подключения к Telegram.

**Решение:**
```bash
# Проверить, доступны ли Telegram DCs с ноды
curl -fsS -m 5 https://149.154.167.50:443
# Ожидается: TLS handshake success (curl error о сертификате OK)

# Если неудачно — нода заблокирована (часто в РФ/Китае)
# Решения:
# 1. Используйте VPN режим (VLESS/Reality) — обходит блокировки
# 2. Используйте NAT_IP для прямого ME трафика через туннель
# 3. Переместите ноду в незаблокированную страну

# Проверить nginx роутинг
docker exec mtproto-nginx cat /etc/nginx/nginx.conf | grep -A5 "listen 443"
```

### Проблема: Высокий процент разрывов соединений

**Симптомы:** Клиенты подключаются, но отключаются через несколько секунд.

**Решение:**
```bash
# Проверить логи telemt
docker logs mtproto-proxy-abc123 --tail 100

# Распространённые проблемы:
# 1. Неверный формат ad_tag (должно быть 32 hex символа)
# 2. Невалидный censorshipTlsDomain (должен быть валидный домен)
# 3. Слишком агрессивный fastMode (попробуйте отключить)

# Попробовать отключить fastMode через API
curl -X PUT http://node:8443/api/proxies/abc123 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"fastMode": false}'
```

### Проблема: VLESS VPN не подключается

**Симптомы:** В логах контейнера xray ошибки подключения.

**Решение:**
```bash
# Проверить логи xray
docker logs mtproto-xray-abc123 --tail 50

# Тест VLESS подключения вручную
# 1. Получить vless:// URI из панели
# 2. Использовать v2ray/xray клиент для тестирования

# Распространённые проблемы:
# 1. Неверный setup key (истёк или уже использован)
# 2. Сервер недоступен
# 3. Неверный формат UUID (должен быть UUID v4)

# Пересоздать setup key в NetBird dashboard
# Переустановить NetBird на ноде
```

---

## ⚡ Проблемы с производительностью

### Проблема: Высокая загрузка CPU на панели

**Симптомы:** CPU хоста панели > 80%.

**Решение:**
```bash
# Определить источник
docker stats --no-stream
top -c

# Распространённые причины:
# 1. Слишком много запросов метрик (уменьшить частоту polling)
# 2. Большое количество прокси (>1000) — увеличить CPU
# 3. Медленные запросы PostgreSQL

# Проверить медленные запросы
docker exec -it <db-container> psql -U mtproto -d mtproto_panel \
  -c "SELECT query, calls, mean_time FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;"

# Увеличить интервал polling в UI панели
# Или уменьшить количество нод на запрос
```

### Проблема: Медленная пропускная способность прокси

**Симптомы:** Прокси работают, но пропускная способность < 1 MB/s.

**Решение:**
```bash
# Проверить использование CPU telemt на контейнер
docker stats --no-stream | grep mtproto-proxy

# Если CPU узкое место:
# 1. Уменьшить количество прокси на хосте
# 2. Использовать более мощный хост

# Проверить сеть
iperf3 -c <ip-ноды> -p 5201   # Тест пропускной способности

# Если сеть узкое место:
# 1. Проверить лимиты ISP
# 2. Использовать TCP BBR
echo "net.core.default_qdisc=fq" >> /etc/sysctl.conf
echo "net.ipv4.tcp_congestion_control=bbr" >> /etc/sysctl.conf
sysctl -p
```

### Проблема: Медленный сбор метрик

**Симптомы:** `/api/nodes/:id/metrics` занимает >5 секунд.

**Решение:**
```bash
# Проверить задержку SSH до ноды
time ssh root@<ip-ноды> "uptime"

# Если высокая задержка:
# 1. Используйте NetBird mesh сеть (меньше задержка)
# 2. Разместите панель и ноды в одном регионе

# Если SSH медленный (auth latency):
# 1. Используйте SSH ключ вместо пароля
# 2. Отключите UseDNS в /etc/ssh/sshd_config
ssh root@<ip-ноды> "sed -i 's/^#UseDNS yes/UseDNS no/' /etc/ssh/sshd_config"
ssh root@<ip-ноды> "systemctl restart sshd"
```

### Проблема: Медленный PostgreSQL

**Симптомы:** Запросы API таймаутят, запросы `psql` медленные.

**Решение:**
```bash
# Проверить текущую конфигурацию
docker exec -it <db-container> psql -U mtproto -d mtproto_panel \
  -c "SHOW shared_buffers;"
# По умолчанию: 128MB

# Увеличить (требует перезапуска контейнера с новыми аргументами)
# docker-compose.yml:
db:
  image: postgres:16-alpine
  command: postgres -c shared_buffers=512MB -c max_connections=200

# Регулярно делать VACUUM
docker exec -it <db-container> psql -U mtproto -d mtproto_panel -c "VACUUM ANALYZE;"
```

---

## 🔒 Проблемы с SSL

### Проблема: Предупреждение "self-signed certificate"

**Симптомы:** Браузер показывает предупреждение о сертификате.

**Решение:**
- Это ожидаемо для самоподписанных сертификатов.
- Для production используйте Let's Encrypt:
```bash
bash install.sh --mode=panel --ssl-letsencrypt your-domain.com
```

### Проблема: Не удаётся обновить Let's Encrypt сертификат

**Симптомы:** Cron job завершается с ошибкой, сертификат истекает.

**Решение:**
```bash
# Тест обновления вручную
certbot renew --dry-run

# Проверить срок действия сертификата
openssl x509 -enddate -noout -in /etc/letsencrypt/live/<домен>/fullchain.pem

# Если обновление не удаётся, проверить:
# 1. Порт 80 свободен (certbot нуждается в нём)
# 2. DNS A запись указывает на сервер
# 3. Лимиты не превышены (5 сертификатов/неделю на домен)
```

### Проблема: Wildcard SSL challenge не проходит

**Симптомы:** "Challenge validation timeout" при получении wildcard сертификата.

**Решение:**
```bash
# 1. Проверить, что Cloudflare API токен имеет права DNS:Edit
curl -fsS https://api.cloudflare.com/client/v4/zones \
  -H "Authorization: Bearer <token>"

# 2. Проверить, создана ли TXT запись
dig TXT _acme-challenge.example.com @8.8.8.8

# 3. Проверить, что домен добавлен в Cloudflare (не просто использует Cloudflare DNS)
# Домен должен быть добавлен в Cloudflare аккаунт с включённым orange cloud

# 4. Проверить логи в панели
docker compose logs backend | grep -i cloudflare
```

---

## 💾 Восстановление данных

### Проблема: Повреждён `store.json` на ноде

**Симптомы:** Нода не запускается, в логах "store.json is corrupted, resetting to empty state".

**Решение:**
```bash
# Сначала бэкап повреждённого файла
cp /opt/mtproto-suite/service-node/data/store.json /backup/store.json.corrupted

# Проверить, что можно восстановить
cat /backup/store.json.corrupted | jq . 2>&1 | head -50

# Если валидный JSON, восстановить
cp /backup/store.json.corrupted /opt/mtproto-suite/service-node/data/store.json
docker compose restart service-node

# Если повреждён — нода сбросится в пустое состояние
# Пересоздайте прокси из экспорта панели (если есть бэкап)
```

### Проблема: Повреждение базы данных PostgreSQL

**Симптомы:** Panel backend не запускается, ошибки БД.

**Решение:**
```bash
# Остановить панель
cd /opt/mtproto-suite
docker compose stop backend frontend

# Попробовать восстановить
docker compose exec db pg_dump -U mtproto mtproto_panel > /backup/dump-$(date +%Y%m%d).sql

# Если дамп не работает, пересоздать БД
docker compose exec db dropdb -U mtproto mtproto_panel
docker compose exec db createdb -U mtproto mtproto_panel

# Перезапустить (выполнит миграции)
docker compose up -d

# Восстановить из бэкапа
cat /backup/dump-pre-corrupt.sql | docker compose exec -T db psql -U mtproto -d mtproto_panel
```

### Проблема: Потерян пароль администратора

**Решение:**
```bash
# Сбросить пароль администратора напрямую в PostgreSQL
docker compose exec db psql -U mtproto -d mtproto_panel -c "
UPDATE users SET password_hash = crypt('new-password', gen_salt('bf', 12))
WHERE username = 'admin';
"

# Или установить новый пароль через env var и пересоздать
cd /opt/mtproto-suite
# Отредактируйте panel-backend/.env и установите новый ADMIN_PASSWORD
docker compose up -d backend  # Обновит пароль при старте
```

---

## 📞 Получение помощи

### Перед открытием Issue

1. **Проверьте логи** — `docker compose logs -f`
2. **Поищите issues** — https://github.com/mtproto-suite/mtproto-suite/issues
3. **Попробуйте docs** — [INSTALLATION.md](INSTALLATION.ru.md), [CONFIGURATION.md](CONFIGURATION.ru.md)
4. **Воспроизведите** — можете воспроизвести проблему стабильно?

### Информация для включения

При открытии issue, включите:

```
**Окружение:**
- ОС: `cat /etc/os-release`
- Версия Docker: `docker version`
- Версия панели: (из UI или `/api/system/version`)
- Версия ноды: (из `/api/health`)

**Шаги для воспроизведения:**
1. ...
2. ...

**Ожидаемое поведение:**
...

**Фактическое поведение:**
...

**Логи:**
```
docker compose logs --tail=100 backend
docker compose logs --tail=100 service-node
```
```

### Аварийное восстановление

Если всё сломано:

```bash
# 1. Остановить всё
cd /opt/mtproto-suite
docker compose down

# 2. Бэкап данных
tar czf /backup/mtproto-emergency-$(date +%Y%m%d).tar.gz \
  panel-backend/.env service-node/.env \
  service-node/data pgdata

# 3. Переустановить
bash install.sh --mode=panel --install-dir=/opt/mtproto-suite-new

# 4. Мигрировать данные
# Скопируйте данные ноды и .env из бэкапа в новую установку
# Восстановите PostgreSQL из pg_dump если есть

# 5. Пересоздать ноды через UI панели
```
