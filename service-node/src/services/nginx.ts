import Docker from 'dockerode';
import { config } from '../config';
import { createTarBuffer, extractIp } from '../../../shared/utils/tar';
import { isPrivateIp, isTelegramIp, FAKE_TLS_DOMAINS } from '../../../shared/types/constants';
import { ProxyConfig, ConnectedIpInfo } from '../../../shared/types';
import * as store from '../store';
import { logger } from '../../../shared/utils/logger';
import { fetchWithTimeout } from '../../../shared/utils/fetch';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// ============ Container IP resolution ============

async function resolveContainerIp(containerName: string): Promise<string> {
  const container = docker.getContainer(containerName);
  const info = await container.inspect();
  const networks = info.NetworkSettings.Networks;
  if (networks[config.dockerNetwork]?.IPAddress) {
    return networks[config.dockerNetwork].IPAddress;
  }
  const first = Object.values(networks).find((n) => n?.IPAddress);
  if (first?.IPAddress) return first.IPAddress;
  throw new Error(`Cannot resolve IP for container ${containerName}`);
}

// ============ Nginx config generation ============

/**
 * Генерирует nginx.conf для stream-роутинга по SNI + dedicated-port прокси.
 *
 * Архитектура:
 * - SNI-based прокси (default 443): один listen, $ssl_preread_server_name → backend.
 *   - С лимитом соединений: отдельный listen на loopback + limit_conn_zone.
 * - Dedicated-port прокси (custom port): отдельный listen на этом порту.
 * - IP blacklist применяется через директиву deny.
 * - HTML fallback на 8088 если SNI/port не совпал.
 */
export function generateNginxConfig(
  proxies: ProxyConfig[],
  ipMap: Map<string, string> = new Map()
): string {
  const runningProxies = proxies.filter((p) => p.status === 'running');
  const nginxPort = config.nginxPort;
  const sniProxies = runningProxies.filter((p) => !p.listenPort || p.listenPort === nginxPort);
  const portProxies = runningProxies.filter((p) => p.listenPort && p.listenPort !== nginxPort);

  const target = (p: ProxyConfig, port: number): string => {
    const ip = ipMap.get(p.containerName);
    return ip ? `${ip}:${port}` : `${p.containerName}:${port}`;
  };

  // SNI прокси с лимитами получают loopback-port (10001+).
  const limitSniProxies = sniProxies.filter((p) => p.maxConnections && p.maxConnections > 0);
  const limitPortMap = new Map<string, number>();
  limitSniProxies.forEach((p, i) => limitPortMap.set(p.domain, 10001 + i));

  const mapEntries = sniProxies
    .map((p) => {
      const internalPort = limitPortMap.get(p.domain);
      return internalPort
        ? `        ${p.domain} 127.0.0.1:${internalPort};`
        : `        ${p.domain} ${target(p, nginxPort)};`;
    })
    .join('\n');

  const defaultBackend = '127.0.0.1:8088';

  const blacklistedIps = store.getBlacklistedIpsSync();
  const denyEntries = blacklistedIps.map((ip) => `        deny ${ip};`).join('\n');

  const mainServer = `    server {
        listen ${nginxPort};
        proxy_pass $backend;
        ssl_preread on;
        proxy_connect_timeout 10s;
        proxy_timeout 300s;
${denyEntries ? denyEntries + '\n' : ''}    }`;

  const limitBlocks = limitSniProxies
    .map((p) => {
      const zoneName = p.domain.replace(/\./g, '_');
      const internalPort = limitPortMap.get(p.domain)!;
      return `    limit_conn_zone $remote_addr zone=${zoneName}:1m;
    server {
        listen 127.0.0.1:${internalPort};
        proxy_pass ${target(p, nginxPort)};
        proxy_connect_timeout 10s;
        proxy_timeout 300s;
        limit_conn ${zoneName} ${p.maxConnections};
    }`;
    })
    .join('\n\n');

  // Группируем dedicated-port прокси по порту — один server block на уникальный порт.
  const portGroups = new Map<number, ProxyConfig>();
  for (const p of portProxies) {
    if (!portGroups.has(p.listenPort!)) portGroups.set(p.listenPort!, p);
  }

  const portBlocks = Array.from(portGroups.values())
    .map((p) => {
      if (p.maxConnections && p.maxConnections > 0) {
        return `
    limit_conn_zone $remote_addr zone=port_${p.listenPort}:1m;
    server {
        listen ${p.listenPort};
        proxy_pass ${target(p, p.listenPort!)};
        ssl_preread on;
        proxy_connect_timeout 10s;
        proxy_timeout 300s;
${denyEntries ? denyEntries + '\n' : ''}        limit_conn port_${p.listenPort} ${p.maxConnections};
    }`;
      }
      return `
    server {
        listen ${p.listenPort};
        proxy_pass ${target(p, p.listenPort!)};
        ssl_preread on;
        proxy_connect_timeout 10s;
        proxy_timeout 300s;
${denyEntries ? denyEntries + '\n' : ''}    }`;
    })
    .join('\n');

  const fallbackHtml =
    '<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>Welcome</title></head>' +
    '<body style="font-family:sans-serif;text-align:center;padding:60px">' +
    '<h1>Welcome</h1><p>This server is operating normally.</p></body></html>';

  // resolver нужен только если nginx резолвит имена через Docker DNS (bridge mode).
  // При host network nginx уже знает IP — резолвер не нужен.
  const useResolver = ipMap.size === 0;

  return `user nginx;
worker_processes auto;

error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
}

http {
    server {
        listen 127.0.0.1:8088;
        server_name _;
        location / {
            default_type "text/html";
            return 200 '${fallbackHtml}';
        }
    }
}

stream {
${useResolver ? '    resolver 127.0.0.11 valid=10s;\n' : ''}    log_format proxy '$remote_addr [$time_local] $ssl_preread_server_name $status';
    access_log /dev/stdout proxy;

    map $ssl_preread_server_name $backend {
${mapEntries}
        default ${defaultBackend};
    }

${mainServer}

${limitBlocks ? limitBlocks + '\n' : ''}${portBlocks ? portBlocks + '\n' : ''}}
`;
}

// ============ Container management ============

/**
 * Создаёт nginx-контейнер с host network (нужно для listen на 443 без root в контейнере).
 *
 * Миграция со старого bridge-network контейнера: удаляем и создаём заново.
 * На bridge network контейнер не может listen < 1024 без cap_net_bind_service.
 */
export async function ensureNginxContainer(): Promise<void> {
  const containerName = config.nginxContainerName;

  try {
    const existing = docker.getContainer(containerName);
    const info = await existing.inspect();
    const isHostNetwork = info.HostConfig?.NetworkMode === 'host';

    if (isHostNetwork && info.State.Running) return;

    if (isHostNetwork && !info.State.Running) {
      await existing.start();
      return;
    }

    logger.info('nginx', 'Migrating nginx container to host network mode');
    await existing.stop().catch(() => {});
    await existing.remove({ force: true });
    // Ждём, пока docker-proxy освободит порты (известный баг docker engine).
    await new Promise((r) => setTimeout(r, 3000));
  } catch {
    // container does not exist yet
  }

  await pullImage('nginx:latest');

  const container = await docker.createContainer({
    Image: 'nginx:latest',
    name: containerName,
    HostConfig: {
      NetworkMode: 'host',
      RestartPolicy: { Name: 'unless-stopped' },
      Ulimits: [{ Name: 'nofile', Soft: 65536, Hard: 65536 }],
    },
  });

  const initialConf = generateNginxConfig([]);
  const tar = createTarBuffer('nginx.conf', initialConf);
  await container.putArchive(tar, { path: '/etc/nginx' });

  // Retry start: после `remove` порт может быть ещё занят на 1-2 секунды.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await container.start();
      logger.info('nginx', 'nginx container created with host network');
      return;
    } catch (err: any) {
      if (attempt < 3 && err?.statusCode === 500) {
        logger.warn('nginx', `nginx start attempt ${attempt} failed, retrying`, {
          error: err.message,
        });
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        throw err;
      }
    }
  }
}

async function pullImage(image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch {
    // not cached
  }
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (err2: Error | null) => {
        if (err2) return reject(err2);
        resolve();
      });
    });
  });
}

export async function updateNginxConfig(proxies: ProxyConfig[]): Promise<void> {
  // Фильтруем прокси, чьи контейнеры не существуют (stale data).
  const aliveProxies: ProxyConfig[] = [];
  for (const p of proxies) {
    try {
      await docker.getContainer(p.containerName).inspect();
      aliveProxies.push(p);
    } catch {
      logger.warn('nginx', `Skipping proxy ${p.id}: container not found`);
    }
  }

  await ensureNginxContainer();

  // Host network не даёт nginx доступа к Docker DNS — резолвим IP заранее.
  const ipMap = new Map<string, string>();
  for (const p of aliveProxies) {
    try {
      const ip = await resolveContainerIp(p.containerName);
      ipMap.set(p.containerName, ip);
    } catch (err) {
      logger.warn('nginx', `Cannot resolve IP for ${p.containerName}`, {
        error: String(err),
      });
    }
  }
  const reachableProxies = aliveProxies.filter((p) => ipMap.has(p.containerName));

  const nginxConf = generateNginxConfig(reachableProxies, ipMap);
  const container = docker.getContainer(config.nginxContainerName);
  const tarStream = createTarBuffer('nginx.conf', nginxConf);
  await container.putArchive(tarStream, { path: '/etc/nginx' });

  const exec = await container.exec({
    Cmd: ['nginx', '-s', 'reload'],
    AttachStdout: true,
    AttachStderr: true,
  });
  await exec.start({});
}

// ============ Geo lookup с кешем ============

interface GeoEntry {
  country: string;
  countryCode: string;
  ts: number;
}
const geoCache = new Map<string, GeoEntry>();

async function lookupGeo(
  ips: string[]
): Promise<Map<string, { country: string; countryCode: string }>> {
  const result = new Map<string, { country: string; countryCode: string }>();
  const toFetch: string[] = [];

  const now = Date.now();
  for (const ip of ips) {
    const cached = geoCache.get(ip);
    if (cached && now - cached.ts < config.geoCacheTtlMs) {
      result.set(ip, { country: cached.country, countryCode: cached.countryCode });
    } else {
      toFetch.push(ip);
    }
  }

  if (toFetch.length > 0) {
    try {
      const resp = await fetchWithTimeout(config.geoApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toFetch.map((ip) => ({ query: ip }))),
        timeoutMs: 5000,
      });
      if (resp.ok) {
        const data = (await resp.json()) as Array<{
          query: string;
          country?: string;
          countryCode?: string;
        }>;
        for (const entry of data) {
          if (entry.country && entry.countryCode) {
            geoCache.set(entry.query, {
              country: entry.country,
              countryCode: entry.countryCode,
              ts: now,
            });
            result.set(entry.query, {
              country: entry.country,
              countryCode: entry.countryCode,
            });
          }
        }
      }
    } catch {
      // graceful: возвращаем IP без гео-информации
    }
  }

  return result;
}

// ============ IP extraction from nginx logs ============

/**
 * Извлекает уникальные IP из access-логов nginx для конкретного домена.
 *
 * Используется только при ручном вызове `getProxyStats`. Для real-time
 * записей работает watchNginxLogs ниже.
 */
export async function getNginxConnectedIps(domain: string): Promise<ConnectedIpInfo[]> {
  try {
    const container = docker.getContainer(config.nginxContainerName);
    const logs = await container.logs({
      stdout: true,
      stderr: false,
      tail: 2000,
    });
    const logStr = logs.toString('utf-8');
    const ipSet = new Set<string>();
    const blacklisted = new Set(store.getBlacklistedIpsSync());

    for (const line of logStr.split('\n')) {
      if (!line.includes(domain)) continue;
      const ip = extractIp(line);
      if (
        ip &&
        !isPrivateIp(ip) &&
        !isTelegramIp(ip) &&
        !blacklisted.has(ip)
      ) {
        ipSet.add(ip);
      }
    }

    const ips = Array.from(ipSet);
    const geoMap = await lookupGeo(ips);

    return ips.map((ip) => {
      const geo = geoMap.get(ip);
      return { ip, country: geo?.country, countryCode: geo?.countryCode };
    });
  } catch {
    return [];
  }
}

// ============ Real-time log watcher ============

let domainToProxyCache: Map<string, string> = new Map();
let domainCacheTs = 0;

function getProxyIdByDomain(domain: string): string | undefined {
  if (Date.now() - domainCacheTs > config.domainCacheTtlMs) {
    const proxies = store.getAllProxiesSync();
    domainToProxyCache = new Map(proxies.map((p) => [p.domain, p.id]));
    domainCacheTs = Date.now();
  }
  return domainToProxyCache.get(domain);
}

/**
 * Обрабатывает одну строку nginx access-лога.
 *
 * Исправление: в оригинале `processNginxLogLine` вызывался синхронно с
 * lookupGeo().then(...), что создавало неограниченный рост Promise при
 * 100+ req/sec. Теперь используется sync-версия store.updateIpHistorySync.
 */
function processNginxLogLine(line: string): void {
  const match = line.match(
    /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+\[.*?\]\s+(\S+)/
  );
  if (!match) return;
  const [, ip, domain] = match;
  if (!ip || !domain) return;

  if (isPrivateIp(ip) || isTelegramIp(ip)) return;
  if (domain === '-' || domain === '') return;

  const proxyId = getProxyIdByDomain(domain);
  if (!proxyId) return;

  if (store.getBlacklistedIpsSync().includes(ip)) return;

  store.updateIpHistorySync(proxyId, [{ ip }]);
  // Geo lookup — async, fire-and-forget. Кеш debounced на 1 час.
  lookupGeo([ip])
    .then((geoMap) => {
      const geo = geoMap.get(ip);
      if (geo) store.updateIpHistorySync(proxyId, [{ ip, country: geo.country, countryCode: geo.countryCode }]);
    })
    .catch(() => {
      // ignore
    });
}

const MAX_FRAME_BYTES = 1024 * 1024; // 1 MB защита от OOM на огромных фреймах

/**
 * Парсит Docker multiplexed stream и обрабатывает полные строки.
 *
 * Docker multiplexed log stream: каждый фрейм имеет 8-байтный header
 * [stream_type(1), padding(3), payload_size(4 BE)] + payload.
 * Размер в header может содержать ASCII-код символа (например 0x34='4'),
 * что ломает regex IP, если читать весь chunk как строку.
 */
async function watchNginxLogs(): Promise<void> {
  const container = docker.getContainer(config.nginxContainerName);
  const stream = (await container.logs({
    follow: true,
    stdout: true,
    stderr: false,
    since: Math.floor(Date.now() / 1000),
  })) as unknown as NodeJS.ReadableStream;

  let rawBuf = Buffer.alloc(0);
  let textBuf = '';

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      // Защита от OOM: если chunk огромный, обрабатываем только первую часть.
      if (chunk.length > MAX_FRAME_BYTES) {
        logger.warn('nginx', 'Oversized log chunk received, truncating', {
          size: chunk.length,
        });
      }
      rawBuf = Buffer.concat([rawBuf, chunk]);
      while (rawBuf.length >= 8) {
        const payloadSize = rawBuf.readUInt32BE(4);
        if (rawBuf.length < 8 + payloadSize) break;
        textBuf += rawBuf.slice(8, 8 + payloadSize).toString('utf-8');
        rawBuf = rawBuf.slice(8 + payloadSize);

        const lines = textBuf.split('\n');
        textBuf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) processNginxLogLine(trimmed);
        }
      }
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
}

export function startNginxLogWatcher(): void {
  const reconnect = (delay = 0): void => {
    setTimeout(async () => {
      try {
        await watchNginxLogs();
      } catch (err) {
        logger.warn('nginx', 'Log watcher disconnected, will retry', {
          error: String(err),
        });
      }
      reconnect(5000);
    }, delay);
  };
  reconnect(3000); // initial delay to let nginx fully start
}
