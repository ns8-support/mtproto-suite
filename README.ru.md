# MTProto Suite

[![Version](https://img.shields.io/badge/version-3.0.0-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/docker-required-blue.svg)](https://docker.com)
[![Platform](https://img.shields.io/badge/platform-linux-lightgrey.svg)](#-совместимость)

**Единая панель управления и среда исполнения для MTProto Telegram прокси с VPN-туннелированием.**

MTProto Suite объединяет централизованную панель управления (Web UI) и распределённые сервис-ноды (proxy runtime на каждом сервере) в единый проект на базе Docker. Предназначен для развёртывания и управления сотнями MTProto прокси на множестве серверов, с опциональным VLESS/Reality VPN-туннелированием для обхода региональных блокировок.

[🇬🇧 English documentation](README.md)

---

## ✨ Возможности

### 🖥️ Панель управления (Web UI)

- **Multi-node управление** — неограниченное количество нод из одной панели
- **Мониторинг в реальном времени** — CPU, RAM, диск, Docker-контейнеры через SSH
- **Графики истории** — интерактивные временные ряды для всех метрик
- **Удалённые действия** — перезапуск сервиса, перезагрузка сервера, установка NetBird
- **Удалённая SSH-установка** — установить service-node на новый сервер в один клик
- **Wildcard SSL** — автоматические сертификаты Let's Encrypt через Cloudflare DNS-01
- **VLESS/Reality VPN-туннелирование** — per-proxy SOCKS5 через xray
- **Мультипортовые прокси** — назначение индивидуального порта каждому прокси
- **Лимиты подключений** — `limit_conn` per-proxy через nginx
- **IP blacklist** — на уровне ноды, через `deny` директиву nginx
- **Кастомные fake TLS домены** — пул из 50+ доменов, расширяемый
- **Статистика** — CPU/RAM/трафик/uptime, история (7 дней), экспорт в JSON
- **IP геолокация** — флаги стран через ip-api.com (кеш 1 час)
- **Live IP tracking** — real-time логирование подключений из nginx access logs
- **JWT авторизация** — bearer-token, 24 часа
- **Действия через UI** — restart, pause, resume, update
- **Export/Import** — перенос конфигурации между нодами
- **Self-update** — панель может обновить себя через кнопку в UI

### ⚙️ Сервис-нода (Runtime)

- **Высокопроизводительный прокси** — Rust-based `telemt` MTProto прокси
- **SNI-роутинг** — один nginx, multi-domain через `$ssl_preread_server_name`
- **VLESS VPN интеграция** — Reality/TLS/WS/grpc/xhttp транспорты
- **Hybrid режим** — ME трафик через tun0 (EU IP), DC трафик через SOCKS5 (обход РКН)
- **Legacy режим** — DC трафик только через SOCKS5
- **Per-proxy конфигурация** — 30+ продвинутых опций (keepalive, reconnect, stun, и т.д.)
- **Auto-recovery** — контейнеры перезапускаются при сбое (`unless-stopped`)
- **GeoIP lookup** — автоматическое определение страны подключающихся IP
- **Real-time статистика** — собирается каждые 5 минут, история за 7 дней
- **Hash-based image caching** — telemt образ пересобирается только при изменении Dockerfile

### 🛡️ Безопасность

- **JWT_SECRET обязателен** — нет небезопасного дефолта (убран `change-me-in-production`)
- **Валидация AUTH_TOKEN** — минимум 16 символов, `timingSafeEqual` для сравнения
- **Защита от username enumeration** — одинаковый bcrypt ответ для несуществующих пользователей
- **Валидация IP/port/token** — строгие regex на всех входах
- **CHECK constraints** — PostgreSQL проверяет диапазоны портов
- **Рекомендация SSL-only** — install скрипт поддерживает Let's Encrypt / самоподписанный
- **bcrypt cost 12** — хеширование пароля админа
- **Секреты в `.env` chmod 600** — только root может читать
- **HTTPS-only API** — TLS 1.2/1.3 с HSTS, security headers
- **AES-256-GCM шифрование** — Cloudflare токены и SSH credentials at rest
- **CORS whitelist** — только frontend панели может делать запросы к API
- **Rate limiting** — 10 SSH запросов / 5 мин, 10 попыток login / 15 мин
- **Sanitization error messages** — нет утечек внутренних IP, путей, stack traces
- **Logger auto-redaction** — пароли, токены, приватные ключи никогда не логируются
- **SSH безопасность аудирована** — см. [SECURITY_AUDIT_SSH.md](docs/SECURITY_AUDIT_SSH.md) (10 проблем, все исправлены)

### 🔒 NetBird Mesh VPN (Опционально)

- **WireGuard-based mesh** — соединяет ноды через приватную сеть
- **Обход NAT/firewall** — публичный IP не требуется для связи между нодами
- **Self-hosted поддержка** — свой management server
- **Auto-discovery** — peers видны в панели после настройки
- **Простая установка** — установка в один клик через setup key

---

## 🏗️ Архитектура

```
┌─────────────────────────────────────────────────────────┐
│                  ХОСТ ПАНЕЛИ                              │
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
                            │ SSH (password или private key)
                            │ + Bearer-token API
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Нода #1    │    │   Нода #2    │    │   Нода #N    │
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

Все компоненты работают в Docker-контейнерах — нативной установки Node.js не требуется.

---

## 📦 Структура проекта

```
mtproto-suite/
├── shared/                    # Общие типы и утилиты (TypeScript)
├── service-node/              # Proxy runtime (Express + Docker + Nginx + xray)
├── panel-backend/             # API сервер (Express + PostgreSQL)
├── panel-frontend/            # React SPA (Vite + Gravity UI)
├── docs/                      # 📚 Документация
│   ├── INSTALLATION.md        # Пошаговая инструкция по установке
│   ├── CONFIGURATION.md       # Все переменные окружения
│   ├── USAGE.md               # Повседневное использование
│   ├── ARCHITECTURE.md        # Техническая архитектура
│   ├── API.md                 # REST API reference
│   ├── TROUBLESHOOTING.md     # Решение проблем
│   ├── SECURITY.md            # Модель безопасности
│   ├── SECURITY_AUDIT_SSH.md  # Отчёт аудита SSH credentials
│   └── MIGRATION.md           # Миграция с оригинальных репозиториев
├── docker-compose.yml         # Стек панели
├── docker-compose.ssl.yml     # Overlay для HTTPS
├── docker-compose.both.yml    # Панель + нода на одной машине
├── install.sh                 # 🔧 Единый интерактивный установщик
├── uninstall.sh
├── CHANGELOG.md               # История версий
├── LICENSE                    # MIT License
├── CONTRIBUTING.md            # Гайд для контрибьюторов
├── README.md                  # Этот файл
└── README.ru.md               # Русская версия
```

---

## 🚀 Быстрый старт

### Вариант 1: Production развёртывание (рекомендуется)

**Шаг 1: Установите панель на сервере управления**

```bash
# SSH на сервер панели
ssh root@panel.example.com

# Запустите установщик
bash <(wget -qO- https://raw.githubusercontent.com/ns8-support/mtproto-suite/main/install.sh) --mode=panel
```

Установщик:
1. Проверит и установит Docker при необходимости
2. Склонирует репозиторий в `/opt/mtproto-suite`
3. Спросит: порт, логин администратора, пароль администратора
4. Сгенерирует JWT_SECRET (32 байта) и DB_PASSWORD (16 байт) автоматически
5. Соберёт и запустит контейнеры

**Шаг 2: Установите service-node на каждом прокси-сервере**

```bash
# SSH на каждый прокси-сервер
ssh root@proxy1.example.com

# Запустите установщик
bash <(wget -qO- https://raw.githubusercontent.com/ns8-support/mtproto-suite/main/install.sh) --mode=node
```

**Или используйте функцию "🛠 Установить удалённо" в панели** — вставьте SSH credentials и панель сама установит service-node.

**Шаг 3: Добавьте ноду в панели**

1. Откройте `http://panel.example.com:80` в браузере
2. Войдите с credentials администратора
3. Нажмите "**🛠 Установить удалённо**" → введите SSH credentials → нажмите Install
4. После установки нажмите "**+ Добавить как ноду**" (IP/port/token заполнятся автоматически)

### Вариант 2: Тестовое развёртывание (один хост)

Для тестирования или домашнего использования, установите всё на одном сервере:

```bash
bash <(wget -qO- https://raw.githubusercontent.com/ns8-support/mtproto-suite/main/install.sh) --mode=both -y
```

Запускает:
- PostgreSQL + backend + frontend (панель на порту 80)
- service-node (proxy runtime на порту 8443 + proxy порт 443)

После установки добавьте ноду в панели: `IP=127.0.0.1, Port=8443, Token=<из вывода>`.

### Вариант 3: Ручная сборка (для разработчиков)

```bash
git clone https://github.com/ns8-support/mtproto-suite.git
cd mtproto-suite

# Собрать все 4 пакета
cd shared && npm install && npm run build && cd ..
cd service-node && npm install && npm run build && cd ..
cd panel-backend && npm install && npm run build && cd ..
cd panel-frontend && npm install && npm run build

# Запустить через docker-compose
cd ..
docker compose up -d --build
```

---

## 📖 Документация

Подробная документация в директории [`docs/`](docs/). **Все документы доступны на английском и русском языках.**

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
| [🔍 SECURITY_AUDIT_SSH.md](docs/SECURITY_AUDIT_SSH.md) | Аудит SSH credentials (10 проблем, все исправлены) |
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

## 🌐 Совместимость

### Операционные системы

| ОС | Версии | Пакетный менеджер |
|---|---|---|
| Ubuntu | 20.04, 22.04, 24.04 | apt |
| Debian | 11, 12 | apt |
| CentOS / RHEL | 8, 9 | yum / dnf |
| AlmaLinux / Rocky Linux | 8, 9 | yum |

> ⚠️ **Только Linux x86_64 и aarch64.** Windows и macOS не поддерживаются как хосты прокси.
> **Панель** технически может работать везде, где работает Docker, но официально тестируется только на Linux.

### Docker

- Docker Engine **≥ 20.10** (для `condition: service_healthy`)
- Docker Compose plugin **≥ 2.0** (авто-установка при отсутствии)

### Браузеры (для UI панели)

- Chrome / Edge ≥ 90
- Firefox ≥ 88
- Safari ≥ 14

---

## 🤝 Контрибьютинг

Вклад приветствуется! См. [CONTRIBUTING.md](CONTRIBUTING.md):
- Настройка dev-окружения
- Стандарты кодирования
- Требования к тестированию
- Процесс Pull Request

---

## 📜 Лицензия

MIT License — см. [LICENSE](LICENSE).

Оригинальные проекты:
- [danielVNru/mtproto-panel](https://github.com/danielVNru/mtproto-panel) © danielVNru
- [danielVNru/mtproto-node](https://github.com/danielVNru/mtproto-node) © danielVNru

---

## 🙏 Благодарности

- **telemt** — высокопроизводительный Rust MTProto прокси от [telemt/telemt](https://github.com/telemt/telemt)
- **xray** — VLESS прокси от [XTLS/Xray-core](https://github.com/XTLS/Xray-core)
- **nginx** — SNI-based роутинг трафика
- **Let's Encrypt** — бесплатные wildcard сертификаты
- **Cloudflare** — DNS API для ACME challenges
- **NetBird** — mesh VPN для связи между нодами
- **acme-client** — реализация протокола ACME
- **ssh2** — SSH клиент
- **PostgreSQL** — надёжная база данных
- **React + Gravity UI** — современный frontend стек
