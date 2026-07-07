import path from 'path';
import {
  CONTAINER_PREFIXES,
  DOCKER_NETWORK_NAME,
  PORT_RANGE,
  PROXY_IMAGE_NAME,
} from '../../../shared/types/constants';

/**
 * Единая конфигурация service-node.
 *
 * Все дефолты вынесены в shared, чтобы panel и service-node сходились.
 * При чтении числовых значений из ENV обязательно используется radix 10,
 * иначе Node парсит '0800' как восьмеричное.
 */
export const config = {
  port: parseInt(process.env.PORT || '8443', 10),
  nginxPort: parseInt(process.env.NGINX_PORT || '443', 10),
  authToken: process.env.AUTH_TOKEN || '',
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'),
  dockerNetwork: DOCKER_NETWORK_NAME,
  nginxContainerName: CONTAINER_PREFIXES.nginx,
  proxyImageName: PROXY_IMAGE_NAME,
  proxyContainerPrefix: CONTAINER_PREFIXES.proxy,
  xrayContainerPrefix: CONTAINER_PREFIXES.xray,
  portRangeStart: PORT_RANGE.start,
  portRangeEnd: PORT_RANGE.end,
  /** NAT_IP: публичный IP VPN exit-ноды (зарубежный VPS). Может быть переопределён per-proxy. */
  natIp: process.env.NAT_IP || '',
  /** Имя TUN/TAP-интерфейса для туннеля. */
  tunnelInterface: process.env.TUNNEL_INTERFACE || '',
  /** URL внешнего GeoIP API. По умолчанию бесплатный ip-api.com (batch endpoint). */
  geoApiUrl: process.env.GEO_API_URL || 'http://ip-api.com/batch',
  /** TTL кеша GeoIP-ответов в мс (1 час). */
  geoCacheTtlMs: parseInt(process.env.GEO_CACHE_TTL_MS || '3600000', 10),
  /** Интервал фонового сборщика статистики (5 минут). */
  statsIntervalMs: parseInt(process.env.STATS_INTERVAL_MS || String(5 * 60 * 1000), 10),
  /** Интервал сброса ip-history на диск (10 секунд — было 10s, оставляем как есть). */
  ipHistoryFlushIntervalMs: parseInt(process.env.IP_HISTORY_FLUSH_MS || '10000', 10),
  /** Задержка перед первым сбором статистики после старта (дать контейнерам подняться). */
  initialStatsDelayMs: parseInt(process.env.INITIAL_STATS_DELAY_MS || '30000', 10),
  /** TTL кеша домен→proxyId для nginx log watcher (30 секунд). */
  domainCacheTtlMs: parseInt(process.env.DOMAIN_CACHE_TTL_MS || '30000', 10),
};

/**
 * Валидирует конфиг при старте. Бросает Error, если что-то критически не так.
 * Раньше валидации не было — контейнер стартовал с AUTH_TOKEN='' и принимал любые запросы.
 */
export function validateConfig(): void {
  if (!config.authToken) {
    throw new Error(
      'AUTH_TOKEN environment variable is not set. Service node refuses to start without it.'
    );
  }
  if (config.authToken.length < 16) {
    throw new Error(
      `AUTH_TOKEN must be at least 16 characters (got ${config.authToken.length}).`
    );
  }
  if (config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid PORT: ${config.port}`);
  }
  if (config.nginxPort < 1 || config.nginxPort > 65535) {
    throw new Error(`Invalid NGINX_PORT: ${config.nginxPort}`);
  }
}
