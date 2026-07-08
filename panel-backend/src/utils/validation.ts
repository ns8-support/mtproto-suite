/**
 * Валидация IP-адресов и других сетевых параметров.
 * Раньше в panel не было валидации — некорректные IP/port проходили в БД и ломали API.
 */

export function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (isNaN(n) || n < 0 || n > 255 || String(n) !== p.trim()) return false;
  }
  return true;
}

export function isValidDomain(domain: string): boolean {
  // Простая проверка: не пустой, не длиннее 253 символов, содержит хотя бы одну точку,
  // только допустимые символы.
  if (!domain || domain.length > 253) return false;
  if (!domain.includes('.')) return false;
  return /^[a-zA-Z0-9]([a-zA-Z0-9-_.]*[a-zA-Z0-9])?$/.test(domain);
}

export function isValidPort(port: unknown): port is number {
  const n = typeof port === 'number' ? port : parseInt(String(port), 10);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

export function isValidToken(token: string, minLength = 16): boolean {
  return typeof token === 'string' && token.length >= minLength && /^[a-zA-Z0-9_-]+$/.test(token);
}

export function sanitizeString(value: unknown, maxLength = 255): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}
