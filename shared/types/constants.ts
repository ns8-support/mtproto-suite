/**
 * Константы, общие для panel-backend и service-node.
 * Раньше дублировались (TELEGRAM_DC_RANGES — в docker.ts и nginx.ts).
 */

/**
 * Telegram DC IP-префиксы, которые должны фильтроваться из списка «подключённых IP».
 * Источник: официальные диапазоны Telegram.
 */
export const TELEGRAM_DC_RANGES: readonly string[] = [
  '149.154.160.', '149.154.161.', '149.154.162.', '149.154.163.',
  '149.154.164.', '149.154.165.', '149.154.166.', '149.154.167.',
  '149.154.168.', '149.154.169.', '149.154.170.', '149.154.171.',
  '149.154.172.', '149.154.173.', '149.154.174.', '149.154.175.',
  '91.108.4.', '91.108.5.', '91.108.6.', '91.108.7.', '91.108.8.',
  '91.108.9.', '91.108.10.', '91.108.11.', '91.108.12.', '91.108.13.',
  '91.108.16.', '91.108.17.', '91.108.18.', '91.108.19.', '91.108.20.',
  '91.108.56.', '91.108.57.', '91.108.58.', '91.108.59.',
  '91.105.192.', '91.105.193.', '91.105.194.', '91.105.195.',
  '185.76.151.',
  '95.161.64.',
];

/**
 * Проверяет, относится ли IP к Telegram DC (по известным префиксам).
 * Используется и в docker.ts (parse из логов telemt), и в nginx.ts (из access-логов).
 */
export function isTelegramIp(ip: string): boolean {
  for (const prefix of TELEGRAM_DC_RANGES) {
    if (ip.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Проверяет, является ли IP приватным/loopback.
 * Заменяет цепочку `startsWith('127.') || startsWith('10.') || ...` по всему коду.
 */
export function isPrivateIp(ip: string): boolean {
  return (
    ip === '0.0.0.0' ||
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    // 172.16.0.0/12 — частный диапазон, проверяется только префикс '172.'.
    // ВНИМАНИЕ: это включает любые 172.x.x.x адреса, что в публичных сетях
    // теоретически может дать false negative, но на практике в логах nginx
    // такие адреса не встречаются.
    ip.startsWith('172.')
  );
}

/**
 * Дефолтный пул доменов для fake TLS.
 * Используется, когда пользователь не указал свой пул.
 */
export const FAKE_TLS_DOMAINS: readonly string[] = [
  // Google
  'www.google.com', 'ajax.googleapis.com', 'fonts.googleapis.com',
  'update.googleapis.com', 'maps.googleapis.com', 'play.google.com',
  'apis.google.com', 'accounts.google.com', 'ssl.gstatic.com', 'fonts.gstatic.com',
  // Microsoft
  'www.microsoft.com', 'login.microsoftonline.com', 'graph.microsoft.com',
  'outlook.office365.com', 'cdn.office.net', 'www.bing.com', 'assets.msn.com',
  // Apple
  'www.apple.com', 'support.apple.com', 'developer.apple.com',
  // CDN / Infra
  'www.cloudflare.com', 'cdnjs.cloudflare.com', 'static.cloudflareinsights.com',
  'cdn.jsdelivr.net', 'unpkg.com', 'cdn.akamai.com', 'fastly.net',
  // Social / Media
  'static.xx.fbcdn.net', 'www.reddit.com', 'www.linkedin.com',
  // E-commerce / Services
  'www.amazon.com', 'images-na.ssl-images-amazon.com', 'www.ebay.com', 'www.paypal.com',
  // Dev / Tech
  'www.github.com', 'raw.githubusercontent.com', 'stackoverflow.com', 'cdn.stackoverflow.com',
  // Reference
  'www.wikipedia.org', 'en.wikipedia.org', 'upload.wikimedia.org',
  // News / Other
  'www.bbc.com', 'www.reuters.com', 'www.nytimes.com', 'www.theguardian.com', 'www.forbes.com',
];

/**
 * Имя Docker-сети, общей для всех прокси/xray/nginx контейнеров.
 */
export const DOCKER_NETWORK_NAME = 'mtproto-net';

/**
 * Префиксы имён контейнеров.
 */
export const CONTAINER_PREFIXES = {
  proxy: 'mtproto-proxy-',
  xray: 'mtproto-xray-',
  nginx: 'mtproto-nginx',
} as const;

/**
 * Название образа telemt-прокси.
 */
export const PROXY_IMAGE_NAME = 'telemt-proxy-v4';

/**
 * Диапазон портов для listenPort по умолчанию (если пользователь не указал конкретный).
 */
export const PORT_RANGE = { start: 10001, end: 19999 } as const;
