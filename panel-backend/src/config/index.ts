/**
 * Конфигурация panel-backend.
 *
 * Исправление: в оригинале был `jwtSecret: process.env.JWT_SECRET || 'change-me-in-production'`.
 * Теперь дефолт отсутствует — без JWT_SECRET сервер отказывается стартовать.
 *
 * dotenv подключается опционально (для dev-режима), в production переменные
 * передаются через docker-compose.
 */
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
} catch {
  // dotenv не установлен (например, в production-образе) — это OK,
  // переменные приходят из docker-compose.
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Required environment variable ${name} is not set. Refusing to start without it.`
    );
  }
  return value;
}

function parsePort(value: string | undefined, defaultValue: number): number {
  const parsed = parseInt(value || String(defaultValue), 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port value: ${value}`);
  }
  return parsed;
}

function getDbPassword(): string {
  const explicit = process.env.DB_PASSWORD;
  if (explicit && explicit !== 'mtproto') {
    return explicit;
  }
  if (process.env.NODE_ENV === 'production' && !explicit) {
    throw new Error('DB_PASSWORD must be set in production');
  }
  return explicit || 'mtproto';
}

export const config = {
  port: parsePort(process.env.PORT, 3000),
  jwtSecret: requireEnv('JWT_SECRET'),
  jwtExpiresIn: 24 * 60 * 60,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parsePort(process.env.DB_PORT, 5432),
    database: process.env.DB_NAME || 'mtproto_panel',
    user: process.env.DB_USER || 'mtproto',
    password: getDbPassword(),
  },
  nodeRequestTimeoutMs: parseInt(process.env.NODE_REQUEST_TIMEOUT_MS || '30000', 10),
  minTokenLength: 16,
};
