#!/bin/bash
#
# MTProto Suite — единый интерактивный установщик.
#
# Режимы работы:
#   panel  — установить только панель управления (frontend + backend + db)
#   node   — установить только сервис-ноду (proxy runtime на сервере с прокси)
#   both   — установить оба компонента на одной машине (для тестирования)
#
# Использование:
#   bash install.sh                    — интерактивный режим
#   bash install.sh --mode=panel       — только панель
#   bash install.sh --mode=node        — только нода
#   bash install.sh --mode=both        — оба компонента
#   bash install.sh --mode=panel --ssl-letsencrypt example.com
#   bash install.sh --uninstall
#
# Все режимы используют Docker-контейнеры — нативной установки Node.js нет.

set -e

# Цвета для вывода (используем $'...' для интерпретации escape-последовательностей)
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
RED=$'\033[0;31m'
BOLD=$'\033[1m'
NC=$'\033[0m'

# Дефолты
REPO_URL="${REPO_URL:-https://github.com/ns8-support/mtproto-suite.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/mtproto-suite}"
MODE=""
SSL_MODE="none"
SSL_DOMAIN=""
AUTO_YES=false

# ============ CLI args ============

print_usage() {
  echo -e "${BOLD}MTProto Suite — Установщик${NC}"
  echo ""
  echo -e "Использование:"
  echo -e "  bash install.sh [опции]"
  echo ""
  echo -e "Опции:"
  echo -e "  --mode=panel|node|both   Что устанавливать (по умолчанию — интерактивный выбор)"
  echo -e "  --ssl-self               Самоподписанный SSL для панели (только в режиме panel)"
  echo -e "  --ssl-letsencrypt DOM    Let's Encrypt для указанного домена"
  echo -e "  --install-dir DIR        Куда клонировать (по умолчанию /opt/mtproto-suite)"
  echo -e "  --repo URL               URL репозитория"
  echo -e "  -y, --yes                Не спрашивать подтверждения"
  echo -e "  --uninstall              Удалить установку"
  echo -e "  --help                   Эта справка"
  echo ""
  echo -e "Примеры:"
  echo -e "  bash install.sh --mode=panel"
  echo -e "  bash install.sh --mode=node"
  echo -e "  bash install.sh --mode=both -y"
  echo -e "  bash install.sh --mode=panel --ssl-letsencrypt panel.example.com"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode=*) MODE="${1#*=}" ;;
    --ssl-self) SSL_MODE="self" ;;
    --ssl-letsencrypt) SSL_MODE="letsencrypt"; SSL_DOMAIN="$2"; shift ;;
    --install-dir=*) INSTALL_DIR="${1#*=}" ;;
    --install-dir) INSTALL_DIR="$2"; shift ;;
    --repo=*) REPO_URL="${1#*=}" ;;
    --repo) REPO_URL="$2"; shift ;;
    -y|--yes) AUTO_YES=true ;;
    --uninstall) MODE="uninstall" ;;
    --help|-h) print_usage; exit 0 ;;
    *) echo -e "${RED}Неизвестная опция: $1${NC}"; print_usage; exit 1 ;;
  esac
  shift
done

# ============ Удаление ============

if [ "$MODE" = "uninstall" ]; then
  echo -e "${YELLOW}========================================${NC}"
  echo -e "${YELLOW}  Удаление MTProto Suite                ${NC}"
  echo -e "${YELLOW}========================================${NC}"
  echo ""
  echo -e "Будет удалено:"
  echo "  - Каталог: $INSTALL_DIR"
  echo "  - Docker контейнеры панели и ноды"
  echo "  - Docker volumes (БД и данные нод)"
  echo "  - SSL сертификаты"
  echo ""
  if [ "$AUTO_YES" != true ]; then
    read -p "Продолжить? (yes/no): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
      echo -e "${YELLOW}Отменено.${NC}"
      exit 0
    fi
  fi

  if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}Требуются права root.${NC}"
    exit 1
  fi

  if [ -d "$INSTALL_DIR" ]; then
    cd "$INSTALL_DIR"
    # Останавливаем и удаляем все compose-проекты, которые могли быть созданы
    for project in mtproto-panel mtproto-node mtproto-suite; do
      COMPOSE_PROJECT_NAME=$project docker compose down -v --remove-orphans 2>/dev/null || true
    done
    # Удаляем external network, если осталась
    docker network rm mtproto-net 2>/dev/null || true
  fi

  cd /
  rm -rf "$INSTALL_DIR"

  # Удаляем volumes
  docker volume rm mtproto-panel_pgdata mtproto-suite_pgdata 2>/dev/null || true
  for v in $(docker volume ls -q | grep -E 'mtproto(-suite)?_(pgdata|node-data)' 2>/dev/null); do
    docker volume rm "$v" 2>/dev/null || true
  done

  echo ""
  echo -e "${GREEN}MTProto Suite удалён.${NC}"
  exit 0
fi

# ============ Префлайт проверки ============

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  MTProto Suite — Установка            ${NC}"
echo -e "${CYAN}========================================${NC}"

# Только root.
if [ "$(id -u)" -ne 0 ]; then
  echo -e "${RED}Ошибка: запустите скрипт от root (sudo).${NC}"
  echo "  sudo bash install.sh"
  exit 1
fi

# Поддерживаемые архитектуры.
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|aarch64) ;;
  *) echo -e "${RED}Неподдерживаемая архитектура: $ARCH (только x86_64, aarch64)${NC}"; exit 1 ;;
esac

# ============ Выбор режима (если не указан) ============

if [ -z "$MODE" ]; then
  if [ "$AUTO_YES" != true ]; then
    # Проверка: stdin должен быть терминалом для интерактивного выбора
    if [ ! -t 0 ]; then
      echo -e "${RED}Ошибка: интерактивный выбор невозможен (stdin не является терминалом).${NC}"
      echo ""
      echo "Укажите режим явно через аргумент --mode:"
      echo "  bash install.sh --mode=panel    # Только панель"
      echo "  bash install.sh --mode=node     # Только нода"
      echo "  bash install.sh --mode=both     # Оба компонента"
      echo ""
      echo "Или запустите скрипт напрямую (не через pipe):"
      echo "  bash install.sh"
      exit 1
    fi
    echo ""
    echo -e "${BOLD}Что устанавливать?${NC}"
    echo ""
    echo "  1) panel — Панель управления (frontend + backend + PostgreSQL)"
    echo "            Устанавливается на сервер с UI для администрирования"
    echo ""
    echo "  2) node  — Сервис-нода (proxy runtime)"
    echo "            Устанавливается на СЕРВЕР С ПРОКСИ, управляется через панель"
    echo ""
    echo "  3) both  — Панель + нода на одной машине"
    echo "            Для тестирования или домашнего использования"
    echo ""
    while true; do
      read -p "Выберите режим [1/2/3]: " CHOICE
      case "$CHOICE" in
        1|panel) MODE="panel"; break ;;
        2|node) MODE="node"; break ;;
        3|both) MODE="both"; break ;;
        *) echo -e "${RED}Введите 1, 2 или 3${NC}" ;;
      esac
    done
  else
    echo -e "${RED}В режиме -y необходимо указать --mode=panel|node|both${NC}"
    exit 1
  fi
fi

case "$MODE" in
  panel|node|both) ;;
  *) echo -e "${RED}Неверный режим: $MODE (должно быть panel, node или both)${NC}"; exit 1 ;;
esac

echo ""
echo -e "${GREEN}Режим: ${BOLD}${MODE}${NC}"

# ============ Установка системных зависимостей ============

install_package() {
  if command -v apt-get &> /dev/null; then
    apt-get update -qq && apt-get install -y -qq "$@" 2>&1 | grep -v 'is already the newest' || true
  elif command -v yum &> /dev/null; then
    yum install -y -q "$@" 2>&1 | tail -5 || true
  elif command -v dnf &> /dev/null; then
    dnf install -y -q "$@" 2>&1 | tail -5 || true
  elif command -v apk &> /dev/null; then
    apk add --no-cache "$@" 2>&1 | tail -3 || true
  else
    echo -e "${RED}Неизвестный пакетный менеджер. Установите зависимости вручную: $*${NC}"
    exit 1
  fi
}

# curl, openssl, git — для всех режимов.
for cmd in curl openssl git; do
  if ! command -v "$cmd" &> /dev/null; then
    echo -e "${YELLOW}Устанавливаю $cmd...${NC}"
    install_package "$cmd" || { echo -e "${RED}Не удалось установить $cmd${NC}"; exit 1; }
  fi
done

# Docker.
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}Docker не найден. Устанавливаю...${NC}"
  curl -fsSL https://get.docker.com | sh || { echo -e "${RED}Не удалось установить Docker${NC}"; exit 1; }
  systemctl enable docker && systemctl start docker || true
fi

# Проверка версии Docker.
DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0.0")
DOCKER_MAJOR=$(echo "$DOCKER_VERSION" | cut -d. -f1)
DOCKER_MINOR=$(echo "$DOCKER_VERSION" | cut -d. -f2)
if [ "$DOCKER_MAJOR" -lt 20 ] || { [ "$DOCKER_MAJOR" -eq 20 ] && [ "$DOCKER_MINOR" -lt 10 ]; }; then
  echo -e "${RED}Docker $DOCKER_VERSION устарел. Требуется >= 20.10${NC}"
  exit 1
fi

# Docker Compose plugin.
if ! docker compose version &> /dev/null 2>&1; then
  echo -e "${YELLOW}Docker Compose не найден. Устанавливаю...${NC}"
  COMPOSE_VERSION=$(curl -fsSL https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
  COMPOSE_VERSION=${COMPOSE_VERSION:-v2.34.0}
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-${ARCH}" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

# certbot для Let's Encrypt.
if [ "$SSL_MODE" = "letsencrypt" ] && ! command -v certbot &> /dev/null; then
  install_package certbot || { echo -e "${RED}Не удалось установить certbot${NC}"; exit 1; }
fi

# ============ Клонирование / обновление репозитория ============

if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "${CYAN}Обновление существующей установки...${NC}"
  cd "$INSTALL_DIR"
  # Сохраняем пользовательские файлы перед reset
  for envfile in .env panel-backend/.env service-node/.env service-node/.env.bak .env.bak; do
    [ -f "$envfile" ] && cp "$envfile" "${envfile}.pre-update"
  done
  git fetch origin main 2>/dev/null || true
  git reset --hard origin/main
  # Восстанавливаем
  for envfile in .env panel-backend/.env service-node/.env; do
    [ -f "${envfile}.pre-update" ] && mv "${envfile}.pre-update" "$envfile"
  done
  [ -f .env.bak.pre-update ] && rm -f .env.bak.pre-update
  [ -f service-node/.env.bak.pre-update ] && rm -f service-node/.env.bak.pre-update
else
  echo -e "${CYAN}Клонирование репозитория...${NC}"
  rm -rf "$INSTALL_DIR"
  git clone --branch main "$REPO_URL" "$INSTALL_DIR" || {
    echo -e "${RED}Не удалось клонировать репозиторий${NC}"; exit 1;
  }
  cd "$INSTALL_DIR"
fi

# Проверяем структуру
if [ ! -f docker-compose.yml ]; then
  echo -e "${RED}Ошибка: репозиторий не содержит ожидаемой структуры.${NC}"
  exit 1
fi

# ============ Утилита для запроса параметров ============

# Запрашивает значение с дефолтом и валидацией
# Использование: ask "Вопрос" "дефолт" "regex_проверка" "сообщение_об_ошибке"
ask() {
  local prompt="$1"
  local default="$2"
  local regex="$3"
  local error_msg="$4"

  while true; do
    if [ "$AUTO_YES" = true ] && [ -n "$default" ]; then
      echo "$prompt [$default]: $default"
      REPLY="$default"
      break
    fi
    # Защита от зависания если stdin не терминал
    if [ ! -t 0 ]; then
      if [ -n "$default" ]; then
        echo "$prompt [$default]: $default (auto — stdin не терминал)"
        REPLY="$default"
        break
      else
        echo -e "${RED}Ошибка: требуется ввод, но stdin не является терминалом.${NC}"
        echo "Используйте -y для автоматического режима или запустите интерактивно."
        exit 1
      fi
    fi
    read -p "$prompt [$default]: " REPLY
    REPLY=${REPLY:-$default}
    if [ -z "$regex" ] || [[ "$REPLY" =~ $regex ]]; then
      break
    fi
    echo -e "${RED}$error_msg${NC}"
  done
}

# Запрашивает пароль (с подтверждением для интерактивного режима)
ask_password() {
  local prompt="$1"
  local min_length="${2:-8}"

  while true; do
    if [ "$AUTO_YES" = true ]; then
      PASSWORD=$(openssl rand -base64 16)
      return
    fi
    # Защита от зависания если stdin не терминал
    if [ ! -t 0 ]; then
      PASSWORD=$(openssl rand -base64 16)
      echo "$prompt: [auto-generated — stdin не терминал]"
      return
    fi
    read -s -p "$prompt: " PASSWORD
    echo ""
    if [ ${#PASSWORD} -lt "$min_length" ]; then
      echo -e "${RED}Пароль должен быть минимум $min_length символов.${NC}"
      continue
    fi
    read -s -p "Подтвердите пароль: " PASSWORD_CONFIRM
    echo ""
    if [ "$PASSWORD" != "$PASSWORD_CONFIRM" ]; then
      echo -e "${RED}Пароли не совпадают.${NC}"
      continue
    fi
    return
  done
}

# ============ Общая конфигурация для SSL ============

configure_ssl() {
  # В режиме node SSL не нужен.
  if [ "$MODE" = "node" ]; then
    return
  fi

  if [ "$SSL_MODE" = "none" ] && [ "$AUTO_YES" != true ]; then
    echo ""
    echo -e "${BOLD}SSL для панели?${NC}"
    echo "  1) Без SSL (HTTP)"
    echo "  2) Самоподписанный сертификат"
    echo "  3) Let's Encrypt (требуется домен)"
    read -p "Выберите [1/2/3]: " SSL_CHOICE
    case "$SSL_CHOICE" in
      2) SSL_MODE="self" ;;
      3) SSL_MODE="letsencrypt" ;;
      *) SSL_MODE="none" ;;
    esac
  fi

  if [ "$SSL_MODE" = "letsencrypt" ] && [ -z "$SSL_DOMAIN" ]; then
    if [ "$AUTO_YES" != true ]; then
      read -p "Домен для Let's Encrypt: " SSL_DOMAIN
    else
      echo -e "${RED}Для --ssl-letsencrypt необходимо указать домен${NC}"
      exit 1
    fi
  fi

  if [ "$SSL_MODE" = "self" ]; then
    echo -e "${CYAN}Генерация самоподписанного сертификата...${NC}"
    mkdir -p ssl
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout ssl/key.pem -out ssl/cert.pem \
      -subj "/CN=mtproto-panel" 2>/dev/null
    echo -e "${GREEN}Сертификат: $INSTALL_DIR/ssl/${NC}"
  elif [ "$SSL_MODE" = "letsencrypt" ]; then
    echo -e "${CYAN}Получение Let's Encrypt сертификата для ${SSL_DOMAIN}...${NC}"
    mkdir -p ssl
    # Остановим 80 порт, если занят (для standalone)
    systemctl stop nginx 2>/dev/null || true
    certbot certonly --standalone -d "$SSL_DOMAIN" --agree-tos --register-unsafely-without-email || {
      echo -e "${RED}Не удалось получить сертификат${NC}"; exit 1;
    }
    ln -sf /etc/letsencrypt/live/$SSL_DOMAIN/fullchain.pem ssl/cert.pem
    ln -sf /etc/letsencrypt/live/$SSL_DOMAIN/privkey.pem ssl/key.pem
    # Настройка автообновления
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --deploy-hook 'docker compose restart frontend'") | crontab - 2>/dev/null || true
  fi
}

# ============ Настройка и запуск панели ============

install_panel() {
  echo ""
  echo -e "${CYAN}========================================${NC}"
  echo -e "${CYAN}  Настройка панели управления           ${NC}"
  echo -e "${CYAN}========================================${NC}"

  # Порт панели
  ask "Внешний порт панели (HTTP)" "80" '^[0-9]+$' "Некорректный порт"
  PANEL_PORT=$REPLY
  while [ "$PANEL_PORT" -lt 1 ] || [ "$PANEL_PORT" -gt 65535 ]; do
    echo -e "${RED}Порт должен быть от 1 до 65535${NC}"
    ask "Внешний порт панели (HTTP)" "80" '^[0-9]+$' ""
    PANEL_PORT=$REPLY
  done

  # Логин
  ask "Логин администратора" "admin" '^[a-zA-Z0-9_.-]{3,64}$' "Логин 3-64 символа, только буквы/цифры/_.-"
  ADMIN_USERNAME=$REPLY

  # Пароль
  ask_password "Пароль администратора (минимум 8 символов)" 8
  ADMIN_PASSWORD=$PASSWORD

  # Генерация секретов
  JWT_SECRET=$(openssl rand -hex 32)
  DB_PASSWORD=$(openssl rand -hex 16)

  # Если .env уже есть — переиспользуем секреты
  if [ -f .env ]; then
    if [ "$AUTO_YES" != true ]; then
      echo ""
      echo -e "${YELLOW}Найден существующий .env${NC}"
      read -p "Переиспользовать секреты и БД? (yes/no): " REUSE
    else
      REUSE="yes"
    fi
    if [ "$REUSE" = "yes" ]; then
      source <(grep -E '^(JWT_SECRET|DB_PASSWORD|DB_NAME|DB_USER)=' .env || true)
      JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
      DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"
    fi
  fi

  # Запись .env в корень проекта (docker-compose ищет .env в CWD)
  cat > .env << EOF
PORT=${PANEL_PORT}
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
JWT_SECRET=${JWT_SECRET}
DB_NAME=mtproto_panel
DB_USER=mtproto
DB_PASSWORD=${DB_PASSWORD}
NODE_ENV=production
NODE_REQUEST_TIMEOUT_MS=30000
EOF
  chmod 600 .env

  # SSL конфигурация
  configure_ssl

  echo ""
  echo -e "${GREEN}Конфигурация панели:${NC}"
  echo "  Порт: ${PANEL_PORT}"
  echo "  Логин: ${ADMIN_USERNAME}"
  [ "$SSL_MODE" != "none" ] && echo "  SSL: ${SSL_MODE}${SSL_DOMAIN:+ ($SSL_DOMAIN)}"
  echo ""

  # Запуск контейнеров
  echo -e "${CYAN}Запуск контейнеров панели...${NC}"
  export COMPOSE_PROJECT_NAME=mtproto-panel

  # Пробуем скачать образы из GHCR, если не получается — собираем локально
  echo -e "${CYAN}Попытка загрузки образов из GHCR...${NC}"
  if [ "$SSL_MODE" != "none" ]; then
    if COMPOSE_FILE="docker-compose.yml:docker-compose.ssl.yml" docker compose pull 2>/dev/null; then
      echo -e "${GREEN}Образы загружены из GHCR${NC}"
      COMPOSE_FILE="docker-compose.yml:docker-compose.ssl.yml" docker compose up -d
    else
      echo -e "${YELLOW}Образы не найдены в GHCR, локальная сборка...${NC}"
      COMPOSE_FILE="docker-compose.yml:docker-compose.ssl.yml" docker compose up -d --build
    fi
  else
    if docker compose pull 2>/dev/null; then
      echo -e "${GREEN}Образы загружены из GHCR${NC}"
      docker compose up -d
    else
      echo -e "${YELLOW}Образы не найдены в GHCR, локальная сборка...${NC}"
      docker compose up -d --build
    fi
  fi

  # Ждём готовности
  echo -e "${CYAN}Ожидание готовности backend...${NC}"
  for i in {1..30}; do
    if docker compose exec -T backend wget --quiet --tries=1 --spider http://localhost:3000/api/health 2>/dev/null; then
      break
    fi
    sleep 2
  done

  SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  SERVER_IP=${SERVER_IP:-"localhost"}

  PROTOCOL="http"
  [ "$SSL_MODE" != "none" ] && PROTOCOL="https"

  echo ""
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}  ✓ Панель установлена и запущена       ${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""
  echo -e "  URL:        ${CYAN}${PROTOCOL}://${SERVER_IP}:${PANEL_PORT}${NC}"
  echo -e "  Логин:      ${YELLOW}${ADMIN_USERNAME}${NC}"
  echo -e "  Пароль:     ${YELLOW}${ADMIN_PASSWORD}${NC}"
  echo -e "  Каталог:    ${YELLOW}${INSTALL_DIR}${NC}"
  echo ""
  if [ "$MODE" = "panel" ]; then
    echo -e "${YELLOW}Следующий шаг: установите service-node на прокси-сервере${NC}"
    echo -e "${CYAN}  bash <(wget -qO- https://raw.githubusercontent.com/ns8-support/mtproto-suite/main/install.sh) --mode=node${NC}"
    echo ""
    echo -e "${YELLOW}Или установите оба компонента здесь для теста:${NC}"
    echo -e "${CYAN}  cd ${INSTALL_DIR} && bash install.sh --mode=both -y${NC}"
  fi
}

# ============ Настройка и запуск ноды ============

install_node() {
  echo ""
  echo -e "${CYAN}========================================${NC}"
  echo -e "${CYAN}  Настройка сервис-ноды                 ${NC}"
  echo -e "${CYAN}========================================${NC}"

  # Порт API ноды
  ask "Порт API ноды" "8443" '^[0-9]+$' "Некорректный порт"
  NODE_PORT=$REPLY
  while [ "$NODE_PORT" -lt 1 ] || [ "$NODE_PORT" -gt 65535 ]; do
    echo -e "${RED}Порт должен быть от 1 до 65535${NC}"
    ask "Порт API ноды" "8443" '^[0-9]+$' ""
    NODE_PORT=$REPLY
  done

  # Порт nginx (для прокси трафика)
  ask "Порт прокси (nginx)" "443" '^[0-9]+$' "Некорректный порт"
  NGINX_PORT=$REPLY
  while [ "$NGINX_PORT" -lt 1 ] || [ "$NGINX_PORT" -gt 65535 ]; do
    echo -e "${RED}Порт должен быть от 1 до 65535${NC}"
    ask "Порт прокси (nginx)" "443" '^[0-9]+$' ""
    NGINX_PORT=$REPLY
  done

  # NAT_IP (опционально для VPN-режима)
  if [ "$AUTO_YES" != true ]; then
    echo ""
    echo -e "${BOLD}VPN-туннелирование (опционально)${NC}"
    echo "Если вы используете VLESS/Reality VPN, укажите NAT_IP — публичный IP вашего VPN-сервера."
    echo "Оставьте пустым, если туннель не используется."
    read -p "NAT_IP (публичный IP VPN exit-ноды): " NAT_IP
  else
    NAT_IP="${NAT_IP:-}"
  fi

  # Генерация токена
  AUTH_TOKEN=$(openssl rand -hex 32)

  # Если .env уже есть — переиспользуем токен
  if [ -f service-node/.env ]; then
    if [ "$AUTO_YES" != true ]; then
      echo ""
      echo -e "${YELLOW}Найден существующий service-node/.env${NC}"
      read -p "Переиспользовать токен? (yes/no): " REUSE
    else
      REUSE="yes"
    fi
    if [ "$REUSE" = "yes" ]; then
      source <(grep -E '^AUTH_TOKEN=' service-node/.env || true)
      AUTH_TOKEN="${AUTH_TOKEN:-$(openssl rand -hex 32)}"
    fi
  fi

  # Запись .env
  cat > service-node/.env << EOF
PORT=${NODE_PORT}
NGINX_PORT=${NGINX_PORT}
AUTH_TOKEN=${AUTH_TOKEN}
NAT_IP=${NAT_IP}
TUNNEL_INTERFACE=${TUNNEL_INTERFACE:-}
EOF
  chmod 600 service-node/.env

  echo ""
  echo -e "${GREEN}Конфигурация ноды:${NC}"
  echo "  API port: ${NODE_PORT}"
  echo "  Proxy port: ${NGINX_PORT}"
  [ -n "$NAT_IP" ] && echo "  NAT_IP: ${NAT_IP} (VPN-режим)"
  echo ""

  # Создаём общую сеть и каталог данных
  docker network create mtproto-net 2>/dev/null || true
  mkdir -p service-node/data

  # Запуск
  echo -e "${CYAN}Запуск контейнера ноды...${NC}"
  cd service-node
  export COMPOSE_PROJECT_NAME=mtproto-node

  # Пробуем скачать образ из GHCR, если не получается — собираем локально
  echo -e "${CYAN}Попытка загрузки образа из GHCR...${NC}"
  if docker compose pull 2>/dev/null; then
    echo -e "${GREEN}Образ загружен из GHCR${NC}"
  else
    echo -e "${YELLOW}Образ не найден в GHCR, локальная сборка...${NC}"
    docker compose build || { echo -e "${RED}Сборка не удалась${NC}"; exit 1; }
  fi

  docker compose up -d || { echo -e "${RED}Не удалось запустить${NC}"; exit 1; }

  cd ..

  # Ждём готовности
  echo -e "${CYAN}Ожидание готовности...${NC}"
  for i in {1..30}; do
    if curl -fsS -m 2 "http://localhost:${NODE_PORT}/api/health" -H "Authorization: Bearer ${AUTH_TOKEN}" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done

  SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  SERVER_IP=${SERVER_IP:-"localhost"}

  echo ""
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}  ✓ Сервис-нода установлена              ${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""
  echo -e "  API:        ${CYAN}http://${SERVER_IP}:${NODE_PORT}/api/health${NC}"
  echo -e "  Proxy port: ${YELLOW}${NGINX_PORT}${NC}"
  echo -e "  Токен:      ${YELLOW}${AUTH_TOKEN}${NC}"
  echo -e "  Каталог:    ${YELLOW}${INSTALL_DIR}${NC}"
  echo ""
  echo -e "${BOLD}Добавьте эту ноду в панель:${NC}"
  echo -e "  Name:     ${CYAN}Node ${SERVER_IP}${NC}"
  echo -e "  IP:       ${CYAN}${SERVER_IP}${NC}"
  echo -e "  Port:     ${CYAN}${NODE_PORT}${NC}"
  echo -e "  Token:    ${YELLOW}${AUTH_TOKEN}${NC}"
  echo ""
}

# ============ Режим both: панель + нода на одной машине ============

install_both() {
  echo ""
  echo -e "${CYAN}========================================${NC}"
  echo -e "${CYAN}  Установка панели + ноды на одном хосте ${NC}"
  echo -e "${CYAN}========================================${NC}"
  echo ""
  echo "Этот режим полезен для:"
  echo "  • Локальной разработки и тестирования"
  echo "  • Домашнего использования"
  echo "  • Демонстрации возможностей"
  echo ""
  echo "В production панель и ноды лучше разносить на разные серверы."
  echo ""

  # Параметры панели
  ask "Внешний порт панели (HTTP)" "80" '^[0-9]+$' "Некорректный порт"
  PANEL_PORT=$REPLY
  ask "Логин администратора" "admin" '^[a-zA-Z0-9_.-]{3,64}$' "Логин 3-64 символа"
  ADMIN_USERNAME=$REPLY
  ask_password "Пароль администратора (минимум 8 символов)" 8
  ADMIN_PASSWORD=$PASSWORD

  # Параметры ноды
  ask "Порт API ноды" "8443" '^[0-9]+$' "Некорректный порт"
  NODE_PORT=$REPLY
  ask "Порт прокси (nginx)" "443" '^[0-9]+$' "Некорректный порт"
  NGINX_PORT=$REPLY

  if [ "$AUTO_YES" != true ]; then
    echo ""
    read -p "NAT_IP (публичный IP VPN exit-ноды, опционально): " NAT_IP
  else
    NAT_IP="${NAT_IP:-}"
  fi

  # Генерация секретов
  JWT_SECRET=$(openssl rand -hex 32)
  DB_PASSWORD=$(openssl rand -hex 16)
  AUTH_TOKEN=$(openssl rand -hex 32)

  # Запись .env
  cat > .env << EOF
PORT=${PANEL_PORT}
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
JWT_SECRET=${JWT_SECRET}
DB_NAME=mtproto_panel
DB_USER=mtproto
DB_PASSWORD=${DB_PASSWORD}
NODE_REQUEST_TIMEOUT_MS=5000
NODE_ENV=production

# Service node (same host)
NODE_PORT=${NODE_PORT}
NGINX_PORT=${NGINX_PORT}
AUTH_TOKEN=${AUTH_TOKEN}
NAT_IP=${NAT_IP}
EOF
  chmod 600 .env

  # SSL для панели (опционально)
  MODE_BACKUP="$MODE"
  MODE="panel"
  configure_ssl
  MODE="$MODE_BACKUP"

  # Каталог данных
  mkdir -p service-node/data

  # Запуск через docker-compose.both.yml
  echo ""
  echo -e "${CYAN}Запуск панели + ноды на одной машине...${NC}"
  export COMPOSE_PROJECT_NAME=mtproto-suite

  # Создаём сеть заранее
  docker network create mtproto-net 2>/dev/null || true

  COMPOSE_FILE="docker-compose.both.yml"
  if [ "$SSL_MODE" != "none" ]; then
    # С SSL — добавляем volumes для cert и nginx-ssl.conf
    COMPOSE_FILE="docker-compose.both.yml"
  fi

  # Пробуем скачать образы из GHCR, если не получается — собираем локально
  echo -e "${CYAN}Попытка загрузки образов из GHCR...${NC}"
  if docker compose -f "$COMPOSE_FILE" pull 2>/dev/null; then
    echo -e "${GREEN}Образы загружены из GHCR${NC}"
    docker compose -f "$COMPOSE_FILE" up -d || {
      echo -e "${RED}Не удалось запустить контейнеры${NC}"; exit 1;
    }
  else
    echo -e "${YELLOW}Образы не найдены в GHCR, локальная сборка...${NC}"
    docker compose -f "$COMPOSE_FILE" up -d --build || {
      echo -e "${RED}Не удалось запустить контейнеры${NC}"; exit 1;
    }
  fi

  # Ждём готовности панели
  echo -e "${CYAN}Ожидание готовности панели...${NC}"
  for i in {1..40}; do
    if curl -fsS -m 2 "http://localhost:${PANEL_PORT}/api/health" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done

  SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  SERVER_IP=${SERVER_IP:-"localhost"}

  PROTOCOL="http"
  [ "$SSL_MODE" != "none" ] && PROTOCOL="https"

  echo ""
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}  ✓ Панель + нода установлены            ${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""
  echo -e "  Панель:      ${CYAN}${PROTOCOL}://${SERVER_IP}:${PANEL_PORT}${NC}"
  echo -e "  Логин:       ${YELLOW}${ADMIN_USERNAME}${NC}"
  echo -e "  Пароль:      ${YELLOW}${ADMIN_PASSWORD}${NC}"
  echo ""
  echo -e "  Нода API:    ${CYAN}http://127.0.0.1:${NODE_PORT}${NC}"
  echo -e "  Нода proxy:  ${YELLOW}${NGINX_PORT}/tcp${NC} (localhost only)"
  echo -e "  Токен:       ${YELLOW}${AUTH_TOKEN}${NC}"
  echo -e "  Каталог:     ${YELLOW}${INSTALL_DIR}${NC}"
  echo ""
  echo -e "${YELLOW}Добавьте ноду в панели через UI:${NC}"
  echo -e "  Name:     ${CYAN}Local Node${NC}"
  echo -e "  IP:       ${CYAN}127.0.0.1${NC}  (или ${SERVER_IP} с другой машины)"
  echo -e "  Port:     ${CYAN}${NODE_PORT}${NC}"
  echo -e "  Token:    ${YELLOW}${AUTH_TOKEN}${NC}"
  echo ""
}

# ============ Запуск соответствующего режима ============

case "$MODE" in
  panel) install_panel ;;
  node) install_node ;;
  both) install_both ;;
esac

echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Документация: ${REPO_URL}              ${NC}"
echo -e "${CYAN}  Логи: docker compose logs -f            ${NC}"
echo -e "${CYAN}========================================${NC}"
