import { Pool, PoolClient } from 'pg';
import { config } from '../config';

/**
 * Пул соединений к PostgreSQL.
 *
 * Исправления:
 * 1. Добавлены таймауты (idleTimeoutMillis, connectionTimeoutMillis) — было бесконечно.
 * 2. Лимит на размер пула (max: 10) — было неограничено.
 * 3. Обработка pool.on('error') — теперь только лог, без crash.
 */
export const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // Не крашим процесс — пул автоматически пересоздаст соединение.
  // eslint-disable-next-line no-console
  console.error('Unexpected database error:', err);
});

/**
 * Безопасная обёртка для выполнения запроса с явным клиентом.
 * Гарантирует release клиента обратно в пул.
 */
export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
