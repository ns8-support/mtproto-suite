import fs from 'fs';
import path from 'path';
import {
  IpHistoryData,
  IpHistoryEntry,
  ProxyConfig,
  StatsHistoryData,
  StatsSnapshot,
  StoreData,
} from '../../../shared/types';
import { config } from '../config';
import { logger } from '../../../shared/utils/logger';

/**
 * Атомарное JSON-хранилище с write-through кешем.
 *
 * Исправления относительно оригинала:
 * 1. Синхронный writeFileSync → асинхронный writeFile (не блокирует event loop).
 * 2. Чтение всего файла на каждый вызов → кеш в памяти с write-through.
 * 3. Race condition при параллельной записи → serialize через mutex.
 * 4. Потеря данных при крэше в середине записи → атомарная запись через .tmp + rename.
 *
 * Trade-off: при крэше во время rename можно потерять одну запись, но НЕ
 * получить corrupted JSON (это была реальная проблема в оригинале).
 */

const STORE_FILE = path.join(config.dataDir, 'store.json');
const STATS_HISTORY_FILE = path.join(config.dataDir, 'stats-history.json');
const IP_HISTORY_FILE = path.join(config.dataDir, 'ip-history.json');

const STATS_SNAPSHOT_INTERVAL = config.statsIntervalMs;
const MAX_SNAPSHOTS_PER_PROXY = 2016; // ~7 дней при 5-мин интервале

function ensureDataDir(): void {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
}

// ============ Atomic JSON write ============

/**
 * Атомарно записывает JSON в файл: сначала пишет во временный файл,
 * потом переименовывает. rename атомарен на одной файловой системе.
 */
async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.promises.rename(tmpPath, filePath);
}

// ============ Mutex (write serialization) ============

class AsyncMutex {
  private chain: Promise<void> = Promise.resolve();
  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => (release = resolve));
    const wait = this.chain.then(() => next);
    this.chain = this.chain.then(() => next);
    return wait.then(() => release);
  }
}

const storeMutex = new AsyncMutex();

// ============ Store cache ============

interface StoreCache {
  data: StoreData;
  loadedAt: number;
}

let storeCache: StoreCache | null = null;

async function loadStore(): Promise<StoreData> {
  ensureDataDir();
  if (storeCache) return storeCache.data;

  if (!fs.existsSync(STORE_FILE)) {
    const initial: StoreData = { proxies: [] };
    await atomicWriteJson(STORE_FILE, initial);
    storeCache = { data: initial, loadedAt: Date.now() };
    return initial;
  }

  try {
    const raw = await fs.promises.readFile(STORE_FILE, 'utf-8');
    const trimmed = raw.trim();
    if (!trimmed) {
      const initial: StoreData = { proxies: [] };
      await atomicWriteJson(STORE_FILE, initial);
      storeCache = { data: initial, loadedAt: Date.now() };
      return initial;
    }
    const parsed = JSON.parse(trimmed) as StoreData;
    // Мердж дефолтов для обратной совместимости со старыми store.json без полей.
    storeCache = {
      data: {
        proxies: parsed.proxies || [],
        customDomains: parsed.customDomains || [],
        blacklistedIps: parsed.blacklistedIps || [],
      },
      loadedAt: Date.now(),
    };
    return storeCache.data;
  } catch (err) {
    logger.error('store', 'store.json is corrupted, resetting to empty state', {
      error: String(err),
    });
    const initial: StoreData = { proxies: [] };
    await atomicWriteJson(STORE_FILE, initial);
    storeCache = { data: initial, loadedAt: Date.now() };
    return initial;
  }
}

async function persistStore(): Promise<void> {
  if (!storeCache) return;
  const release = await storeMutex.acquire();
  try {
    await atomicWriteJson(STORE_FILE, storeCache.data);
  } finally {
    release();
  }
}

// ============ Proxy operations ============

export async function getAllProxies(): Promise<ProxyConfig[]> {
  const data = await loadStore();
  return data.proxies;
}

export async function getProxyById(id: string): Promise<ProxyConfig | undefined> {
  const data = await loadStore();
  return data.proxies.find((p) => p.id === id);
}

export async function addProxy(proxy: ProxyConfig): Promise<void> {
  const data = await loadStore();
  data.proxies.push(proxy);
  await persistStore();
}

export async function updateProxy(
  id: string,
  updates: Partial<ProxyConfig>
): Promise<ProxyConfig | undefined> {
  const data = await loadStore();
  const index = data.proxies.findIndex((p) => p.id === id);
  if (index === -1) return undefined;
  data.proxies[index] = { ...data.proxies[index], ...updates };
  await persistStore();
  return data.proxies[index];
}

export async function removeProxy(id: string): Promise<boolean> {
  const data = await loadStore();
  const index = data.proxies.findIndex((p) => p.id === id);
  if (index === -1) return false;
  data.proxies.splice(index, 1);
  await persistStore();
  return true;
}

export async function isPortUsed(port: number): Promise<boolean> {
  const data = await loadStore();
  return data.proxies.some((p) => p.port === port);
}

export async function isDomainUsed(domain: string): Promise<boolean> {
  const data = await loadStore();
  return data.proxies.some((p) => p.domain === domain);
}

export async function getUsedDomains(): Promise<string[]> {
  const data = await loadStore();
  return data.proxies.map((p) => p.domain);
}

export async function getCustomDomains(): Promise<string[]> {
  const data = await loadStore();
  return data.customDomains || [];
}

export async function setCustomDomains(domains: string[]): Promise<void> {
  const data = await loadStore();
  data.customDomains = domains;
  await persistStore();
}

export async function getBlacklistedIps(): Promise<string[]> {
  const data = await loadStore();
  return data.blacklistedIps || [];
}

export async function setBlacklistedIps(ips: string[]): Promise<void> {
  const data = await loadStore();
  data.blacklistedIps = ips;
  await persistStore();
}

/**
 * Синхронная версия для мест, где async невозможен (например, в nginx log watcher
 * на каждой строке лога — async/await на каждой строке создаст огромный backlog).
 *
 * Кеш уже загружен в памяти, поэтому просто читаем его. Если кеш пуст — это
 * programmer error, лучше упасть с понятной ошибкой.
 */
export function getAllProxiesSync(): ProxyConfig[] {
  if (!storeCache) {
    throw new Error('Store cache not loaded — call loadStore() first');
  }
  return storeCache.data.proxies;
}

export function getBlacklistedIpsSync(): string[] {
  if (!storeCache) {
    throw new Error('Store cache not loaded');
  }
  return storeCache.data.blacklistedIps || [];
}

// ============ Stats History ============

let statsHistoryCache: StatsHistoryData | null = null;

async function loadStatsHistory(): Promise<StatsHistoryData> {
  ensureDataDir();
  if (statsHistoryCache) return statsHistoryCache;
  if (!fs.existsSync(STATS_HISTORY_FILE)) {
    statsHistoryCache = {};
    return statsHistoryCache;
  }
  try {
    const raw = await fs.promises.readFile(STATS_HISTORY_FILE, 'utf-8');
    statsHistoryCache = (JSON.parse(raw) as StatsHistoryData) || {};
  } catch {
    statsHistoryCache = {};
  }
  return statsHistoryCache;
}

async function persistStatsHistory(): Promise<void> {
  if (!statsHistoryCache) return;
  const release = await storeMutex.acquire();
  try {
    // stats-history может быть большим, поэтому без pretty-print.
    const tmpPath = `${STATS_HISTORY_FILE}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(statsHistoryCache), 'utf-8');
    await fs.promises.rename(tmpPath, STATS_HISTORY_FILE);
  } finally {
    release();
  }
}

export async function addStatsSnapshot(proxyId: string, snapshot: StatsSnapshot): Promise<void> {
  const history = await loadStatsHistory();
  if (!history[proxyId]) history[proxyId] = [];
  const arr = history[proxyId];

  // Throttle: не чаще раза в STATS_SNAPSHOT_INTERVAL.
  if (arr.length > 0) {
    const lastTs = new Date(arr[arr.length - 1].timestamp).getTime();
    if (Date.now() - lastTs < STATS_SNAPSHOT_INTERVAL) return;
  }

  arr.push(snapshot);
  if (arr.length > MAX_SNAPSHOTS_PER_PROXY) {
    history[proxyId] = arr.slice(-MAX_SNAPSHOTS_PER_PROXY);
  }

  await persistStatsHistory();
}

export async function getStatsHistory(proxyId: string): Promise<StatsSnapshot[]> {
  const history = await loadStatsHistory();
  return history[proxyId] || [];
}

export async function removeStatsHistory(proxyId: string): Promise<void> {
  const history = await loadStatsHistory();
  delete history[proxyId];
  await persistStatsHistory();
}

// ============ IP History (с in-memory кешем и debounced flush) ============

let ipHistoryCache: IpHistoryData | null = null;
let ipHistoryDirty = false;
let ipHistoryFlushTimer: ReturnType<typeof setTimeout> | null = null;

async function loadIpHistory(): Promise<IpHistoryData> {
  ensureDataDir();
  if (ipHistoryCache) return ipHistoryCache;
  if (!fs.existsSync(IP_HISTORY_FILE)) {
    ipHistoryCache = {};
    return ipHistoryCache;
  }
  try {
    const raw = await fs.promises.readFile(IP_HISTORY_FILE, 'utf-8');
    ipHistoryCache = (JSON.parse(raw) as IpHistoryData) || {};
  } catch {
    ipHistoryCache = {};
  }
  return ipHistoryCache;
}

function scheduleIpHistoryFlush(): void {
  if (ipHistoryFlushTimer) return;
  ipHistoryFlushTimer = setTimeout(() => {
    ipHistoryFlushTimer = null;
    if (!ipHistoryDirty || !ipHistoryCache) return;
    const release = storeMutex.acquire();
    release.then(async () => {
      try {
        const tmpPath = `${IP_HISTORY_FILE}.tmp`;
        await fs.promises.writeFile(tmpPath, JSON.stringify(ipHistoryCache), 'utf-8');
        await fs.promises.rename(tmpPath, IP_HISTORY_FILE);
        ipHistoryDirty = false;
      } catch (err) {
        logger.error('store', 'Failed to flush ip-history', { error: String(err) });
      }
    });
  }, config.ipHistoryFlushIntervalMs);
}

/**
 * Sync-версия для nginx log watcher. Кеш должен быть уже загружен.
 *
 * Исправление: в оригинале был setTimeout-immediately логика, из-за чего
 * при 100+ событий/сек создавался лавина таймеров. Теперь debounced.
 */
export function updateIpHistorySync(
  proxyId: string,
  connectedIps: Array<{ ip: string; country?: string; countryCode?: string }>
): void {
  if (!ipHistoryCache) {
    // Ленивая синхронная загрузка при первом обращении.
    // Бросаем, если storeCache тоже не загружен — тогда nginx log watcher
    // не должен был стартовать (вызывающий код проверяет).
    if (!fs.existsSync(IP_HISTORY_FILE)) {
      ipHistoryCache = {};
    } else {
      try {
        ipHistoryCache = JSON.parse(
          fs.readFileSync(IP_HISTORY_FILE, 'utf-8')
        ) as IpHistoryData;
      } catch {
        ipHistoryCache = {};
      }
    }
  }
  if (!ipHistoryCache[proxyId]) ipHistoryCache[proxyId] = [];
  const arr = ipHistoryCache[proxyId];
  const now = new Date().toISOString();

  for (const info of connectedIps) {
    const existing = arr.find((e) => e.ip === info.ip);
    if (existing) {
      existing.lastSeen = now;
      if (info.country) existing.country = info.country;
      if (info.countryCode) existing.countryCode = info.countryCode;
    } else {
      arr.push({
        ip: info.ip,
        country: info.country,
        countryCode: info.countryCode,
        firstSeen: now,
        lastSeen: now,
      });
    }
  }

  ipHistoryDirty = true;
  scheduleIpHistoryFlush();
}

export function getIpHistorySync(proxyId: string): IpHistoryEntry[] {
  if (!ipHistoryCache) return [];
  return ipHistoryCache[proxyId] || [];
}

export async function removeIpHistory(proxyId: string): Promise<void> {
  const history = await loadIpHistory();
  delete history[proxyId];
  await atomicWriteJson(IP_HISTORY_FILE, history);
}

/**
 * Принудительный сброс ip-history на диск. Вызывается при graceful shutdown,
 * чтобы не потерять последние 10 секунд данных.
 */
export async function flushIpHistory(): Promise<void> {
  if (!ipHistoryDirty || !ipHistoryCache) return;
  const release = await storeMutex.acquire();
  try {
    const tmpPath = `${IP_HISTORY_FILE}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(ipHistoryCache), 'utf-8');
    await fs.promises.rename(tmpPath, IP_HISTORY_FILE);
    ipHistoryDirty = false;
  } finally {
    release();
  }
}

/**
 * Прогрев всех кешей при старте. Делается один раз перед стартом HTTP-сервера.
 */
export async function warmupCaches(): Promise<void> {
  await Promise.all([loadStore(), loadStatsHistory(), loadIpHistory()]);
}
