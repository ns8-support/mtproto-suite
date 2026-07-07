import Docker from 'dockerode';
import { config } from '../config';
import { createTarBuffer } from '../../../shared/utils/tar';
import { VlessConfig } from '../../../shared/types';
import { logger } from '../../../shared/utils/logger';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const XRAY_IMAGE = 'teddysun/xray';

// ============ VLESS URL parsing ============

/**
 * Парсит vless:// ссылку в VlessConfig.
 *
 * Поддерживает:
 * - IPv4 / IPv6 (с [..]:port)
 * - security=none|tls|reality
 * - network=tcp|ws|grpc|xhttp
 * - mode для xhttp
 * - extra JSON для кастомных настроек
 *
 * Не поддерживает (явно): vmess://, trojan:// — будет ошибка.
 */
function parseVlessUri(uri: string): VlessConfig | null {
  try {
    const withoutScheme = uri.slice('vless://'.length);
    const atIdx = withoutScheme.lastIndexOf('@');
    if (atIdx < 0) return null;
    const userinfo = withoutScheme.slice(0, atIdx);
    const rest = withoutScheme.slice(atIdx + 1);

    const hashIdx = rest.indexOf('#');
    const restNoHash = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest;

    const qIdx = restNoHash.indexOf('?');
    const hostPart = qIdx >= 0 ? restNoHash.slice(0, qIdx) : restNoHash;
    const queryStr = qIdx >= 0 ? restNoHash.slice(qIdx + 1) : '';

    let host: string;
    let portStr: string;
    if (hostPart.startsWith('[')) {
      const closeIdx = hostPart.indexOf(']');
      if (closeIdx < 0) return null;
      host = hostPart.slice(1, closeIdx);
      portStr = hostPart.slice(closeIdx + 2);
    } else {
      const colonIdx = hostPart.lastIndexOf(':');
      host = hostPart.slice(0, colonIdx);
      portStr = hostPart.slice(colonIdx + 1);
    }

    const port = parseInt(portStr, 10) || 443;
    const uuid = decodeURIComponent(userinfo);
    if (!uuid) return null;

    const params = new URLSearchParams(queryStr);

    const security = params.get('security') || 'none';
    const networkParam = (params.get('type') || params.get('network') || 'tcp').toLowerCase();
    const network = ['ws', 'grpc', 'xhttp'].includes(networkParam) ? networkParam : 'tcp';
    const sni = params.get('sni') || params.get('peer') || params.get('servername') || host;
    const fingerprint = params.get('fp') || 'chrome';
    const publicKey = params.get('pbk') || undefined;
    const shortId = params.get('sid') || undefined;
    const flow = params.get('flow') || undefined;
    const path = params.get('path') || '/';
    const hostHeader = params.get('host') || sni;
    const grpcServiceName = params.get('serviceName') || params.get('mode') || '';
    const mode = params.get('mode') || undefined;

    let extra: Record<string, unknown> | undefined;
    const extraRaw = params.get('extra');
    if (extraRaw) {
      try {
        extra = JSON.parse(extraRaw) as Record<string, unknown>;
      } catch {
        extra = undefined;
      }
    }

    const alpn = params.get('alpn')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    return {
      uuid,
      host,
      port,
      security,
      network,
      sni,
      fingerprint,
      publicKey,
      shortId,
      flow,
      path,
      hostHeader,
      grpcServiceName,
      mode,
      extra,
      alpn,
    };
  } catch {
    return null;
  }
}

/**
 * Загружает и парсит VLESS-конфигурацию.
 *
 * Поддерживает два источника:
 * 1. Сырая vless:// ссылка — парсится напрямую.
 * 2. URL подписки — загружается, base64-декодируется, берётся первая vless:// ссылка.
 *
 * Раньше не было поддержки raw vless:// — нужно было оборачивать в подписку.
 */
export async function fetchAndParseSubscription(input: string): Promise<VlessConfig> {
  if (input.startsWith('vless://')) {
    const cfg = parseVlessUri(input);
    if (!cfg) throw new Error('Failed to parse vless:// link');
    return cfg;
  }

  let resp: Response;
  try {
    resp = await fetch(input, {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
  } catch (err: any) {
    throw new Error(`Failed to fetch subscription: ${err?.message || err}`);
  }

  if (!resp.ok) {
    throw new Error(`Subscription server returned ${resp.status} ${resp.statusText}`);
  }

  let content = (await resp.text()).trim();

  // Подписки часто base64-кодированы — пробуем декодировать.
  try {
    const decoded = Buffer.from(content, 'base64').toString('utf-8');
    if (decoded.includes('vless://') || decoded.includes('vmess://')) {
      content = decoded;
    }
  } catch {
    // not base64, ignore
  }

  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('vless://'));

  if (lines.length === 0) {
    throw new Error('No vless:// entries in subscription (only VLESS is supported)');
  }

  const cfg = parseVlessUri(lines[0]);
  if (!cfg) throw new Error('Failed to parse vless:// link from subscription');
  return cfg;
}

// ============ xray config generation ============

interface XrayTlsSettings {
  serverName: string;
  fingerprint: string;
  allowInsecure: boolean;
  alpn?: string[];
}

function generateXrayConfig(vless: VlessConfig): string {
  const net =
    vless.network === 'ws'
      ? 'ws'
      : vless.network === 'grpc'
        ? 'grpc'
        : vless.network === 'xhttp'
          ? 'xhttp'
          : 'tcp';

  // Типизированная структура streamSettings — без `unknown`, чтобы TypeScript
  // мог проверять вложенные поля.
  interface StreamSettings {
    network: string;
    security?: string;
    wsSettings?: { path: string; headers: { Host: string } };
    grpcSettings?: { serviceName: string };
    xhttpSettings?: { path: string; host?: string; mode?: string; extra?: Record<string, unknown> };
    realitySettings?: {
      serverName: string;
      fingerprint: string;
      publicKey: string;
      shortId: string;
    };
    tlsSettings?: XrayTlsSettings;
  }

  const streamSettings: StreamSettings = { network: net };

  if (net === 'ws') {
    streamSettings.wsSettings = {
      path: vless.path || '/',
      headers: { Host: vless.hostHeader || vless.sni },
    };
  } else if (net === 'grpc') {
    streamSettings.grpcSettings = { serviceName: vless.grpcServiceName || '' };
  } else if (net === 'xhttp') {
    const xhttpSettings: NonNullable<StreamSettings['xhttpSettings']> = {
      path: vless.path || '/',
    };
    if (vless.hostHeader) xhttpSettings.host = vless.hostHeader;
    if (vless.mode) xhttpSettings.mode = vless.mode;
    if (vless.extra) xhttpSettings.extra = vless.extra;
    streamSettings.xhttpSettings = xhttpSettings;
  }

  if (vless.security === 'reality') {
    streamSettings.security = 'reality';
    streamSettings.realitySettings = {
      serverName: vless.sni,
      fingerprint: vless.fingerprint || 'chrome',
      publicKey: vless.publicKey || '',
      shortId: vless.shortId || '',
    };
  } else if (vless.security === 'tls') {
    const tlsSettings: XrayTlsSettings = {
      serverName: vless.sni,
      fingerprint: vless.fingerprint || 'chrome',
      allowInsecure: false,
    };
    if (vless.alpn?.length) tlsSettings.alpn = vless.alpn;
    streamSettings.security = 'tls';
    streamSettings.tlsSettings = tlsSettings;
  }

  const outboundUser: { id: string; encryption: string; flow?: string } = {
    id: vless.uuid,
    encryption: 'none',
  };
  if (vless.flow) outboundUser.flow = vless.flow;

  const xrayConfig = {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        listen: '0.0.0.0',
        port: 10808,
        protocol: 'socks',
        settings: { auth: 'noauth', udp: false },
      },
    ],
    outbounds: [
      {
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: vless.host,
              port: vless.port,
              users: [outboundUser],
            },
          ],
        },
        streamSettings,
      },
    ],
  };

  return JSON.stringify(xrayConfig, null, 2);
}

async function pullXrayImage(): Promise<void> {
  try {
    await docker.getImage(XRAY_IMAGE).inspect();
    return;
  } catch {
    // not cached
  }
  await new Promise<void>((resolve, reject) => {
    docker.pull(XRAY_IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (err2: Error | null) => {
        if (err2) return reject(err2);
        resolve();
      });
    });
  });
}

export async function createXrayContainer(
  containerName: string,
  vless: VlessConfig
): Promise<void> {
  await pullXrayImage();

  const container = await docker.createContainer({
    Image: XRAY_IMAGE,
    name: containerName,
    HostConfig: {
      NetworkMode: config.dockerNetwork,
      RestartPolicy: { Name: 'unless-stopped' },
      LogConfig: {
        Type: 'json-file',
        Config: { 'max-size': '5m', 'max-file': '2' },
      },
    },
    ExposedPorts: { '10808/tcp': {} },
  });

  const configContent = generateXrayConfig(vless);
  const tarBuf = createTarBuffer('config.json', configContent);
  await container.putArchive(tarBuf, { path: '/etc/xray' });

  await container.start();
  logger.info('xray', `xray container ${containerName} started`);
}

export async function removeXrayContainer(containerName: string): Promise<void> {
  try {
    const container = docker.getContainer(containerName);
    try {
      await container.stop();
    } catch {
      // already stopped
    }
    await container.remove();
  } catch {
    // container gone
  }
}

/**
 * Поднимает остановленные xray-контейнеры при старте service-node.
 *
 * Критично после reboot: Docker поднимает контейнеры параллельно, и telemt
 * может стартовать раньше xray → proxychains не подключается → трафик не идёт.
 */
export async function ensureXrayContainersRunning(containerNames: string[]): Promise<void> {
  const toStart: string[] = [];

  for (const name of containerNames) {
    try {
      const container = docker.getContainer(name);
      const info = await container.inspect();
      if (!info.State.Running) {
        await container.start();
        toStart.push(name);
        logger.info('xray', `Started xray container ${name}`);
      }
    } catch (err: any) {
      logger.error('xray', `Could not ensure xray container ${name}`, {
        error: err.message,
      });
    }
  }

  // Даём xray время забиндить SOCKS5-порт до того, как telemt начнёт коннектиться.
  if (toStart.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
