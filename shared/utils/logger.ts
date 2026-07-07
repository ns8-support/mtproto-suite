/**
 * Минимальный структурированный логгер.
 * Заменяет прямые вызовы console.log/error в обоих сервисах.
 *
 * Формат: [LEVEL] [ISO-timestamp] [category] message { meta }.
 * В production можно подменить реализацию на pino/winston без изменений в коде.
 *
 * Безопасность:
 * - Автоматически редактирует чувствительные поля в meta (password, privateKey, token).
 * - Не логирует сами объекты с credentials — только метаданные (host, username).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const envLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';
const activeLevel = LEVEL_ORDER[envLevel] ?? LEVEL_ORDER.info;

// ============ Sanitization ============

/**
 * Список ключей, значения которых должны быть отредактированы в логах.
 *
 * Регистронезависимо — проверяется по lowerCase.
 * Применяется рекурсивно к вложенным объектам.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passphrase',
  'privatekey',
  'private_key',
  'secret',
  'token',
  'authtoken',
  'auth_token',
  'apikey',
  'api_key',
  'credential',
  'credentials',
  'ssh_password',
  'ssh_private_key',
  'ssh_passphrase',
]);

const REDACTED = '[REDACTED]';

/**
 * Рекурсивно редактирует чувствительные поля в объекте.
 *
 * @param obj — любой объект (включая null, undefined, массивы)
 * @returns — копия объекта с отредактированными полями
 */
function sanitizeMeta(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeMeta(item));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (SENSITIVE_KEYS.has(lowerKey)) {
      // Полная редакция значения.
      sanitized[key] = REDACTED;
    } else if (typeof value === 'object' && value !== null) {
      // Рекурсия для вложенных объектов.
      sanitized[key] = sanitizeMeta(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Редактирует чувствительные паттерны в строковых сообщениях.
 *
 * Ловит типичные паттерны:
 * - "password=secret123" → "password=[REDACTED]"
 * - "--password secret123" → "--password [REDACTED]"
 * - JSON-подобные строки с credentials
 */
function sanitizeMessage(message: string): string {
  let sanitized = message;

  // Регулярка для key=value и key: value
  const patterns: Array<[RegExp, string]> = [
    [/(password|passphrase|private[_-]?key|secret|token|api[_-]?key)\s*[=:]\s*["']?[\w\-_./+=]+["']?/gi, '$1=[REDACTED]'],
    [/(--password|--passphrase|--private-key|-p)\s+["']?[\w\-_./+=]+["']?/gi, '$1 [REDACTED]'],
    [/(sshpass\s+-p)\s*["']?[\w\-_./+=]+["']?/gi, '$1 [REDACTED]'],
  ];

  for (const [pattern, replacement] of patterns) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  return sanitized;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= activeLevel;
}

function emit(
  level: LogLevel,
  category: string,
  message: string,
  meta?: Record<string, unknown>
): void {
  if (!shouldLog(level)) return;

  const safeMessage = sanitizeMessage(message);
  const safeMeta = meta ? (sanitizeMeta(meta) as Record<string, unknown>) : undefined;

  const line = {
    level,
    time: new Date().toISOString(),
    category,
    message: safeMessage,
    ...(safeMeta || {}),
  };

  // Ошибки и предупреждения идут в stderr, остальное в stdout —
  // чтобы docker logs и logrotate обрабатывали их корректно.
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(JSON.stringify(line) + '\n');
}

export const logger = {
  debug(category: string, message: string, meta?: Record<string, unknown>) {
    emit('debug', category, message, meta);
  },
  info(category: string, message: string, meta?: Record<string, unknown>) {
    emit('info', category, message, meta);
  },
  warn(category: string, message: string, meta?: Record<string, unknown>) {
    emit('warn', category, message, meta);
  },
  error(category: string, message: string, meta?: Record<string, unknown>) {
    emit('error', category, message, meta);
  },
};

// Re-export sanitizeErrorMessage для удобного импорта.
// Реальная реализация находится в error-sanitizer.ts в panel-backend.
export { sanitizeErrorMessage } from './error-sanitizer';
