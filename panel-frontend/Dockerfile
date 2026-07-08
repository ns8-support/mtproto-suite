# Multi-stage build для React SPA
FROM node:20-alpine AS builder

WORKDIR /app

# Копируем и собираем shared пакет
COPY shared ./shared
WORKDIR /app/shared
RUN npm install --no-audit --no-fund && npm run build

# Копируем frontend и устанавливаем зависимости
WORKDIR /app
COPY panel-frontend ./panel-frontend
WORKDIR /app/panel-frontend

# Устанавливаем shared пакет из локального пути
RUN npm install --no-audit --no-fund @mtproto-suite/shared@file:../shared

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

