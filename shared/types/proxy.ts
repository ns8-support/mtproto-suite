/**
 * Общие типы для MTProto прокси, используются в panel-backend и service-node.
 *
 * Раньше эти типы дублировались в двух репозиториях с небольшими отличиями,
 * что приводило к расхождениям при эволюции схемы. Теперь — единый источник.
 */

export type ProxyStatus = 'running' | 'stopped' | 'paused' | 'error';

export type ProxyMeWriterPickMode = 'sorted_rr' | 'p2c' | (string & {});

/**
 * Расширенные параметры telemt-конфигурации.
 *
 * Все поля опциональны — service-node заполнит дефолты из DEFAULT_TELEMT_OPTIONS,
 * если пользователь не указал значение в UI.
 */
export interface TelemtOptions {
  useMiddleProxy?: boolean;
  fastMode?: boolean;
  meInitRetryAttempts?: number;
  me2dcFallback?: boolean;
  me2dcFast?: boolean;
  meKeepaliveEnabled?: boolean;
  meKeepaliveIntervalSecs?: number;
  meKeepaliveJitterSecs?: number;
  meKeepalivePayloadRandom?: boolean;
  meReconnectBackoffBaseMs?: number;
  meReconnectBackoffCapMs?: number;
  meReconnectFastRetryCount?: number;
  desyncAllFull?: boolean;
  meWriterPickMode?: ProxyMeWriterPickMode;
  meWarmupStaggerEnabled?: boolean;
  meWarmupStepDelayMs?: number;
  meWarmupStepJitterMs?: number;
  beobachten?: boolean;
  beobachtenMinutes?: number;
  beobachtenFlushSecs?: number;
  beobachtenFile?: string;
  upstreamConnectRetryAttempts?: number;
  upstreamConnectRetryBackoffMs?: number;
  tgConnect?: number;
  rstOnClose?: string;
  logLevel?: string;
  unknownDcFileLogEnabled?: boolean;
  updateEvery?: number;
  networkPrefer?: string;
  stunServers?: string[];
  serverClientMss?: number;
  censorshipTlsDomain?: string;
  censorshipTlsEmulation?: boolean;
  censorshipTlsFrontDir?: string;
}

/**
 * Дефолты для telemt-конфигурации.
 * Экспортируются, чтобы service-node и panel могли рендерить одинаковый UI/JSON.
 */
export const DEFAULT_TELEMT_OPTIONS: Required<TelemtOptions> = {
  useMiddleProxy: true,
  fastMode: true,
  meInitRetryAttempts: 5,
  me2dcFallback: true,
  me2dcFast: true,
  meKeepaliveEnabled: true,
  meKeepaliveIntervalSecs: 5,
  meKeepaliveJitterSecs: 1,
  meKeepalivePayloadRandom: true,
  meReconnectBackoffBaseMs: 200,
  meReconnectBackoffCapMs: 1000,
  meReconnectFastRetryCount: 12,
  desyncAllFull: true,
  meWriterPickMode: 'p2c',
  meWarmupStaggerEnabled: true,
  meWarmupStepDelayMs: 30,
  meWarmupStepJitterMs: 5,
  beobachten: true,
  beobachtenMinutes: 15,
  beobachtenFlushSecs: 5,
  beobachtenFile: '/tmp/telemt-beobachten.json',
  upstreamConnectRetryAttempts: 5,
  upstreamConnectRetryBackoffMs: 500,
  tgConnect: 10,
  rstOnClose: 'off',
  logLevel: 'silent',
  unknownDcFileLogEnabled: true,
  updateEvery: 30,
  networkPrefer: 'system',
  stunServers: ['stun.l.google.com:19302'],
  serverClientMss: 1360,
  censorshipTlsDomain: '',
  censorshipTlsEmulation: true,
  censorshipTlsFrontDir: '',
};

/**
 * Ключи telemt-опций.
 * Используются в update-роуте, чтобы знать, какие поля требуют перезапуск контейнера.
 */
export const TELEMT_OPTION_KEYS: ReadonlyArray<keyof TelemtOptions> = [
  'useMiddleProxy', 'fastMode', 'meInitRetryAttempts',
  'me2dcFallback', 'me2dcFast', 'meKeepaliveEnabled',
  'meKeepaliveIntervalSecs', 'meKeepaliveJitterSecs', 'meKeepalivePayloadRandom',
  'meReconnectBackoffBaseMs', 'meReconnectBackoffCapMs', 'meReconnectFastRetryCount',
  'desyncAllFull', 'meWriterPickMode', 'meWarmupStaggerEnabled',
  'meWarmupStepDelayMs', 'meWarmupStepJitterMs', 'beobachten',
  'beobachtenMinutes', 'beobachtenFlushSecs', 'beobachtenFile',
  'upstreamConnectRetryAttempts', 'upstreamConnectRetryBackoffMs',
  'tgConnect', 'rstOnClose', 'logLevel', 'unknownDcFileLogEnabled',
  'updateEvery', 'networkPrefer', 'stunServers', 'serverClientMss',
  'censorshipTlsDomain', 'censorshipTlsEmulation', 'censorshipTlsFrontDir',
];

export interface ConnectedIpInfo {
  ip: string;
  country?: string;
  countryCode?: string;
}

/**
 * Полное состояние прокси (хранится в JSON-сторе на service-node).
 * Идентификатор `id` — короткий UUID v4 (первый сегмент), уникальный в пределах ноды.
 */
export interface ProxyConfig {
  id: string;
  name: string;
  note: string;
  port: number;
  secret: string;
  domain: string;
  containerName: string;
  status: ProxyStatus;
  createdAt: string;
  tag?: string;
  trafficUp: number;
  trafficDown: number;
  connectedIps: string[];
  maxConnections?: number;
  /** Эффективный порт nginx (из config.nginxPort), нужен для формирования tg://proxy */
  nginxPort?: number;
  /** Если задан и не равен nginxPort — прокси слушает на отдельном TCP-порту */
  listenPort?: number;
  vpnSubscription?: string;
  vpnContainerName?: string;
  maskHost?: string;
  natIp?: string;
  tunnelInterface?: string;
}

/**
 * Request-тип для создания прокси.
 * Объединяет TelemtOptions с метаданными прокси (порт, имя, домен).
 */
export type ProxyCreateRequest = TelemtOptions & {
  port?: number;
  secret?: string;
  domain?: string;
  tag?: string;
  name?: string;
  note?: string;
  maxConnections?: number;
  listenPort?: number;
  vpnSubscription?: string;
  maskHost?: string;
  natIp?: string;
  tunnelInterface?: string;
};

/**
 * Request-тип для частичного обновления прокси (PATCH-семантика).
 * censorshipTlsEmulation принимает boolean | string для обратной совместимости со старым фронтом.
 */
export type ProxyUpdateRequest = Partial<ProxyCreateRequest> & {
  censorshipTlsEmulation?: boolean | string;
};

export interface ProxyStats {
  id: string;
  containerName: string;
  status: string;
  cpuPercent: string;
  memoryUsage: string;
  memoryLimit: string;
  networkRx: string;
  networkTx: string;
  networkRxBytes: number;
  networkTxBytes: number;
  uptime: string;
  connectedIps: ConnectedIpInfo[];
}

export interface StoreData {
  proxies: ProxyConfig[];
  customDomains?: string[];
  blacklistedIps?: string[];
}

export interface StatsSnapshot {
  timestamp: string;
  cpuPercent: number;
  memoryBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  connectedCount: number;
}

export interface IpHistoryEntry {
  ip: string;
  country?: string;
  countryCode?: string;
  firstSeen: string;
  lastSeen: string;
}

export type StatsHistoryData = Record<string, StatsSnapshot[]>;
export type IpHistoryData = Record<string, IpHistoryEntry[]>;
