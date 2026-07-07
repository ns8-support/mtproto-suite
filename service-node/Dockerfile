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
# Локальная зависимость через file: ссылается на собранный shared
RUN npm link ../shared && npm install --no-audit --no-fund && npm run build && npm prune --production

# ============ Production stage ============
FROM node:20-alpine

RUN apk add --no-cache bash git docker-cli docker-cli-compose

WORKDIR /app

# Копируем собранные артефакты и production dependencies
COPY --from=builder /app/service-node/dist ./dist
COPY --from=builder /app/service-node/package.json ./
COPY --from=builder /app/service-node/node_modules ./node_modules
COPY --from=builder /app/shared/package.json /app/shared/dist /app/shared/

# update.sh нужен для self-update через UI панели
COPY service-node/update.sh /app/project/update.sh
RUN chmod +x /app/project/update.sh

EXPOSE 8443

# Health check для Docker
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8443/api/health || exit 1

CMD ["node", "dist/index.js"]
