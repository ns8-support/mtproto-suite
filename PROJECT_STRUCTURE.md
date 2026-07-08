# Полный список файлов проекта MTProto Suite

Этот файл содержит полную структуру проекта, включая скрытые директории.

## Структура проекта

```
mtproto-suite/
├── .git/                          # Git репозиторий (не публикуется)
├── .github/                       # GitHub конфигурация
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   ├── feature_request.md
│   │   └── security_report.md
│   ├── workflows/
│   │   └── docker-publish.yml     # CI/CD для Docker образов
│   └── PULL_REQUEST_TEMPLATE.md
├── .gitignore                     # Git ignore правила
├── .env.example                   # Пример файла окружения
│
├── docs/                          # Документация
│   ├── API.md
│   ├── API.ru.md
│   ├── ARCHITECTURE.md
│   ├── ARCHITECTURE.ru.md
│   ├── CONFIGURATION.md
│   ├── CONFIGURATION.ru.md
│   ├── DOCKER_REGISTRY.md
│   ├── FAQ.md
│   ├── FAQ.ru.md
│   ├── INSTALLATION.md
│   ├── INSTALLATION.ru.md
│   ├── MIGRATION.md
│   ├── MIGRATION.ru.md
│   ├── SECURITY.md
│   ├── SECURITY.ru.md
│   ├── SECURITY_AUDIT_SSH.md
│   ├── SECURITY_AUDIT_SSH.ru.md
│   ├── TROUBLESHOOTING.md
│   ├── TROUBLESHOOTING.ru.md
│   ├── USAGE.md
│   └── USAGE.ru.md
│
├── panel-frontend/                # Frontend (React + TypeScript)
│   ├── Dockerfile
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   ├── vite.config.ts
│   ├── nginx.conf
│   ├── nginx-ssl.conf
│   └── src/
│       ├── App.tsx
│       ├── main.tsx
│       ├── api/
│       │   ├── index.ts
│       │   ├── monitoring.ts
│       │   ├── remote-install.ts
│       │   └── ssl.ts
│       ├── components/
│       │   ├── Monitoring/
│       │   │   ├── ActionPanel.tsx
│       │   │   ├── MetricsCard.tsx
│       │   │   ├── MetricsChart.tsx
│       │   │   └── SystemInfoCard.tsx
│       │   ├── NetBird/
│       │   │   └── NetBirdPanel.tsx
│       │   ├── RemoteInstall/
│       │   │   └── RemoteInstallDialog.tsx
│       │   └── SSL/
│       │       └── WildcardSslDialog.tsx
│       ├── hooks/
│       │   ├── useAsync.ts
│       │   ├── useLogin.ts
│       │   ├── useNodes.ts
│       │   ├── useProxies.ts
│       │   └── useProxyDetail.ts
│       └── pages/
│           ├── Login/
│           │   └── Login.tsx
│           ├── NodeDetail/
│           │   └── NodeDetail.tsx
│           ├── Nodes/
│           │   └── Nodes.tsx
│           └── SSL/
│               └── SSL.tsx
│
├── panel-backend/                 # Backend (Express + TypeScript)
│   ├── Dockerfile
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── update.sh
│   └── src/
│       ├── index.ts
│       ├── types.ts
│       ├── config/
│       │   └── index.ts
│       ├── db/
│       │   ├── index.ts
│       │   └── migrations.ts
│       ├── middleware/
│       │   └── auth.ts
│       ├── routes/
│       │   ├── allProxies.ts
│       │   ├── auth.ts
│       │   ├── nodes.ts
│       │   ├── nodes-monitoring.ts
│       │   ├── proxies.ts
│       │   ├── remote-install.ts
│       │   └── ssl.ts
│       ├── services/
│       │   ├── netbird/
│       │   │   └── index.ts
│       │   ├── ssh/
│       │   │   ├── metrics.ts
│       │   │   └── remote-install.ts
│       │   └── ssl/
│       │       ├── acme.ts
│       │       └── cloudflare.ts
│       └── utils/
│           ├── error-sanitizer.ts
│           ├── node-proxy.ts
│           └── validation.ts
│
├── service-node/                  # Service Node (Proxy runtime)
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── update.sh
│   └── src/
│       ├── index.ts
│       ├── config/
│       │   └── index.ts
│       ├── middleware/
│       │   └── auth.ts
│       ├── routes/
│       │   ├── health.ts
│       │   └── proxy.ts
│       ├── services/
│       │   ├── docker.ts
│       │   ├── nginx.ts
│       │   ├── proxy.ts
│       │   └── xray.ts
│       ├── store/
│       │   └── index.ts
│       └── utils/
│           └── crypto.ts
│
├── shared/                        # Общие типы и утилиты
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   ├── types/
│   │   ├── api.ts
│   │   ├── constants.ts
│   │   ├── index.ts
│   │   ├── monitoring.ts
│   │   ├── proxy.ts
│   │   └── vless.ts
│   └── utils/
│       ├── error-sanitizer.ts
│       ├── fetch.ts
│       ├── index.ts
│       ├── logger.ts
│       └── tar.ts
│
├── docker-compose.yml             # Основной compose файл
├── docker-compose.ssl.yml         # SSL overlay
├── docker-compose.both.yml        # Panel + Node на одной машине
│
├── install.sh                     # Установщик (panel/node/both)
├── uninstall.sh                   # Деинсталлятор
│
├── package.json                   # Root package.json
├── package-lock.json
│
├── README.md                      # Основная документация (EN)
├── README.ru.md                   # Основная документация (RU)
├── CHANGELOG.md                   # История изменений
├── CONTRIBUTING.md                # Руководство для контрибьюторов
├── LICENSE                        # MIT License
│
└── Отчёты и патчи:
    ├── BUG_REPORT.md
    ├── BUGFIXES.patch
    ├── DOCKER_BUILD_FIX.md
    ├── FINAL_AUDIT.md
    ├── GITHUB_ACTIONS_UPDATE.md
    ├── MODE_SELECTION_AUDIT.md
    └── PUSH_TO_GITHUB.md
```

## Скрытые директории

### `.github/` — GitHub конфигурация

Содержит:
- **ISSUE_TEMPLATE/** — шаблоны для issues
  - `bug_report.md` — шаблон баг-репорта
  - `feature_request.md` — шаблон запроса функции
  - `security_report.md` — шаблон отчёта о безопасности
- **workflows/** — GitHub Actions workflows
  - `docker-publish.yml` — CI/CD для сборки и публикации Docker образов
- **PULL_REQUEST_TEMPLATE.md** — шаблон для pull requests

### `.git/` — Git репозиторий

Стандартная git директория, содержит:
- Историю коммитов
- Объекты git
- Конфигурацию репозитория
- **НЕ публикуется** в репозиторий (автоматически исключается)

### `.gitignore` — Правила игнорирования

Определяет, какие файлы не отслеживать:
- `node_modules/` — зависимости npm
- `dist/`, `build/`, `out/` — результаты сборки
- `.env`, `.env.local` — файлы окружения
- `*.log` — логи
- `.vscode/`, `.idea/` — настройки IDE
- `coverage/` — отчёты о покрытии тестами
- `service-node/data/` — данные service node

## Как работать со скрытыми файлами

### Через терминал:
```bash
# Показать все файлы (включая скрытые)
ls -la

# Показать только скрытые директории
ls -la | grep "^\."

# Перейти в скрытую директорию
cd .github/workflows/

# Редактировать скрытый файл
nano .gitignore
```

### Через Git:
```bash
# Показать все отслеживаемые файлы
git ls-files

# Показать файлы в скрытых директориях
git ls-files | grep "^\."

# Добавить скрытые файлы
git add .github/
git commit -m "Update GitHub workflows"
```

### Через read_file (в Arena):
Вы можете читать скрытые файлы напрямую:
- `mtproto-suite/.github/workflows/docker-publish.yml`
- `mtproto-suite/.gitignore`
- `mtproto-suite/.env.example`

## Важные скрытые файлы

| Файл | Назначение |
|------|-----------|
| `.github/workflows/docker-publish.yml` | CI/CD для Docker образов |
| `.github/ISSUE_TEMPLATE/*.md` | Шаблоны для issues |
| `.github/PULL_REQUEST_TEMPLATE.md` | Шаблон для PR |
| `.gitignore` | Правила игнорирования файлов |
| `.env.example` | Пример конфигурации |
| `.git/` | Git репозиторий (не публикуется) |

## Примечание

Скрытые файлы и директории (начинающиеся с `.`) — это стандартная практика в Linux/Unix системах. Они используются для:
- Конфигурационных файлов (`.gitignore`, `.env`)
- Системных директорий (`.git`, `.github`)
- Настроек инструментов (`.vscode`, `.idea`)

Эти файлы важны для работы проекта, даже если они не отображаются в файловом менеджере по умолчанию.
