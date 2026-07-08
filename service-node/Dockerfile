# Multi-stage build для уменьшения размера финального образа.
FROM node:20-alpine AS builder

WORKDIR /app

# Копируем и собираем shared пакет (нужен для обоих сервисов)
COPY shared ./shared
WORKDIR /app/shared
RUN npm install --no-audit --no-fund && npm run build

WORKDIR /app
COPY service-node ./service-node
WORKDIR /app/service-node
# Явная установка shared для Docker контекста (путь ../shared)
RUN npm install --no-audit --no-fund @mtproto-suite/shared@file:../shared && npm install --no-audit --no-fund && npm run build && npm prune --production

# ============ Production stage ============
FROM node:20-alpine

RUN apk add --no-cache bash git docker-cli docker-cli-compose

WORKDIR /app

# Копируем собранные артефакты и production dependencies
COPY --from=builder /app/service-node/dist ./dist
COPY --from=builder /app/service-node/package.json ./
COPY --from=builder /app/service-node/node_modules ./node_modules
COPY --from=builder /app/shared/package.json /app/shared/
COPY --from=builder /app/shared/dist /app/shared/dist
COPY --from=builder /app/shared/types /app/shared/types
COPY --from=builder /app/shared/utils /app/shared/utils

# update.sh нужен для self-update через UI панели
COPY service-node/update.sh /app/project/update.sh
RUN chmod +x /app/project/update.sh

EXPOSE 8443

# Health check для Docker
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8443/api/health || exit 1

# Точка входа после сборки: service-node/src/index.js
# (tsc с rootDir=repo кладёт собранный код в dist/service-node/src/)
CMD ["node", "dist/service-node/src/index.js"]
