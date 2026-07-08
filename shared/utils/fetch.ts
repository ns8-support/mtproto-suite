/**
 * Утилита для fetch с таймаутом, совместимая с Node 18+.
 * Используется в panel-backend (proxyToNode) и service-node (geo lookup, vless sub).
 *
 * Раньше в panel-backend было 10 копий кода с AbortController + setTimeout,
 * и часто забывали clearTimeout (memory leak при таймауте).
 */
export interface FetchWithTimeoutOptions extends RequestInit {
  /** Таймаут в миллисекундах (по умолчанию 10000). */
  timeoutMs?: number;
}

export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeoutMs = 10000, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Утилита для безопасного парсинга JSON-ответа.
 * Если ответ не JSON или пустой — возвращает fallback вместо throw.
 */
export async function safeJson<T>(response: Response, fallback: T): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}
