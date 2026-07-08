/**
 * Единый API-клиент для панели.
 *
 * Исправления относительно оригинала:
 * 1. Типизированные методы — раньше все возвращали `any`.
 * 2. Обработка ошибок с типизированным ApiError.
 * 3. AbortController для отмены запросов при размонтировании.
 * 4. Таймаут через AbortSignal.timeout.
 * 5. Единая точка для добавления Authorization header.
 */

import type {
  ProxyConfig,
  ProxyStats,
  ProxyUpdateRequest,
  ProxyCreateRequest,
  ServiceNodeHealth,
  DomainsResponse,
  BlacklistResponse,
  ExportBundle,
  ImportResult,
  ConnectedIpInfo,
  IpHistoryEntry,
  StatsSnapshot,
} from '@mtproto-suite/shared/types';

export interface ApiError {
  error: string;
}

export class ApiRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

const BASE_URL = '';
const DEFAULT_TIMEOUT_MS = 30000;
const TOKEN_KEY = 'mtproto_token';

export function isAuthenticated(): boolean {
  return !!localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

interface RequestOptions {
  /** Таймаут в мс (по умолчанию 30 сек). */
  timeoutMs?: number;
  /** Внешний AbortSignal для отмены. */
  signal?: AbortSignal;
}

export async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const init: RequestInit = { method, headers };
  if (body) init.body = JSON.stringify(body);

  // Комбинируем пользовательский signal с таймаутом.
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const signals = options.signal ? [options.signal, timeoutController.signal] : [timeoutController.signal];
  init.signal = signals.length === 1 ? signals[0] : mergeSignals(signals);

  try {
    const response = await fetch(BASE_URL + path, init);
    if (!response.ok) {
      // Пытаемся достать сообщение об ошибке из JSON-тела.
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorBody = (await response.json()) as ApiError;
        if (errorBody?.error) errorMessage = errorBody.error;
      } catch {
        // body isn't JSON
      }
      if (response.status === 401) {
        setToken(null);
      }
      throw new ApiRequestError(response.status, errorMessage);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Комбинирует несколько AbortSignals в один (срабатывает, когда любой из них abort).
 * Замена для AbortSignal.any() — поддерживается в Node 20+, но не во всех браузерах.
 */
function mergeSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

// ============ Auth ============

export async function login(username: string, password: string): Promise<{ token: string; user: { id: number; username: string } }> {
  return request('POST', '/api/auth/login', { username, password });
}

export async function getMe(): Promise<{ user: { userId: number; username: string } }> {
  return request('GET', '/api/auth/me');
}

// ============ Nodes ============

export interface NodeInfo {
  id: number;
  name: string;
  ip: string;
  port: number;
  domain: string;
  created_at: string;
}

export async function listNodes(): Promise<NodeInfo[]> {
  return request('GET', '/api/nodes');
}

export async function getNode(id: number): Promise<NodeInfo & { token: string }> {
  return request('GET', `/api/nodes/${id}`);
}

export async function addNode(data: {
  name?: string;
  ip: string;
  port: number;
  token: string;
  domain?: string;
}): Promise<NodeInfo> {
  return request('POST', '/api/nodes', data);
}

export async function updateNode(id: number, data: Partial<{
  name: string;
  ip: string;
  port: number;
  token: string;
  domain: string;
}>): Promise<NodeInfo> {
  return request('PUT', `/api/nodes/${id}`, data);
}

export async function deleteNode(id: number): Promise<{ success: boolean }> {
  return request('DELETE', `/api/nodes/${id}`);
}

export async function checkNodeHealth(data: { ip: string; port: number; token: string }): Promise<{ online: boolean }> {
  return request('POST', '/api/nodes/check-health', data);
}

export async function getNodeHealth(id: number): Promise<{ online: boolean; version?: string | null }> {
  return request('GET', `/api/nodes/${id}/health`);
}

export async function triggerNodeUpdate(id: number): Promise<unknown> {
  return request('POST', `/api/nodes/${id}/update`, {});
}

export async function getNodeDomains(id: number): Promise<DomainsResponse> {
  return request('GET', `/api/nodes/${id}/domains`);
}

export async function updateNodeDomains(id: number, domains: string[]): Promise<DomainsResponse> {
  return request('PUT', `/api/nodes/${id}/domains`, { domains });
}

export async function getNodeBlacklist(id: number): Promise<BlacklistResponse> {
  return request('GET', `/api/nodes/${id}/blacklist`);
}

export async function updateNodeBlacklist(id: number, ips: string[]): Promise<BlacklistResponse> {
  return request('PUT', `/api/nodes/${id}/blacklist`, { ips });
}

export async function exportNodeConfig(id: number): Promise<ExportBundle> {
  return request('GET', `/api/nodes/${id}/export`);
}

export async function importNodeConfig(id: number, bundle: ExportBundle): Promise<ImportResult> {
  return request('POST', `/api/nodes/${id}/import`, bundle);
}

// ============ Proxies ============

export interface NodeWithProxies {
  nodeId: number;
  nodeName: string;
  nodeIp: string;
  online: boolean;
  proxies: ProxyConfig[];
}

export async function listAllProxies(): Promise<NodeWithProxies[]> {
  return request('GET', '/api/proxies/all');
}

export async function listProxies(nodeId: number): Promise<ProxyConfig[]> {
  return request('GET', `/api/nodes/${nodeId}/proxies`);
}

export async function createProxy(nodeId: number, data: ProxyCreateRequest): Promise<ProxyConfig> {
  return request('POST', `/api/nodes/${nodeId}/proxies`, data);
}

export async function getProxy(nodeId: number, proxyId: string): Promise<ProxyConfig> {
  return request('GET', `/api/nodes/${nodeId}/proxies/${proxyId}`);
}

export async function updateProxy(nodeId: number, proxyId: string, data: ProxyUpdateRequest): Promise<ProxyConfig> {
  return request('PUT', `/api/nodes/${nodeId}/proxies/${proxyId}`, data);
}

export async function deleteProxy(nodeId: number, proxyId: string): Promise<{ success: boolean }> {
  return request('DELETE', `/api/nodes/${nodeId}/proxies/${proxyId}`);
}

export async function getProxyStats(nodeId: number, proxyId: string): Promise<ProxyStats> {
  return request('GET', `/api/nodes/${nodeId}/proxies/${proxyId}/stats`);
}

export async function getProxyLink(nodeId: number, proxyId: string): Promise<{ link: string }> {
  return request('GET', `/api/nodes/${nodeId}/proxies/${proxyId}/link`);
}

export async function restartProxy(nodeId: number, proxyId: string): Promise<ProxyConfig> {
  return request('POST', `/api/nodes/${nodeId}/proxies/${proxyId}/restart`);
}

export async function pauseProxy(nodeId: number, proxyId: string): Promise<ProxyConfig> {
  return request('POST', `/api/nodes/${nodeId}/proxies/${proxyId}/pause`);
}

export async function unpauseProxy(nodeId: number, proxyId: string): Promise<ProxyConfig> {
  return request('POST', `/api/nodes/${nodeId}/proxies/${proxyId}/unpause`);
}

export async function getProxyStatsHistory(nodeId: number, proxyId: string): Promise<StatsSnapshot[]> {
  return request('GET', `/api/nodes/${nodeId}/proxies/${proxyId}/stats-history`);
}

export async function getProxyIpHistory(nodeId: number, proxyId: string): Promise<IpHistoryEntry[]> {
  return request('GET', `/api/nodes/${nodeId}/proxies/${proxyId}/ip-history`);
}

export async function clearProxyHistory(nodeId: number, proxyId: string): Promise<{ success: boolean }> {
  return request('DELETE', `/api/nodes/${nodeId}/proxies/${proxyId}/clear-history`);
}

// ============ System ============

export async function getSystemVersion(): Promise<{ version: string }> {
  return request('GET', '/api/system/version');
}

export async function triggerSystemUpdate(): Promise<{ success: boolean; message: string }> {
  return request('POST', '/api/system/update');
}

export async function getHealth(): Promise<ServiceNodeHealth> {
  return request('GET', '/api/health');
}

export type {
  ConnectedIpInfo,
  IpHistoryEntry,
  StatsSnapshot,
  ProxyConfig,
  ProxyStats,
  ProxyUpdateRequest,
  ProxyCreateRequest,
};
