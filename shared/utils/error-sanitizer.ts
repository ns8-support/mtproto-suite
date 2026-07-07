/**
 * Утилита для безопасной санитизации error messages.
 *
 * Зачем нужна: исключения из ssh2, Docker, PostgreSQL могут содержать:
 * - Внутренние пути файлов (/opt/mtproto-suite/...)
 * - IP адреса внутренних серверов
 * - Stack traces
 * - Редко — фрагменты credentials (в edge cases)
 *
 * Эта утилита маппит известные категории ошибок в безопасные тексты для клиента.
 * Полная ошибка логируется на сервере через logger.error().
 *
 * Используется в panel-backend (где есть доступ к req/res), но также
 * пере-экспортируется из shared/utils/logger.ts для удобства.
 */

const SAFE_PATTERNS: Array<[RegExp, string]> = [
  // ============ Auth / validation — безопасно возвращать как есть ============
  [/^Invalid credentials/i, 'Invalid credentials'],
  [/^Username and password/i, 'Username and password are required'],
  [/^Invalid node id/i, 'Invalid node id'],
  [/^Invalid host/i, 'Invalid host'],
  [/^Invalid ssh/i, 'Invalid ssh'],
  [/^Invalid ip/i, 'Invalid IP address'],
  [/^Invalid port/i, 'Invalid port'],
  [/^Invalid token/i, 'Invalid token'],
  [/^Too many requests/i, 'Too many requests'],
  [/^Too many login/i, 'Too many login attempts'],
  [/^Too many SSH/i, 'Too many SSH requests'],
  [/^Either password/i, 'Either password or privateKey required'],
  [/^Either ssh/i, 'Either ssh credentials required'],
  [/^Failed to connect to node/i, 'Failed to connect to node'],
  [/^Failed to fetch proxies/i, 'Failed to fetch proxies'],
  [/^Proxy not found/i, 'Proxy not found'],
  [/^Node not found/i, 'Node not found'],
  [/^Not found/i, 'Not found'],
  [/^CORS: origin/i, 'CORS: origin not allowed'],
  [/^Reboot requires/i, 'Reboot requires explicit confirmation'],
  [/^Valid setupKey/i, 'Valid setupKey is required'],
  [/^Setup key/i, 'Setup key required'],
  [/^Either cloudflare/i, 'Cloudflare apiToken required'],
  [/^wildcardDomain must/i, 'wildcardDomain must start with "*."'],
  [/^Invalid wildcardDomain/i, 'Invalid wildcardDomain'],
  [/^Invalid rootDomain/i, 'Invalid rootDomain'],
  [/^wildcardDomain base must/i, 'wildcardDomain base must equal rootDomain'],
  [/^Valid email/i, 'Valid email is required'],
  [/^DNS-01 challenge/i, 'DNS-01 challenge not offered'],
  [/^ACME (account|order|challenge)/i, 'ACME operation failed'],
  [/^Cloudflare zone/i, 'Cloudflare zone not found'],
  [/^Cloudflare credentials/i, 'Cloudflare credentials invalid'],
  [/^Certificate not/i, 'Certificate not returned'],
  [/^Already up to date/i, 'Already up to date'],
  [/^Service node is healthy/i, 'Service node is healthy'],
  [/^Health check timeout/i, 'Health check timeout'],

  // ============ SSH ошибки — обобщаем ============
  [/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ENETUNREACH|EHOSTUNREACH/i, 'SSH connection failed: unreachable'],
  [/Authentication failed|Permission denied \(publickey|password\)/i, 'SSH authentication failed'],
  [/ssh_exchange_identification|Connection reset by peer/i, 'SSH connection interrupted'],
  [/Cannot resolve hostname|Name or service not known/i, 'SSH host cannot be resolved'],
  [/sudo requires password|sudo: a password is required/i, 'Sudo requires password (NOPASSWD required)'],
  [/sudo:.*not found/i, 'Sudo not available'],
  [/reboot/i, 'Reboot operation failed'],

  // ============ Docker ошибки — обобщаем ============
  [/docker.*not found|No such container/i, 'Container not found'],
  [/docker.*already in use|name already in use/i, 'Container name already in use'],
  [/docker.*conflict|port is already allocated/i, 'Port already in use'],
  [/docker.*daemon|Cannot connect to the Docker daemon/i, 'Docker daemon unavailable'],
  [/No space left on device/i, 'Out of disk space'],
  [/OOMKilled|out of memory/i, 'Out of memory'],
  [/image not found|pull access denied/i, 'Image not available'],

  // ============ PostgreSQL ошибки — обобщаем ============
  [/duplicate key|unique constraint/i, 'Duplicate entry'],
  [/foreign key constraint/i, 'Referenced record not found'],
  [/violates check constraint/i, 'Constraint violation'],
  [/connection terminated|connection refused/i, 'Database connection failed'],
  [/relation .* does not exist/i, 'Table not found'],
  [/column .* does not exist/i, 'Column not found'],
  [/permission denied for/i, 'Permission denied'],

  // ============ File system ошибки — обобщаем ============
  [/ENOENT|no such file or directory/i, 'File not found'],
  [/EACCES|permission denied/i, 'Permission denied'],
  [/ENOSPC|not enough space/i, 'Out of disk space'],

  // ============ Certbot / SSL ошибки ============
  [/certbot|let.s encrypt/i, 'SSL certificate operation failed'],
  [/Challenge validation/i, 'Challenge validation failed'],
];

/**
 * Маппит ошибку в безопасное сообщение для клиента.
 *
 * @param err — любая ошибка (Error, string, object)
 * @returns — безопасное текстовое сообщение для отображения в UI
 */
export function sanitizeErrorMessage(err: unknown): string {
  const raw = extractMessage(err);

  if (!raw) {
    return 'Internal server error';
  }

  for (const [pattern, safeMsg] of SAFE_PATTERNS) {
    if (pattern.test(raw)) {
      return safeMsg;
    }
  }

  // Удаляем stack-trace подобные паттерны (имена файлов, номера строк).
  // Разрешаем дефисы в путях (например, mtproto-suite).
  const cleaned = raw
    .replace(/\s+at\s+[\w./-]+\.\w+:\d+:\d+/g, '')
    .replace(/\s+at\s+[\w<>]+\s+\([^)]*\)/g, '')
    .replace(/file:\/\/\/.+?\.(?:js|ts|tsx):\d+/g, '')
    .replace(/[\w./-]+\.\w+:\d+:\d+/g, '')  // голый путь с номером строки
    .trim();

  // Если после очистки сообщение слишком длинное или содержит паттерны утечки —
  // возвращаем generic.
  if (cleaned.length > 200 || /\b(localhost|127\.0\.0\.|192\.168\.|10\.\d+\.\d+\.\d+)\b/i.test(cleaned)) {
    return 'Internal server error';
  }

  return cleaned || 'Internal server error';
}

/**
 * Извлекает строку сообщения из любого типа ошибки.
 */
function extractMessage(err: unknown): string {
  if (err === null || err === undefined) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}
