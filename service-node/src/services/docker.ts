import Docker from 'dockerode';
import { Readable } from 'stream';
import { createHash } from 'crypto';
import { config } from '../config';
import { createTarBuffer } from '../../../shared/utils/tar';
import { extractIp } from '../../../shared/utils/tar';
import { isPrivateIp, isTelegramIp } from '../../../shared/types/constants';
import { DEFAULT_TELEMT_OPTIONS, TelemtOptions } from '../../../shared/types/proxy';
import { logger } from '../../../shared/utils/logger';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

/**
 * Dockerfile для сборки образа telemt-прокси.
 *
 * Используется debian:bookworm-slim как база — slim нужен потому что:
 * - musl-based (alpine) ломает Rust-зависимости telemt
 * - bookworm — актуальный LTS Debian
 *
 * telemt — это высокопроизводительный MTProto-прокси на Rust от проекта telemt/telemt.
 * Архитектура определяется автоматически (amd64 / arm64).
 */
const TELEMT_DOCKERFILE = `FROM debian:bookworm-slim

RUN apt-get update && \\
    apt-get install -y --no-install-recommends curl wget ca-certificates && \\
    rm -rf /var/lib/apt/lists/*

RUN ARCH=$(uname -m) && \\
    wget -qO- "https://github.com/telemt/telemt/releases/latest/download/telemt-\${ARCH}-linux-gnu.tar.gz" | tar -xz -C /usr/local/bin/ && \\
    chmod +x /usr/local/bin/telemt

RUN useradd -r -s /bin/false telemt && \\
    mkdir -p /etc/telemt /opt/telemt && \\
    chown -R telemt:telemt /etc/telemt /opt/telemt

WORKDIR /opt/telemt

USER telemt

ENV RUST_LOG=info

CMD ["/usr/local/bin/telemt", "/etc/telemt/config.toml"]
`;

// ============ Network management ============

export async function ensureNetwork(): Promise<void> {
  try {
    const network = docker.getNetwork(config.dockerNetwork);
    await network.inspect();
  } catch {
    await docker.createNetwork({
      Name: config.dockerNetwork,
      Driver: 'bridge',
    });
    logger.info('docker', `Created Docker network: ${config.dockerNetwork}`);
  }
}

/**
 * Переподключает прокси/xray/nginx контейнеры к общей сети после docker compose down/up.
 *
 * Раньше эта функция существовала только в service-node, но требовалась при миграциях.
 * Без неё контейнеры оставались в default bridge и nginx не мог до них достучаться.
 */
export async function reconnectContainersToNetwork(): Promise<void> {
  const network = docker.getNetwork(config.dockerNetwork);
  const containers = await docker.listContainers({ all: true });

  const managed = containers.filter((c) =>
    c.Names.some(
      (n) =>
        n.includes(config.proxyContainerPrefix) ||
        n.includes(config.xrayContainerPrefix) ||
        n.includes(config.nginxContainerName)
    )
  );

  for (const info of managed) {
    const networks = Object.keys(info.NetworkSettings?.Networks || {});
    if (networks.includes(config.dockerNetwork)) continue;

    // Контейнеры с host network не могут присоединиться к bridge — пропускаем.
    if (networks.includes('host') || info.HostConfig?.NetworkMode === 'host') continue;

    try {
      await network.connect({ Container: info.Id });
      const name = info.Names[0]?.replace(/^\//, '') || info.Id.slice(0, 12);
      logger.info('docker', `Reconnected ${name} to ${config.dockerNetwork}`);
    } catch (err: any) {
      logger.error('docker', `Failed to reconnect ${info.Names[0]}`, { error: err.message });
    }
  }
}

// ============ Image management ============

/**
 * Pull образа, если его нет локально. Избегаем Docker Hub rate limits при рестартах.
 */
export async function pullImage(image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch {
    // Image not found locally — need to pull
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

const DOCKERFILE_HASH = createHash('sha256').update(TELEMT_DOCKERFILE).digest('hex').slice(0, 12);

/**
 * Сборка образа telemt-прокси с hash-based cache invalidation.
 *
 * Исправление: в оригинале вычисление DOCKERFILE_HASH было вынесено в константу,
 * но она пересчитывалась только при старте процесса. Если Dockerfile менялся
 * через volume mount (не в нашем случае, но возможно в dev) — нужен рестарт.
 */
export async function ensureProxyImage(): Promise<void> {
  let needsBuild = false;
  try {
    const imageInfo = await docker.getImage(config.proxyImageName).inspect();
    const existingHash = imageInfo.Config?.Labels?.['dockerfile.hash'] || '';
    if (existingHash !== DOCKERFILE_HASH) {
      logger.info('docker', 'Proxy image outdated, rebuilding', {
        from: existingHash || 'none',
        to: DOCKERFILE_HASH,
      });
      try {
        await docker.getImage(config.proxyImageName).remove({ force: true });
      } catch {
        // ignore
      }
      needsBuild = true;
    }
  } catch {
    needsBuild = true;
  }

  if (!needsBuild) return;

  const tarBuffer = createTarBuffer('Dockerfile', TELEMT_DOCKERFILE);
  const stream = Readable.from(tarBuffer);

  await new Promise<void>((resolve, reject) => {
    docker.buildImage(
      stream,
      { t: config.proxyImageName, labels: { 'dockerfile.hash': DOCKERFILE_HASH } },
      (err, output) => {
        if (err) return reject(err);
        if (!output) return reject(new Error('No build stream from docker.buildImage'));
        docker.modem.followProgress(output, (err2: Error | null) => {
          if (err2) return reject(err2);
          resolve();
        });
      }
    );
  });
  logger.info('docker', `Built proxy image ${config.proxyImageName}`);
}

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

// ============ SOCKS5 URL parsing ============

/**
 * Парсит socks5:// URL в host:port. Loopback заменяется на host.docker.internal,
 * чтобы контейнер мог обратиться к host network сервису (например, для mask-host).
 */
function parseSocks5Url(value: string): { host: string; port: number } | null {
  if (!value.startsWith('socks5://')) return null;
  const withoutScheme = value.slice('socks5://'.length);
  const colonIdx = withoutScheme.lastIndexOf(':');
  const rawHost = colonIdx === -1 ? withoutScheme : withoutScheme.slice(0, colonIdx);
  const portStr = colonIdx === -1 ? '' : withoutScheme.slice(colonIdx + 1);
  const port = parseInt(portStr, 10) || 1080;
  const host =
    rawHost === '127.0.0.1' || rawHost === 'localhost' ? 'host.docker.internal' : rawHost;
  return { host, port };
}

// ============ telemt config generation ============

function generateConfigToml(
  secret: string,
  domain: string,
  listenPort: number,
  tag?: string,
  socks5Host?: string,
  socks5Port?: number,
  maskHost?: string,
  natIp?: string,
  options: TelemtOptions = {}
): string {
  // Мердж с дефолтами — раньше был хардкод длинного списка, теперь живёт в shared.
  const opts = { ...DEFAULT_TELEMT_OPTIONS, ...options };

  // ad_tag — только если пользователь передал валидный hex (32 символа).
  const cleanTag = tag ? tag.trim().replace(/[^0-9a-fA-F]/g, '') : '';

  const stunServers = opts.stunServers.map((s) => `"${s}"`).join(', ');

  let toml = `[general]
use_middle_proxy = ${opts.useMiddleProxy}
fast_mode = ${opts.fastMode}
me2dc_fallback = ${opts.me2dcFallback}
me2dc_fast = ${opts.me2dcFast}
me_keepalive_enabled = ${opts.meKeepaliveEnabled}
me_keepalive_interval_secs = ${opts.meKeepaliveIntervalSecs}
me_keepalive_jitter_secs = ${opts.meKeepaliveJitterSecs}
me_keepalive_payload_random = ${opts.meKeepalivePayloadRandom}
me_reconnect_backoff_base_ms = ${opts.meReconnectBackoffBaseMs}
me_reconnect_backoff_cap_ms = ${opts.meReconnectBackoffCapMs}
me_reconnect_fast_retry_count = ${opts.meReconnectFastRetryCount}
desync_all_full = ${opts.desyncAllFull}
me_writer_pick_mode = "${opts.meWriterPickMode}"
me_warmup_stagger_enabled = ${opts.meWarmupStaggerEnabled}
me_warmup_step_delay_ms = ${opts.meWarmupStepDelayMs}
me_warmup_step_jitter_ms = ${opts.meWarmupStepJitterMs}
beobachten = ${opts.beobachten}
beobachten_minutes = ${opts.beobachtenMinutes}
beobachten_flush_secs = ${opts.beobachtenFlushSecs}
beobachten_file = "${opts.beobachtenFile}"
upstream_connect_retry_attempts = ${opts.upstreamConnectRetryAttempts}
upstream_connect_retry_backoff_ms = ${opts.upstreamConnectRetryBackoffMs}
tg_connect = ${opts.tgConnect}
rst_on_close = "${opts.rstOnClose}"
log_level = "${opts.logLevel}"
unknown_dc_file_log_enabled = ${opts.unknownDcFileLogEnabled}
update_every = ${opts.updateEvery}
network_prefer = "${opts.networkPrefer}"
stun_servers = [${stunServers}]
server_client_mss = ${opts.serverClientMss}
me_init_retry_attempts = ${opts.meInitRetryAttempts}
`;

  // Hybrid mode: ME-сервера Telegram видят наш EU IP через tun0, а DC-трафик
  // идёт через xray/SOCKS5 чтобы обойти блокировки РКН.
  if (natIp) {
    toml += `middle_proxy_nat_ip = "${natIp}"\n`;
  }

  if (cleanTag.length === 32) {
    toml += `ad_tag = "${cleanTag}"\n`;
  }

  toml += `
[general.modes]
classic = false
secure = false
tls = true

[server]
port = ${listenPort || 443}

[censorship]
tls_domain = "${opts.censorshipTlsDomain || domain}"
mask = true
tls_emulation = ${opts.censorshipTlsEmulation}
`;

  if (opts.censorshipTlsFrontDir) {
    toml += `tls_front_dir = "${opts.censorshipTlsFrontDir}"\n`;
  }

  if (maskHost) {
    toml += `mask_host = "${maskHost}"\n`;
  }

  toml += `
[access.users]
user1 = "${secret}"
`;

  if (natIp && socks5Host && socks5Port) {
    // Hybrid: ME direct (через tun0 → EU IP), DC через SOCKS5.
    toml += `
[[upstreams]]
type = "direct"
scopes = "me"

[[upstreams]]
type = "socks5"
address = "${socks5Host}:${socks5Port}"
`;
  } else if (!natIp && socks5Host && socks5Port) {
    // Legacy: ME direct, fetch direct, DC через SOCKS5.
    toml += `
[[upstreams]]
type = "direct"
scopes = "me, fetch"

[[upstreams]]
type = "socks5"
address = "${socks5Host}:${socks5Port}"
`;
  }

  return toml;
}

// ============ Container lifecycle ============

export interface CreateProxyOptions {
  containerName: string;
  secret: string;
  domain: string;
  listenPort: number;
  tag?: string;
  socks5Host?: string;
  maskHost?: string;
  natIp?: string;
  options: TelemtOptions;
}

export async function createProxyContainer(opts: CreateProxyOptions): Promise<string> {
  await ensureNetwork();
  await ensureProxyImage();

  const {
    containerName,
    secret,
    domain,
    listenPort,
    tag,
    socks5Host,
    maskHost,
    natIp,
    options,
  } = opts;

  // Резолвим socks5: либо URL, либо имя контейнера xray.
  const directSocks5 = socks5Host ? parseSocks5Url(socks5Host) : null;
  let resolvedSocks5Host: string | undefined;
  let resolvedSocks5Port: number | undefined;

  if (socks5Host) {
    if (directSocks5) {
      resolvedSocks5Host = directSocks5.host;
      resolvedSocks5Port = directSocks5.port;
    } else {
      resolvedSocks5Host = await resolveContainerIp(socks5Host);
      resolvedSocks5Port = 10808;
    }
  }

  // maskHost — то же самое: loopback → host.docker.internal
  let resolvedMaskHost: string | undefined;
  let needsHostGateway = directSocks5?.host === 'host.docker.internal';
  if (resolvedSocks5Host === 'host.docker.internal') needsHostGateway = true;

  if (maskHost) {
    const colonIdx = maskHost.lastIndexOf(':');
    const mHost = colonIdx === -1 ? maskHost : maskHost.slice(0, colonIdx);
    const mPort = colonIdx === -1 ? '' : maskHost.slice(colonIdx);
    if (mHost === '127.0.0.1' || mHost === 'localhost') {
      resolvedMaskHost = `host.docker.internal${mPort}`;
      needsHostGateway = true;
    } else {
      resolvedMaskHost = maskHost;
    }
  }

  const container = await docker.createContainer({
    Image: config.proxyImageName,
    name: containerName,
    HostConfig: {
      NetworkMode: config.dockerNetwork,
      RestartPolicy: { Name: 'unless-stopped' },
      CapAdd: ['NET_BIND_SERVICE'],
      LogConfig: {
        Type: 'json-file',
        Config: { 'max-size': '5m', 'max-file': '2' },
      },
      ...(needsHostGateway ? { ExtraHosts: ['host.docker.internal:host-gateway'] } : {}),
    },
  });

  const configContent = generateConfigToml(
    secret,
    domain,
    listenPort,
    tag,
    resolvedSocks5Host,
    resolvedSocks5Port,
    resolvedMaskHost,
    natIp,
    options
  );
  const tarBuffer = createTarBuffer('config.toml', configContent);
  await container.putArchive(tarBuffer, { path: '/etc/telemt' });

  await container.start();
  logger.info('docker', `Proxy container ${containerName} started`);
  return container.id;
}

export async function removeProxyContainer(containerName: string): Promise<void> {
  try {
    const container = docker.getContainer(containerName);
    try {
      await container.stop();
    } catch {
      // already stopped
    }
    await container.remove();
  } catch {
    // container not found — already gone
  }
}

// ============ Stats & status ============

export async function getContainerStats(containerName: string): Promise<{
  cpuPercent: string;
  memoryUsage: string;
  memoryLimit: string;
  networkRx: string;
  networkTx: string;
  networkRxBytes: number;
  networkTxBytes: number;
}> {
  const container = docker.getContainer(containerName);
  const stats = await container.stats({ stream: false });

  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpuCount = stats.cpu_stats.online_cpus || 1;
  const cpuPercent =
    systemDelta > 0 ? ((cpuDelta / systemDelta) * cpuCount * 100).toFixed(2) : '0.00';

  const memUsage = stats.memory_stats.usage || 0;
  const memLimit = stats.memory_stats.limit || 0;

  let netRx = 0;
  let netTx = 0;
  if (stats.networks) {
    for (const iface of Object.values(stats.networks) as Array<{ rx_bytes?: number; tx_bytes?: number }>) {
      netRx += iface.rx_bytes || 0;
      netTx += iface.tx_bytes || 0;
    }
  }

  return {
    cpuPercent: `${cpuPercent}%`,
    memoryUsage: formatBytes(memUsage),
    memoryLimit: formatBytes(memLimit),
    networkRx: formatBytes(netRx),
    networkTx: formatBytes(netTx),
    networkRxBytes: netRx,
    networkTxBytes: netTx,
  };
}

export async function getContainerStatus(containerName: string): Promise<string> {
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    return info.State.Status;
  } catch {
    return 'not_found';
  }
}

export async function getContainerUptime(containerName: string): Promise<string> {
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    const startedAt = new Date(info.State.StartedAt);
    const diff = Date.now() - startedAt.getTime();
    if (isNaN(diff) || diff < 0) return 'unknown';
    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  } catch {
    return 'unknown';
  }
}

export async function restartContainer(containerName: string): Promise<void> {
  const container = docker.getContainer(containerName);
  await container.restart();
}

export async function pauseContainer(containerName: string): Promise<void> {
  const container = docker.getContainer(containerName);
  await container.pause();
}

export async function unpauseContainer(containerName: string): Promise<void> {
  const container = docker.getContainer(containerName);
  await container.unpause();
}

// ============ Helpers ============

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
