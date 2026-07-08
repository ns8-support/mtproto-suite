import { fetchWithTimeout, safeJson } from '../../../shared/utils/fetch';
import { logger } from '../../../shared/utils/logger';
import { config } from '../config';

interface NodeCredentials {
  ip: string;
  port: number;
  token: string;
}

export interface ProxyToNodeOptions {
  /** Таймаут в мс (по умолчанию из config). */
  timeoutMs?: number;
}

export interface ProxyToNodeResult {
  status: number;
  data: unknown;
}

/**
 * Обёртка для проксирования запросов к service-node.
 *
 * Исправления относительно оригинала:
 * 1. Использует fetchWithTimeout — раньше не было таймаутов, и panel мог зависнуть
 *    на минуту, если нода мертва.
 * 2. Возвращает структурированный результат вместо throw — вызывающий код решает,
 *    как обрабатывать.
 * 3. Логирует ошибки с контекстом (nodeIp, path) для быстрой диагностики.
 */
export async function proxyToNode(
  node: NodeCredentials,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  options: ProxyToNodeOptions = {}
): Promise<ProxyToNodeResult> {
  const url = `http://${node.ip}:${node.port}/api/proxies${path}`;
  const timeout = options.timeoutMs ?? config.nodeRequestTimeoutMs;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${node.token}`,
  };

  const init: RequestInit = { method, headers };
  if (body && (method === 'POST' || method === 'PUT')) {
    init.body = JSON.stringify(body);
  }

  try {
    const response = await fetchWithTimeout(url, { ...init, timeoutMs: timeout });
    const data = await safeJson(response, null);
    return { status: response.status, data };
  } catch (err: any) {
    logger.warn('panel.proxy', `Failed to proxy ${method} ${path} to ${node.ip}:${node.port}`, {
      error: err.message || String(err),
    });
    throw err;
  }
}

/**
 * Проксирование запросов к НЕ-прокси эндпоинтам service-node
 * (domains, blacklist, export, import, update, health).
 */
export async function proxyCustomToNode(
  node: NodeCredentials,
  endpoint: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; timeoutMs?: number } = {}
): Promise<ProxyToNodeResult> {
  const url = `http://${node.ip}:${node.port}/api${endpoint}`;
  const timeout = options.timeoutMs ?? config.nodeRequestTimeoutMs;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${node.token}`,
  };

  const init: RequestInit = {
    method: options.method || 'GET',
    headers,
  };
  if (options.body) {
    init.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetchWithTimeout(url, { ...init, timeoutMs: timeout });
    const data = await safeJson(response, null);
    return { status: response.status, data };
  } catch (err: any) {
    logger.warn('panel.proxy', `Failed to proxy ${init.method} /api${endpoint} to ${node.ip}:${node.port}`, {
      error: err.message || String(err),
    });
    throw err;
  }
}
