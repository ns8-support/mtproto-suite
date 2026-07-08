import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { FAKE_TLS_DOMAINS } from '../../../shared/types/constants';
import {
  ProxyConfig,
  ProxyCreateRequest,
  ProxyStats,
  ProxyUpdateRequest,
  ConnectedIpInfo,
  StatsSnapshot,
  IpHistoryEntry,
  DEFAULT_TELEMT_OPTIONS,
  TELEMT_OPTION_KEYS,
  TelemtOptions,
} from '../../../shared/types';
import {
  generateSecret,
  getRandomElement,
  getRandomPort,
  buildFullSecret,
} from '../utils/crypto';
import * as store from '../store';
import * as dockerService from './docker';
import * as nginxService from './nginx';
import * as xrayService from './xray';
import { logger } from '../../../shared/utils/logger';

/**
 * Вычисляет, какие поля требуют перезапуск контейнера при обновлении прокси.
 *
 * Исправление: в оригинале был длинный хардкод-список ключей. Теперь он
 * живёт в shared (TELEMT_OPTION_KEYS) и легко расширяется.
 */
function buildAdvancedKeysList(): Array<keyof ProxyUpdateRequest> {
  return TELEMT_OPTION_KEYS as Array<keyof ProxyUpdateRequest>;
}

export async function createProxy(req: ProxyCreateRequest): Promise<ProxyConfig> {
  const id = uuidv4().split('-')[0];
  const secret = req.secret || generateSecret();

  let domain: string;
  if (req.domain) {
    if (await store.isDomainUsed(req.domain)) {
      throw new Error(`Domain ${req.domain} is already in use by another proxy`);
    }
    domain = req.domain;
  } else {
    const usedDomains = new Set(await store.getUsedDomains());
    const customDomains = await store.getCustomDomains();
    const domainPool = customDomains.length > 0 ? customDomains : FAKE_TLS_DOMAINS;
    const available = domainPool.filter((d) => !usedDomains.has(d));
    if (available.length === 0) {
      throw new Error('No available domains left. Delete a proxy or specify a custom domain.');
    }
    domain = getRandomElement(available);
  }

  let port = req.port || 0;
  if (!port) {
    do {
      port = getRandomPort(config.portRangeStart, config.portRangeEnd);
    } while (await store.isPortUsed(port));
  } else if (await store.isPortUsed(port)) {
    throw new Error(`Port ${port} is already in use`);
  }

  const containerName = `${config.proxyContainerPrefix}${id}`;

  // VPN (xray + SOCKS5): создаём xray-контейнер, telemt будет ходить через него.
  let vpnContainerName: string | undefined;
  let socks5Host: string | undefined;
  if (req.vpnSubscription) {
    vpnContainerName = `${config.xrayContainerPrefix}${id}`;
    const vlessConfig = await xrayService.fetchAndParseSubscription(req.vpnSubscription);
    await xrayService.createXrayContainer(vpnContainerName, vlessConfig);
    socks5Host = vpnContainerName;
  }

  // ВАЖНО: вычисленные поля (id/port/secret/domain/containerName/...) формируются выше
  // и должны иметь приоритет над значениями из req. Поэтому спред `...req` идёт ПЕРВЫМ —
  // иначе, если клиент пришлёт domain/port/secret равными undefined/null, они
  // перезапишут уже вычисленные значения и прокси сохранится с пустыми полями.
  const proxy: ProxyConfig = {
    ...req,
    id,
    name: req.name || `Proxy ${id}`,
    note: req.note || '',
    port,
    secret,
    domain,
    containerName,
    status: 'running',
    createdAt: new Date().toISOString(),
    trafficUp: 0,
    trafficDown: 0,
    connectedIps: [],
    vpnContainerName,
    natIp: req.natIp || config.natIp || undefined,
    tunnelInterface: req.tunnelInterface || config.tunnelInterface || undefined,
  };

  try {
    await dockerService.createProxyContainer({
      containerName,
      secret,
      domain,
      listenPort: req.listenPort || config.nginxPort,
      tag: req.tag,
      socks5Host,
      maskHost: req.maskHost,
      natIp: req.natIp || config.natIp || undefined,
      options: req,
    });
    await store.addProxy(proxy);
    await nginxService.updateNginxConfig(await store.getAllProxies());
    return proxy;
  } catch (error) {
    // Rollback: убираем созданные контейнеры, чтобы не оставлять мусор.
    await dockerService.removeProxyContainer(containerName);
    if (vpnContainerName) await xrayService.removeXrayContainer(vpnContainerName);
    throw error;
  }
}

export async function listProxies(): Promise<ProxyConfig[]> {
  const proxies = await store.getAllProxies();

  // Refresh status from Docker для каждого прокси.
  await Promise.all(
    proxies.map(async (proxy) => {
      const status = await dockerService.getContainerStatus(proxy.containerName);
      proxy.status = mapContainerStatus(status);
    })
  );

  return proxies.map((p) => ({ ...p, nginxPort: config.nginxPort }));
}

function mapContainerStatus(status: string): ProxyConfig['status'] {
  if (status === 'running') return 'running';
  if (status === 'paused') return 'paused';
  if (status === 'not_found') return 'error';
  return 'stopped';
}

export async function getProxy(id: string): Promise<ProxyConfig | undefined> {
  const proxy = await store.getProxyById(id);
  if (!proxy) return undefined;
  const status = await dockerService.getContainerStatus(proxy.containerName);
  proxy.status = mapContainerStatus(status);
  return proxy;
}

export async function updateProxy(
  id: string,
  req: ProxyUpdateRequest
): Promise<ProxyConfig | undefined> {
  const proxy = await store.getProxyById(id);
  if (!proxy) return undefined;

  let needsRestart = !!(req.domain && req.domain !== proxy.domain);
  const updates: Partial<ProxyConfig> = {};

  if (req.domain) updates.domain = req.domain;
  if (req.tag !== undefined) {
    updates.tag = req.tag;
    if (req.tag !== (proxy.tag || '')) needsRestart = true;
  }
  if (req.name !== undefined) updates.name = req.name;
  if (req.note !== undefined) updates.note = req.note;
  if (req.maxConnections !== undefined) updates.maxConnections = req.maxConnections;
  if (req.listenPort !== undefined && req.listenPort !== proxy.listenPort) {
    updates.listenPort = req.listenPort;
    needsRestart = true;
  }

  for (const key of buildAdvancedKeysList()) {
    const newVal = req[key];
    if (newVal === undefined) continue;
    const curVal = (proxy as unknown as Record<string, unknown>)[key as string];
    if (!shallowEqual(newVal, curVal)) {
      (updates as unknown as Record<string, unknown>)[key as string] = newVal;
      needsRestart = true;
    }
  }

  if (req.maskHost !== undefined && req.maskHost !== proxy.maskHost) {
    updates.maskHost = req.maskHost;
    needsRestart = true;
  }

  if (req.natIp !== undefined && req.natIp !== (proxy.natIp || '')) {
    updates.natIp = req.natIp || undefined;
    needsRestart = true;
  }
  if (req.tunnelInterface !== undefined) {
    updates.tunnelInterface = req.tunnelInterface || undefined;
  }

  // Изменение VPN-подписки: пересоздаём xray.
  let newSocks5Host: string | undefined = proxy.vpnContainerName;
  if (req.vpnSubscription !== undefined && req.vpnSubscription !== proxy.vpnSubscription) {
    if (proxy.vpnContainerName) {
      await xrayService.removeXrayContainer(proxy.vpnContainerName);
      updates.vpnContainerName = undefined;
      newSocks5Host = undefined;
    }
    if (req.vpnSubscription) {
      const newVpnName = `${config.xrayContainerPrefix}${id}`;
      const vlessConfig = await xrayService.fetchAndParseSubscription(req.vpnSubscription);
      await xrayService.createXrayContainer(newVpnName, vlessConfig);
      updates.vpnContainerName = newVpnName;
      updates.vpnSubscription = req.vpnSubscription;
      newSocks5Host = newVpnName;
    } else {
      updates.vpnSubscription = '';
    }
    needsRestart = true;
  }

  if (needsRestart) {
    await dockerService.removeProxyContainer(proxy.containerName);
    const effectiveNatIp =
      updates.natIp !== undefined ? updates.natIp : (proxy.natIp || config.natIp || undefined);
    await dockerService.createProxyContainer({
      containerName: proxy.containerName,
      secret: proxy.secret,
      domain: updates.domain || proxy.domain,
      // Используем обновлённый listenPort, иначе смена порта при restart не применится.
      listenPort:
        updates.listenPort !== undefined ? updates.listenPort : (proxy.listenPort || config.nginxPort),
      tag: updates.tag !== undefined ? updates.tag : proxy.tag,
      socks5Host: newSocks5Host,
      maskHost: updates.maskHost !== undefined ? updates.maskHost : proxy.maskHost,
      natIp: effectiveNatIp,
      options: { ...DEFAULT_TELEMT_OPTIONS, ...proxy, ...req } as unknown as TelemtOptions,
    });
  }

  const updated = await store.updateProxy(id, updates);
  await nginxService.updateNginxConfig(await store.getAllProxies());
  return updated;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  return a === b;
}

export async function restartProxy(id: string): Promise<ProxyConfig | undefined> {
  const proxy = await store.getProxyById(id);
  if (!proxy) return undefined;

  await dockerService.removeProxyContainer(proxy.containerName).catch(() => {});

  await dockerService.createProxyContainer({
    containerName: proxy.containerName,
    secret: proxy.secret,
    domain: proxy.domain,
    listenPort: proxy.listenPort || config.nginxPort,
    tag: proxy.tag,
    socks5Host: proxy.vpnContainerName,
    maskHost: proxy.maskHost,
    // Сохраняем per-proxy NAT_IP (hybrid/VPN-режим). Без этого рестарт терял
    // индивидуальный natIp и подменял его глобальным config.natIp.
    natIp: proxy.natIp || config.natIp || undefined,
    options: { ...DEFAULT_TELEMT_OPTIONS, ...proxy } as unknown as TelemtOptions,
  });

  const updated = await store.updateProxy(id, { status: 'running' });
  await nginxService.updateNginxConfig(await store.getAllProxies());
  return updated;
}

export async function deleteProxy(id: string): Promise<boolean> {
  const proxy = await store.getProxyById(id);
  if (!proxy) return false;

  await dockerService.removeProxyContainer(proxy.containerName);
  if (proxy.vpnContainerName) {
    await xrayService.removeXrayContainer(proxy.vpnContainerName);
  }
  await store.removeProxy(id);
  await store.removeStatsHistory(id);
  await store.removeIpHistory(id);
  await nginxService.updateNginxConfig(await store.getAllProxies());
  return true;
}

export async function pauseProxy(id: string): Promise<ProxyConfig | undefined> {
  const proxy = await store.getProxyById(id);
  if (!proxy) return undefined;
  await dockerService.pauseContainer(proxy.containerName);
  return store.updateProxy(id, { status: 'paused' });
}

export async function unpauseProxy(id: string): Promise<ProxyConfig | undefined> {
  const proxy = await store.getProxyById(id);
  if (!proxy) return undefined;
  await dockerService.unpauseContainer(proxy.containerName);
  return store.updateProxy(id, { status: 'running' });
}

export async function getProxyStats(id: string): Promise<ProxyStats | null> {
  const proxy = await store.getProxyById(id);
  if (!proxy) return null;

  try {
    const status = await dockerService.getContainerStatus(proxy.containerName);
    if (status !== 'running') {
      return emptyStats(proxy, status);
    }
    const stats = await dockerService.getContainerStats(proxy.containerName);
    const uptime = await dockerService.getContainerUptime(proxy.containerName);
    const connectedIps = await nginxService.getNginxConnectedIps(proxy.domain);

    await store.updateProxy(id, {
      trafficUp: stats.networkTxBytes,
      trafficDown: stats.networkRxBytes,
      connectedIps: connectedIps.map((c) => c.ip),
    });

    const cpuNum = parseFloat(stats.cpuPercent.replace('%', '')) || 0;
    const memMatch = stats.memoryUsage.match(/([\d.]+)\s*(B|KB|MB|GB)/i);
    let memBytes = 0;
    if (memMatch) {
      const val = parseFloat(memMatch[1]);
      const unit = memMatch[2].toUpperCase();
      memBytes = unit === 'GB' ? val * 1073741824 :
                 unit === 'MB' ? val * 1048576 :
                 unit === 'KB' ? val * 1024 : val;
    }
    await store.addStatsSnapshot(id, {
      timestamp: new Date().toISOString(),
      cpuPercent: cpuNum,
      memoryBytes: memBytes,
      networkRxBytes: stats.networkRxBytes,
      networkTxBytes: stats.networkTxBytes,
      connectedCount: connectedIps.length,
    });

    if (connectedIps.length > 0) {
      store.updateIpHistorySync(id, connectedIps);
    }

    return {
      id: proxy.id,
      containerName: proxy.containerName,
      status,
      ...stats,
      uptime,
      connectedIps,
    };
  } catch (err) {
    logger.error('proxy', `Failed to get stats for ${id}`, { error: String(err) });
    return emptyStats(proxy, 'error');
  }
}

function emptyStats(proxy: ProxyConfig, status: string): ProxyStats {
  return {
    id: proxy.id,
    containerName: proxy.containerName,
    status,
    cpuPercent: '0%',
    memoryUsage: '0 B',
    memoryLimit: '0 B',
    networkRx: '0 B',
    networkTx: '0 B',
    networkRxBytes: 0,
    networkTxBytes: 0,
    uptime: status === 'not_found' ? 'unknown' : '0h 0m',
    connectedIps: [] as ConnectedIpInfo[],
  };
}

export async function getProxyLink(id: string, serverIp: string): Promise<string | null> {
  const proxy = await store.getProxyById(id);
  if (!proxy) return null;
  const fullSecret = buildFullSecret(proxy.secret, proxy.domain);
  const port = proxy.listenPort || config.nginxPort;
  return `tg://proxy?server=${encodeURIComponent(serverIp)}&port=${port}&secret=${fullSecret}`;
}

export async function getProxyStatsHistory(id: string): Promise<StatsSnapshot[]> {
  return store.getStatsHistory(id);
}

export async function getProxyIpHistory(id: string): Promise<IpHistoryEntry[]> {
  return store.getIpHistorySync(id);
}

export async function clearProxyHistory(id: string): Promise<boolean> {
  const proxy = await store.getProxyById(id);
  if (!proxy) return false;
  await Promise.all([store.removeStatsHistory(id), store.removeIpHistory(id)]);
  return true;
}

// ============ Export/Import ============

export interface ExportBundle {
  version: 1;
  exportedAt: string;
  proxies: Array<Partial<ProxyConfig> & Record<string, unknown>>;
}

export async function exportProxies(): Promise<ExportBundle> {
  const proxies = await store.getAllProxies();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    proxies: proxies.map((p) => ({
      name: p.name,
      note: p.note,
      secret: p.secret,
      domain: p.domain,
      port: p.port,
      listenPort: p.listenPort,
      tag: p.tag,
      maxConnections: p.maxConnections,
      vpnSubscription: p.vpnSubscription,
      maskHost: p.maskHost,
      natIp: p.natIp,
      tunnelInterface: p.tunnelInterface,
    })),
  };
}

export async function importProxies(bundle: ExportBundle): Promise<{ imported: number; errors: string[] }> {
  const errors: string[] = [];
  let imported = 0;

  for (const p of bundle.proxies) {
    try {
      await createProxy(p as ProxyCreateRequest);
      imported++;
    } catch (err: any) {
      errors.push(`${p.name || p.secret}: ${err.message}`);
    }
  }

  return { imported, errors };
}

/**
 * Фоновый сборщик статистики — раз в STATS_INTERVAL_MS.
 * Запускается один раз при старте service-node.
 */
export async function collectAllProxyStats(): Promise<void> {
  const proxies = await store.getAllProxies();
  await Promise.allSettled(proxies.map((p) => getProxyStats(p.id)));
}
