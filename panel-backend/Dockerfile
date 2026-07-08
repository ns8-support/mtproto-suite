# Multi-stage build
FROM node:20-alpine AS builder

WORKDIR /app

COPY shared ./shared
WORKDIR /app/shared
RUN npm install --no-audit --no-fund && npm run build

WORKDIR /app
COPY panel-backend ./panel-backend
WORKDIR /app/panel-backend

# Устанавливаем shared пакет
RUN npm install --no-audit --no-fund @mtproto-suite/shared@file:../shared

# Устанавливаем зависимости
RUN npm install --no-audit --no-fund

# Показываем структуру перед сборкой
RUN echo "=== Перед сборкой ===" && ls -la

# Компилируем TypeScript с подробным выводом
RUN echo "=== TypeScript compilation ===" && npm run build 2>&1 && echo "=== Build completed ===" || (echo "TypeScript compilation failed!" && exit 1)

# Подробно проверяем структуру dist/
RUN echo "=== Структура dist/ ===" && find dist/ -type f 2>&1 | head -20 || echo "dist/ не найдена"

# Проверяем конкретные файлы
RUN echo "=== Проверка файлов ===" && ls -la dist/ && ls -la dist/index.js 2>&1 || echo "dist/index.js не найден"

# Проверяем структуру dist/shared (скомпилированный shared)
RUN echo "=== Структура dist/shared ===" && find dist/shared -type f 2>&1 | head -20 || echo "dist/shared не найдена"
RUN echo "=== Проверка dist/shared/utils ===" && ls -la dist/shared/utils/ 2>&1 || echo "dist/shared/utils не найдена"
RUN echo "=== Проверка dist/shared/utils/logger.js ===" && test -f dist/shared/utils/logger.js && echo "✅ logger.js найден в dist" || echo "❌ logger.js НЕ найден в dist"

# Удаляем devDependencies после успешной сборки
RUN npm prune --production

FROM node:20-alpine

RUN apk add --no-cache bash git docker-cli

WORKDIR /app

# Копируем структуру.
# Скомпилированный backend лежит в dist/panel-backend, shared — в dist/shared.
# Относительные require в собранных файлах указывают на ../../shared/...,
# поэтому раскладываем их так, чтобы из /app/panel-backend/src требовался
# /app/shared (а не /shared — из-за этого контейнер падал с MODULE_NOT_FOUND).
COPY --from=builder /app/panel-backend/dist/panel-backend ./panel-backend
COPY --from=builder /app/panel-backend/package.json ./panel-backend/
COPY --from=builder /app/panel-backend/node_modules ./panel-backend/node_modules

COPY --from=builder /app/panel-backend/dist/shared ./shared

COPY panel-backend/update.sh /app/project/update.sh
RUN chmod +x /app/project/update.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "panel-backend/src/index.js"]
