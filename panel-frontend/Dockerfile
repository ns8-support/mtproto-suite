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

# Удаляем дефолтный конфиг nginx
RUN rm -f /etc/nginx/conf.d/default.conf

# nginx конфиг: SPA fallback на index.html + reverse proxy для /api
# Копируем как шаблон (envsubst подставит переменные при старте)
COPY panel-frontend/nginx.conf /etc/nginx/templates/default.conf.template

# Устанавливаем переменные по умолчанию
ENV BACKEND_PORT=3001
ENV NGINX_ENVSUBST_TEMPLATE_DIR=/etc/nginx/templates
ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/conf.d

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

# nginx:alpine автоматически обрабатывает /etc/nginx/templates/*.template с помощью envsubst
CMD ["nginx", "-g", "daemon off;"]
