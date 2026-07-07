import crypto from 'crypto';

/**
 * Криптографически стойкая генерация hex-строки.
 *
 * Исправление: оригинал использовал crypto.randomBytes (это OK), но утилита generateToken
 * вызывала slice после randomBytes(length).toString('hex'), где length — это длина hex-строки.
 * То есть если хотели 32 символа hex, передавали 32 и получали первые 32 символа 64-char hex.
 * Это работало случайно — оставим так, но документируем.
 */
export function generateSecret(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function buildFullSecret(secret: string, domain: string): string {
  // MTProto требует префикс 'ee' + secret + домен в hex. Домен кодируется через Buffer.
  const domainHex = Buffer.from(domain, 'utf-8').toString('hex');
  return 'ee' + secret + domainHex;
}

/**
 * Генерирует токен авторизации для install.sh.
 *
 * Используется 16 байт (32 hex-символа) — этого достаточно для bearer-token,
 * но при желании можно увеличить до 32 байт через env AUTH_TOKEN_LENGTH.
 */
export function generateToken(length = 32): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

/** Не используется для security-sensitive операций — только для listenPort по умолчанию. */
export function getRandomPort(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function getRandomElement<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
