# Multi-stage build
FROM node:20-alpine AS builder

WORKDIR /app

COPY shared ./shared
WORKDIR /app/shared
RUN npm install --no-audit --no-fund && npm run build

WORKDIR /app
COPY panel-backend ./panel-backend
WORKDIR /app/panel-backend
RUN npm link ../shared && npm install --no-audit --no-fund && npm run build && npm prune --production

FROM node:20-alpine

RUN apk add --no-cache bash git docker-cli

WORKDIR /app

COPY --from=builder /app/panel-backend/dist ./dist
COPY --from=builder /app/panel-backend/package.json ./
COPY --from=builder /app/panel-backend/node_modules ./node_modules
COPY --from=builder /app/shared/package.json /app/shared/dist /app/shared/

COPY panel-backend/update.sh /app/project/update.sh
RUN chmod +x /app/project/update.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "dist/index.js"]
