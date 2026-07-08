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

# Компилируем TypeScript и проверяем, что dist создана
RUN npm run build && ls -la dist/ || (echo "Build failed!" && exit 1)

# Удаляем devDependencies после успешной сборки
RUN npm prune --production

FROM node:20-alpine

RUN apk add --no-cache bash git docker-cli

WORKDIR /app

COPY --from=builder /app/panel-backend/dist ./dist
COPY --from=builder /app/panel-backend/package.json ./
COPY --from=builder /app/panel-backend/node_modules ./node_modules
COPY --from=builder /app/shared/package.json /app/shared/
COPY --from=builder /app/shared/dist /app/shared/dist
COPY --from=builder /app/shared/types /app/shared/types
COPY --from=builder /app/shared/utils /app/shared/utils

COPY panel-backend/update.sh /app/project/update.sh
RUN chmod +x /app/project/update.sh

# Проверяем, что dist/index.js существует
RUN ls -la dist/ && test -f dist/index.js || (echo "dist/index.js not found!" && exit 1)

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist/index.js"]