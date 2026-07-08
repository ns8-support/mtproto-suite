# Руководство по установке

Это руководство охватывает все сценарии установки MTProto Suite.

[🇬🇧 English version](INSTALLATION.md)

## 📋 Содержание

- [Требования](#-требования)
- [Быстрая установка](#-быстрая-установка)
- [Сценарий 1: Production — Панель + несколько нод](#-сценарий-1-production--панель--несколько-нод)
- [Сценарий 2: Один хост (Панель + Нода)](#-сценарий-2-один-хост-панель--нода)
- [Сценарий 3: Сборка для разработки](#-сценарий-3-сборка-для-разработки)
- [Настройка SSL/TLS](#-настройка-ssltls)
- [Настройка NetBird Mesh VPN](#-настройка-netbird-mesh-vpn)
- [Обновление](#-обновление)
- [Удаление](#-удаление)

---

## ✅ Требования

### Системные требования

**Хост панели:**
- Linux x86_64 или aarch64
- 1 CPU ядро, 1 GB RAM (минимум)
- 10 GB дискового пространства
- Root или sudo доступ (для установщика)

**Каждый хост ноды:**
- Linux x86_64 или aarch64
- 1 CPU ядро, 512 MB RAM (минимум на 10 прокси)
- 5 GB дискового пространства
- Root или sudo доступ
- Публичный IP адрес (или NetBird mesh IP для приватной сети)

### Программные зависимости

Установщик автоматически установит недостающие зависимости. Однако, если вы предпочитаете установить вручную:

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

### Версия Docker

- Docker Engine **≥ 20.10** (для поддержки `condition: service_healthy`)
- Docker Compose plugin **≥ 2.0**

Проверка:
```bash
docker version    # Должно показать Server.Version ≥ 20.10
docker compose version    # Должно показать ≥ 2.0
```

### Сетевые требования

**Входящие на хост панели:**
- TCP 80 (HTTP) или 443 (HTTPS) — Web UI
- Опционально: TCP 22 (SSH) только для установки

**Входящие на хост ноды:**
- TCP 443 (порт прокси по умолчанию) — Telegram клиенты
- TCP 8443 (порт API по умолчанию) — доступ панели
- Опционально: TCP 22 (SSH) только для установки

**Исходящие с хоста панели:**
- TCP 443 к публичному IP каждой ноды — API коммуникация
- TCP 80 к api.ipify.org — определение IP сервера при удалённой установке

**Исходящие с хоста ноды:**
- UDP 53 (DNS) — обязательно
- TCP 443 к IP адресам Telegram DC
- TCP 443 к Cloudflare API (если используется wildcard SSL)

---

## 🚀 Быстрая установка

Единый скрипт `install.sh` обрабатывает все сценарии. Показать справку:

```bash
bash install.sh --help
```

```
MTProto Suite — Установщик

Использование:
  bash install.sh [опции]

Опции:
  --mode=panel|node|both   Что устанавливать (по умолчанию — интерактивный выбор)
  --ssl-self               Самоподписанный SSL для панели (только в режиме panel)
  --ssl-letsencrypt DOM    Let's Encrypt для указанного домена
  --install-dir DIR        Куда клонировать (по умолчанию /opt/mtproto-suite)
  --repo URL               URL репозитория
  -y, --yes                Не спрашивать подтверждения
  --uninstall              Удалить установку
  --help                   Эта справка

Примеры:
  bash install.sh --mode=panel
  bash install.sh --mode=node
  bash install.sh --mode=both -y
  bash install.sh --mode=panel --ssl-letsencrypt panel.example.com
```

---

## 🌐 Сценарий 1: Production — Панель + несколько нод

Это **рекомендуемое** развёртывание для управления множеством прокси на множестве серверов.

### Шаг 1: Установка сервера панели

Выберите сервер со **стабильным публичным IP** и хорошей связностью со всеми прокси-серверами.

```bash
# SSH на сервер панели
ssh root@panel.example.com

# Запустите установщик
bash <(wget -qO- https://raw.githubusercontent.com/ns8-support/mtproto-suite/main/install.sh) --mode=panel
```

**Интерактивные запросы:**
```
Что устанавливать?
  1) panel — Панель управления (Web UI)
  2) node  — Сервис-нода (proxy runtime)
  3) both  — Панель + нода на одной машине
Выберите режим [1/2/3]: 1

Внешний порт панели (HTTP) [80]: 80
Логин администратора [admin]: admin
Пароль администратора (минимум 8 символов): ********
Подтвердите пароль: ********

SSL для панели?
  1) Без SSL (HTTP)
  2) Самоподписанный сертификат
  3) Let's Encrypt (требуется домен)
Выберите [1/2/3]: 3
Домен для Let's Encrypt: panel.example.com
```

**Вывод:**
```
✓ Панель установлена и запущена

URL:        https://panel.example.com
Логин:      admin
Пароль:     ********
Каталог:    /opt/mtproto-suite

Следующий шаг: установите service-node на прокси-сервере
  bash <(wget -qO- https://...install.sh) --mode=node
```

### Шаг 2: Установка каждой сервис-ноды

На каждом прокси-сервере:

```bash
# SSH на каждый прокси-сервер
ssh root@proxy1.example.com

# Запустите установщик
bash <(wget -qO- https://raw.githubusercontent.com/ns8-support/mtproto-suite/main/install.sh) --mode=node
```

**Интерактивные запросы:**
```
Порт API ноды [8443]: 8443
Порт прокси (nginx) [443]: 443
NAT_IP (публичный IP VPN-сервера, опционально):  # оставьте пустым если нет VPN
```

**Вывод:**
```
✓ Сервис-нода запущена

API:        http://proxy1.example.com:8443/api/health
Порт прокси: 443
Токен:      a1b2c3d4e5f6...
Каталог:    /opt/mtproto-suite

Добавьте эту ноду в панель:
  Имя:     Node proxy1.example.com
  IP:      proxy1.example.com
  Порт:    8443
  Токен:   a1b2c3d4e5f6...
```

> 💡 **Сохраните токен!** Он понадобится для добавления ноды в панель.

### Шаг 3: Добавление нод в панели

**Способ A: Использовать удалённую установку через панель (проще всего)**

1. Откройте `https://panel.example.com` в браузере
2. Войдите с credentials администратора
3. Нажмите кнопку **"🛠 Установить удалённо"**
4. Введите SSH credentials прокси-сервера
5. Нажмите **"🚀 Установить"** — панель устанавливает service-node автоматически
6. После успеха нажмите **"+ Добавить как ноду"** — credentials заполнятся автоматически

**Способ B: Добавить существующую ноду вручную**

1. Откройте панель → страница **"Ноды"**
2. Нажмите кнопку **"+ Добавить ноду"**
3. Заполните:
   - **Имя**: Понятное имя (например, "Франкфурт #1")
   - **IP**: Публичный IP прокси-сервера
   - **Порт**: 8443 (по умолчанию)
   - **Токен**: Из вывода Шага 2
   - **Домен** (опционально): Для генерации `tg://proxy?...` ссылки
4. Нажмите **"Добавить ноду"**

### Шаг 4: Создание первого прокси

1. Нажмите на добавленную ноду
2. Нажмите **"+ Создать прокси"**
3. Настройте:
   - **Имя**: Понятное имя
   - **Домен**: Авто-выбирается из пула или кастомный
   - **Макс. подключений**: Опциональный лимит
   - **VPN подписка** (опционально): VLESS URL если используется VPN
4. Нажмите **"Создать"**

Прокси теперь активен. Нажмите **"📋 Скопировать tg:// ссылку"** для отправки Telegram клиентам.

---

## 🖥️ Сценарий 2: Один хост (Панель + Нода)

Для тестирования или домашнего использования — всё работает на одной машине.

```bash
ssh root@localhost

bash <(wget -qO- https://raw.githubusercontent.com/ns8-support/mtproto-suite/main/install.sh) --mode=both -y
```

Устанавливает:
- PostgreSQL + backend + frontend (панель на порту 80)
- service-node (прокси на порту 8443 + прокси порт 443)

**После установки:**
1. Откройте `http://<server-ip>:80` в браузере
2. Войдите с admin credentials (показаны в выводе)
3. Добавьте локальную ноду:
   - **IP**: `127.0.0.1` (или ваш server IP)
   - **Порт**: `8443`
   - **Токен**: Из вывода установки

> 💡 **Примечание для production:** Режим one-host использует порт 443 для прокси и проксирует на localhost. Если вашей панели тоже нужен порт 443 (HTTPS), вам нужно будет использовать нестандартные порты.

---

## 💻 Сценарий 3: Сборка для разработки

Для контрибьютинга в MTProto Suite или запуска кастомных модификаций.

### Требования

- Node.js ≥ 20
- npm ≥ 10
- Docker (для тестирования)
- Git

### Установка

```bash
git clone https://github.com/ns8-support/mtproto-suite.git
cd mtproto-suite

# Установить зависимости для всех пакетов
cd shared && npm install && npm run build && cd ..
cd service-node && npm link ../shared && npm install && npm run build && cd ..
cd panel-backend && npm link ../shared && npm install && npm run build && cd ..
cd panel-frontend && npm link ../shared && npm install && npm run build && cd ..

# Запустить в dev режиме для любого пакета
cd panel-backend && npm run dev   # ts-node watcher
cd panel-frontend && npm run dev # vite dev server
```

### URL для разработки

- **Backend dev**: `http://localhost:3000/api/*`
- **Frontend dev**: `http://localhost:5173` (Vite по умолчанию)
- **Frontend → Backend proxy**: Настроено в `vite.config.ts`

### Hot Reload

Backend использует `ts-node` для мгновенной перезагрузки при изменениях файлов.
Frontend использует Vite HMR для мгновенного обновления UI.

---

## 🔒 Настройка SSL/TLS

Три опции для защиты вашей панели:

### Опция 1: Без SSL (HTTP — только для разработки)

```bash
bash install.sh --mode=panel
# Выберите "Без SSL" при запросе
```

> ⚠️ **Никогда не используйте HTTP в production.** Все credentials передаются в открытом виде.

### Опция 2: Самоподписанный сертификат

```bash
bash install.sh --mode=panel --ssl-self
```

Генерирует самоподписанный сертификат на 365 дней. Браузеры покажут предупреждение — клиенты должны вручную доверять ему.

**Случай использования:** Внутренние сети, тестирование, staging.

### Опция 3: Let's Encrypt (Production)

```bash
bash install.sh --mode=panel --ssl-letsencrypt panel.example.com
```

Требования:
- Домен должен указывать на IP вашего сервера панели (A запись)
- Порт 80 должен быть свободен во время выпуска сертификата
- Email для уведомлений Let's Encrypt

Установщик:
1. Установит `certbot` если отсутствует
2. Получит сертификат через HTTP-01 challenge
3. Настроит nginx с TLS 1.2/1.3, HSTS, security headers
4. Настроит cron для автообновления

### Опция 4: Wildcard SSL через Cloudflare

Для нескольких поддоменов (например, `panel.example.com`, `proxy1.example.com`, `proxy2.example.com`):

1. Добавьте домен в Cloudflare
2. Создайте API Token с правами `Zone:DNS:Edit`
3. Откройте панель → **SSL Сертификаты** → **"Получить wildcard"**
4. Введите API Token → выберите домен → введите email
5. Нажмите **"Получить сертификат"**

Панель:
1. Создаёт ACME аккаунт на Let's Encrypt
2. Генерирует CSR для `*.example.com`
3. Создаёт TXT запись `_acme-challenge.example.com` через Cloudflare API
4. Завершает DNS-01 challenge
5. Сохраняет сертификат и приватный ключ в `/opt/mtproto-suite/ssl/wildcard/`

См. [USAGE.md](USAGE.md#-wildcard-ssl-через-cloudflare) для деталей.

---

## 🔐 Настройка NetBird Mesh VPN

Опционально: соедините все ноды через приватную WireGuard mesh-сеть, обходя проблемы с NAT/firewall.

### 1. Получите Setup Key

**SaaS (netbird.io):**
- Зарегистрируйтесь на https://app.netbird.io
- Перейдите в Setup Keys → Create
- Скопируйте ключ (например, `NETBIRD-SETUP-KEY-XXXXX`)

**Self-hosted:**
- Разверните NetBird management server (см. https://docs.netbird.io/selfhosted/)
- Создайте setup key через admin panel

### 2. Установка на каждой ноде

В панели:
1. Откройте страницу деталей ноды
2. Прокрутите до секции **NetBird**
3. Введите setup key + (опционально) management URL
4. Нажмите **"Установить & Подключиться"**

После установки каждая нода получает **mesh IP** (например, `100.64.0.5`). Вы можете использовать mesh IP вместо публичных IP в конфигурации нод панели.

### 3. Проверка

```bash
# SSH на ноду
netbird status

# Должно показать:
#   Management: Connected to https://app.netbird.io
#   Status: Connected
#   Peers: 3
```

---

## 🔄 Обновление

### Self-update панели (через UI)

1. Войдите в панель
2. Откройте страницу Settings (или используйте API)
3. Нажмите **"Обновить панель"**
4. Подождите 2-5 минут пока контейнеры пересоберутся

Или через CLI:
```bash
cd /opt/mtproto-suite
git pull origin main
docker compose pull 2>/dev/null || docker compose build
docker compose up -d
```

### Self-update ноды (через панель)

1. Откройте панель → Ноды
2. Нажмите на ноду
3. Нажмите кнопку **"Обновить"**
4. Панель триггерит `update.sh` на ноде через SSH

Или через CLI на ноде:
```bash
cd /opt/mtproto-suite
git pull origin main
docker compose pull 2>/dev/null || docker compose build
docker compose up -d
```

### Обновить все ноды автоматически

```bash
# С хоста панели
for node in node1.example.com node2.example.com; do
  ssh root@$node "cd /opt/mtproto-suite && git pull && docker compose up -d"
done
```

---

## 🗑️ Удаление

### Интерактивное

```bash
bash /opt/mtproto-suite/install.sh --uninstall
```

Подтверждение перед удалением:
- `/opt/mtproto-suite` директория
- Все контейнеры
- Docker volumes (PostgreSQL data, service-node data)
- SSL сертификаты

### Non-interactive (для автоматизации)

```bash
bash /opt/mtproto-suite/install.sh --uninstall -y
```

### Частичное удаление (сохранить данные)

```bash
# Остановить контейнеры, но сохранить данные
cd /opt/mtproto-suite
docker compose down  # Останавливает контейнеры, сохраняет volumes

# Или остановить и удалить контейнеры, но сохранить data directory
docker compose down --remove-orphans
rm -rf /opt/mtproto-suite/service-node/data  # Опционально: удалить данные ноды
```

---

## 🔧 После установки

### Проверка установки

**Панель:**
```bash
curl -fsS http://localhost:80/api/health
# Ожидается: {"status":"ok"}
```

**Нода:**
```bash
curl -fsS http://localhost:8443/api/health \
  -H "Authorization: Bearer <ваш-токен>"
# Ожидается: {"status":"ok","timestamp":"...","version":"2.0.0"}
```

### Настройка firewall

**Панель (пример UFW):**
```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 22/tcp  # SSH
```

**Нода (пример UFW):**
```bash
ufw allow 443/tcp   # Прокси трафик
ufw allow 8443/tcp  # API (только с IP панели)
ufw allow from <panel-ip> to any port 8443
ufw allow 22/tcp    # SSH
```

### Backup

**Данные панели:**
```bash
docker compose exec -T db pg_dump -U mtproto mtproto_panel > backup.sql
tar czf panel-config.tar.gz .env panel-backend/.env
```

**Данные ноды:**
```bash
tar czf node-data.tar.gz /opt/mtproto-suite/service-node/data
tar czf node-config.tar.gz /opt/mtproto-suite/service-node/.env
```

---

## 🆘 Получение помощи

Если установка не удаётся:

1. Проверьте логи: `docker compose logs`
2. См. [TROUBLESHOOTING.md](TROUBLESHOOTING.ru.md)
3. Откройте issue: https://github.com/ns8-support/mtproto-suite/issues
4. Включите в отчёт:
   - Версия ОС (`cat /etc/os-release`)
   - Версия Docker (`docker version`)
   - Лог установки
   - Вывод `docker compose logs`
