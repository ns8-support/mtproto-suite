import { pool, withClient } from './index';
import bcrypt from 'bcrypt';

/**
 * Миграции БД.
 *
 * Исправления:
 * 1. username теперь VARCHAR(64) вместо VARCHAR(255) — защита от аномально длинных имён.
 * 2. password_hash VARCHAR(60) — bcrypt-хэш всегда 60 символов, запас не нужен.
 * 3. nodes.token VARCHAR(64) — минимум 16 (валидируется на API), максимум 64.
 * 4. Добавлен индекс на nodes(ip) для быстрого поиска.
 * 5. Создаётся таблица proxy_overrides (кеш panel-специфичных overrides для прокси).
 */
export async function runMigrations(): Promise<void> {
  await withClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(64) UNIQUE NOT NULL,
        password_hash VARCHAR(60) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS nodes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL DEFAULT '',
        ip VARCHAR(255) NOT NULL,
        port INTEGER NOT NULL CHECK (port > 0 AND port <= 65535),
        token VARCHAR(64) NOT NULL,
        domain VARCHAR(255) NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Миграция для существующих таблиц без колонки domain.
    await client.query(`
      ALTER TABLE nodes ADD COLUMN IF NOT EXISTS domain VARCHAR(255) NOT NULL DEFAULT '';
    `);

    // Индекс для быстрого поиска по IP.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_nodes_ip ON nodes(ip);
    `);

    // Кеш overrides на стороне панели (например, promo при VPN).
    await client.query(`
      CREATE TABLE IF NOT EXISTS proxy_overrides (
        id SERIAL PRIMARY KEY,
        node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        proxy_id VARCHAR(32) NOT NULL,
        promo VARCHAR(255) DEFAULT '',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(node_id, proxy_id)
      );
    `);

    // Метаданные SSL сертификатов (wildcard и самоподписанные).
    // Реальные сертификаты лежат на диске — здесь только метаданные.
    await client.query(`
      CREATE TABLE IF NOT EXISTS ssl_certificates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        domain VARCHAR(255) NOT NULL,
        type VARCHAR(32) NOT NULL DEFAULT 'wildcard',
        issuer VARCHAR(255) DEFAULT '',
        valid_from TIMESTAMP,
        valid_to TIMESTAMP,
        serial_number VARCHAR(128) DEFAULT '',
        certificate_path TEXT NOT NULL,
        private_key_path TEXT,
        auto_renew BOOLEAN DEFAULT true,
        last_renewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Индекс для поиска по домену.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ssl_certificates_domain ON ssl_certificates(domain);
    `);

    // Cloudflare credentials хранятся ЗАШИФРОВАННЫМИ (bcrypt не подходит — нужна обратимость).
    // Используем AES-256-GCM с ключом из JWT_SECRET.
    await client.query(`
      CREATE TABLE IF NOT EXISTS cloudflare_credentials (
        id SERIAL PRIMARY KEY,
        api_token_encrypted TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // История метрик нод для графиков (CPU/RAM/Disk).
    // Хранится агрегированная: 1 точка = (timestamp, cpu%, memory%, disk%, containers).
    await client.query(`
      CREATE TABLE IF NOT EXISTS node_metrics_history (
        id SERIAL PRIMARY KEY,
        node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        cpu_percent NUMERIC(5,2) NOT NULL,
        memory_percent NUMERIC(5,2) NOT NULL,
        disk_percent NUMERIC(5,2) NOT NULL,
        running_containers INTEGER NOT NULL DEFAULT 0,
        load_avg_1 NUMERIC(6,3),
        load_avg_5 NUMERIC(6,3)
      );
    `);

    // Индекс для быстрого получения истории по ноде.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_node_metrics_history_node_time
        ON node_metrics_history(node_id, timestamp DESC);
    `);

    // NetBird статусы по нодам (последний известный статус).
    await client.query(`
      CREATE TABLE IF NOT EXISTS netbird_status (
        id SERIAL PRIMARY KEY,
        node_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        installed BOOLEAN DEFAULT false,
        connected BOOLEAN DEFAULT false,
        mesh_ip VARCHAR(64),
        peer_name VARCHAR(255),
        management_url VARCHAR(512),
        version VARCHAR(64),
        peers_json JSONB,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(node_id)
      );
    `);

    // eslint-disable-next-line no-console
    console.log('Database migrations completed');
  });
}

export async function createAdminUser(username: string, password: string): Promise<void> {
  // Защита от пустого пароля (install.sh может передать пустую строку).
  if (!username || !password) {
    throw new Error('Username and password are required');
  }
  if (username.length > 64) {
    throw new Error('Username too long (max 64 chars)');
  }
  if (password.length < 8) {
    throw new Error('Password too short (min 8 chars)');
  }

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (username, password_hash) VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [username, hash]
  );
  // eslint-disable-next-line no-console
  console.log(`Admin user "${username}" created or updated`);
}
