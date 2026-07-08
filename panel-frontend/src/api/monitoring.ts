/**
 * API клиент для мониторинга нод.
 *
 * Endpoints:
 * - POST /api/nodes/:id/metrics — собрать все метрики (CPU, RAM, Disk, Docker)
 * - GET /api/nodes/:id/metrics/history?range=1h|6h|24h|7d — история из БД
 * - POST /api/nodes/:id/system-info — информация о системе
 * - POST /api/nodes/:id/docker-stats — расширенная статистика Docker
 * - POST /api/nodes/:id/restart-service — перезапуск service-node
 * - POST /api/nodes/:id/reboot — перезагрузка сервера (требует confirm: true)
 * - POST /api/nodes/:id/netbird/status — статус NetBird
 * - POST /api/nodes/:id/netbird/install — установка NetBird
 * - POST /api/nodes/:id/netbird/uninstall — удаление NetBird
 * - GET /api/nodes/:id/netbird/cached-status — кешированный статус из БД
 */

import type {
  NodeMetrics,
  SystemInfo,
  ContainerStats,
  MetricsHistoryPoint,
  NetBirdStatus,
  NetBirdInstallRequest,
} from '@mtproto-suite/shared/types';
import { request } from './index';

export interface SshCredentials {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface MetricsRequest {
  ssh: SshCredentials;
  history?: '1h' | '6h' | '24h' | '7d';
}

export interface MetricsResponse extends NodeMetrics {
  history: MetricsHistoryPoint[];
}

export interface DockerStatsResponse {
  stats: ContainerStats[];
  containers: Array<{
    id: string;
    name: string;
    image: string;
    status: string;
    created: string;
    ports: string;
  }>;
}

export interface RestartResult {
  success: boolean;
  log: string;
  error?: string;
}

export interface NetBirdCachedStatus extends NetBirdStatus {
  updatedAt?: string;
}

export async function getMetrics(
  nodeId: number,
  data: MetricsRequest
): Promise<MetricsResponse> {
  return request('POST', `/api/nodes/${nodeId}/metrics`, data, { timeoutMs: 60000 });
}

export async function getMetricsHistory(
  nodeId: number,
  range: '1h' | '6h' | '24h' | '7d' = '1h'
): Promise<MetricsHistoryPoint[]> {
  return request('GET', `/api/nodes/${nodeId}/metrics/history?range=${range}`);
}

export async function getSystemInfo(
  nodeId: number,
  ssh: SshCredentials
): Promise<SystemInfo> {
  return request('POST', `/api/nodes/${nodeId}/system-info`, { ssh }, { timeoutMs: 30000 });
}

export async function getDockerStats(
  nodeId: number,
  ssh: SshCredentials
): Promise<DockerStatsResponse> {
  return request('POST', `/api/nodes/${nodeId}/docker-stats`, { ssh }, { timeoutMs: 30000 });
}

export async function restartService(
  nodeId: number,
  ssh: SshCredentials,
  installDir?: string
): Promise<RestartResult> {
  return request(
    'POST',
    `/api/nodes/${nodeId}/restart-service`,
    { ssh, installDir },
    { timeoutMs: 180000 }
  );
}

export async function rebootServer(
  nodeId: number,
  ssh: SshCredentials
): Promise<RestartResult> {
  return request(
    'POST',
    `/api/nodes/${nodeId}/reboot`,
    { ssh, confirm: true },
    { timeoutMs: 60000 }
  );
}

export async function getNetBirdStatus(
  nodeId: number,
  ssh: SshCredentials
): Promise<NetBirdStatus> {
  return request('POST', `/api/nodes/${nodeId}/netbird/status`, { ssh }, { timeoutMs: 30000 });
}

export async function getNetBirdCachedStatus(
  nodeId: number
): Promise<NetBirdCachedStatus | null> {
  return request('GET', `/api/nodes/${nodeId}/netbird/cached-status`);
}

export async function installNetBird(
  nodeId: number,
  ssh: SshCredentials,
  data: NetBirdInstallRequest
): Promise<RestartResult & { status?: NetBirdStatus }> {
  return request(
    'POST',
    `/api/nodes/${nodeId}/netbird/install`,
    { ssh, ...data },
    { timeoutMs: 300000 }
  );
}

export async function uninstallNetBird(
  nodeId: number,
  ssh: SshCredentials
): Promise<RestartResult> {
  return request(
    'POST',
    `/api/nodes/${nodeId}/netbird/uninstall`,
    { ssh },
    { timeoutMs: 120000 }
  );
}

// ============ Panel server (host running the panel) ============
// Те же операции NetBird, но для самого сервера панели (доступ по SSH к
// хосту, без привязки к node_id в БД).

export async function getPanelSystemInfo(
  ssh: SshCredentials
): Promise<SystemInfo> {
  return request('POST', `/api/panel/system-info`, { ssh }, { timeoutMs: 30000 });
}

export async function getPanelNetBirdStatus(
  ssh: SshCredentials
): Promise<NetBirdStatus> {
  return request('POST', `/api/panel/netbird/status`, { ssh }, { timeoutMs: 30000 });
}

export async function installPanelNetBird(
  ssh: SshCredentials,
  data: NetBirdInstallRequest
): Promise<RestartResult & { status?: NetBirdStatus }> {
  return request(
    'POST',
    `/api/panel/netbird/install`,
    { ssh, ...data },
    { timeoutMs: 300000 }
  );
}

export async function uninstallPanelNetBird(
  ssh: SshCredentials
): Promise<RestartResult> {
  return request(
    'POST',
    `/api/panel/netbird/uninstall`,
    { ssh },
    { timeoutMs: 120000 }
  );
}

export async function disconnectPanelNetBird(
  ssh: SshCredentials
): Promise<RestartResult> {
  return request(
    'POST',
    `/api/panel/netbird/disconnect`,
    { ssh },
    { timeoutMs: 60000 }
  );
}
