# Multi-stage build для React SPA
FROM node:20-alpine AS builder

WORKDIR /app

COPY shared ./shared
WORKDIR /app/shared
RUN npm install --no-audit --no-fund && npm run build

WORKDIR /app
COPY panel-frontend ./panel-frontend
WORKDIR /app/panel-frontend

# Отладка: показываем структуру
RUN echo "=== Структура /app ===" && ls -la /app/ && echo "=== Структура /app/shared ===" && ls -la /app/shared/ 2>/dev/null || echo "shared не найден"

# Устанавливаем shared пакет
RUN npm install --no-audit --no-fund @mtproto-suite/shared@file:../shared

# Отладка: проверяем, что shared установлен
RUN echo "=== node_modules/@mtproto-suite ===" && ls -la node_modules/@mtproto-suite/ 2>/dev/null || echo "shared не установлен" && echo "=== package.json shared ===" && cat node_modules/@mtproto-suite/shared/package.json 2>/dev/null || echo "package.json не найден"

# Устанавливаем остальные зависимости и собираем
RUN npm install --no-audit --no-fund && npm run build

# ============ Production stage — nginx для SPA ============
FROM nginx:alpine

# Копируем собранный SPA
COPY --from=builder /app/panel-frontend/dist /usr/share/nginx/html

# nginx конфиг: SPA fallback на index.html + reverse proxy для /api
# По умолчанию HTTP; SSL-конфигурация монтируется через docker-compose.ssl.yml
COPY panel-frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]

