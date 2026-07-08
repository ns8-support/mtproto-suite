import axios, { AxiosInstance } from 'axios';
import { logger } from '../../../../shared/utils/logger';

/**
 * Cloudflare API клиент для DNS-01 challenge при получении wildcard Let's Encrypt.
 *
 * Для wildcard сертификата (*.example.com) нужен DNS-01 challenge, потому что
 * HTTP-01 не работает для wildcard. ACME сервер должен проверить TXT запись
 * `_acme-challenge.example.com`, которую мы создаём через Cloudflare API.
 *
 * API Token permissions:
 * - Zone:DNS:Edit — создание/удаление TXT записей
 * - Zone:Zone:Read — определение zone_id по домену
 *
 * Создаётся на https://dash.cloudflare.com/profile/api-tokens
 * с шаблоном "Edit zone DNS".
 */

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

export interface CloudflareCredentials {
  /** API Token (рекомендуется) или Global API Key. */
  apiToken: string;
  /** Email для Global API Key (не нужно для API Token). */
  email?: string;
}

export interface CloudflareZone {
  id: string;
  name: string;
}

export interface CloudflareDnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  ttl: number;
  proxied: boolean;
}

/**
 * Создаёт Cloudflare API клиент.
 */
function createClient(credentials: CloudflareCredentials): AxiosInstance {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (credentials.apiToken) {
    headers.Authorization = `Bearer ${credentials.apiToken}`;
  } else {
    throw new Error('Cloudflare apiToken is required');
  }

  return axios.create({
    baseURL: CF_API_BASE,
    headers,
    timeout: 30000,
  });
}

/**
 * Тестирует Cloudflare credentials: пытается получить список зон.
 */
export async function testCloudflareCredentials(
  credentials: CloudflareCredentials
): Promise<{ success: boolean; zoneCount?: number; error?: string }> {
  try {
    const client = createClient(credentials);
    const resp = await client.get('/zones?per_page=1');
    if (resp.status === 200) {
      const total = resp.data.result_info?.total_count ?? resp.data.result?.length ?? 0;
      return { success: true, zoneCount: total };
    }
    return { success: false, error: `Unexpected status: ${resp.status}` };
  } catch (err: any) {
    const message = err.response?.data?.errors?.[0]?.message || err.message;
    return { success: false, error: message };
  }
}

/**
 * Получает zone_id по имени домена.
 */
export async function getZone(
  credentials: CloudflareCredentials,
  domain: string
): Promise<CloudflareZone> {
  const client = createClient(credentials);
  const resp = await client.get('/zones', { params: { name: domain } });
  if (resp.data.result.length === 0) {
    throw new Error(`Zone "${domain}" not found in Cloudflare account. Make sure the domain is added to your Cloudflare account.`);
  }
  const zone = resp.data.result[0];
  return { id: zone.id, name: zone.name };
}

/**
 * Создаёт или обновляет TXT запись для ACME DNS-01 challenge.
 *
 * Возвращает id созданной/обновлённой записи — нужно для последующего удаления.
 */
export async function createTxtRecord(
  credentials: CloudflareCredentials,
  zoneId: string,
  name: string,
  content: string
): Promise<string> {
  const client = createClient(credentials);

  // Проверяем, существует ли уже запись с таким именем.
  const existing = await client.get('/zones/' + zoneId + '/dns_records', {
    params: { type: 'TXT', name },
  });

  if (existing.data.result.length > 0) {
    // Обновляем существующую.
    const recordId = existing.data.result[0].id;
    await client.put('/zones/' + zoneId + '/dns_records/' + recordId, {
      type: 'TXT',
      name,
      content,
      ttl: 60, // Минимальный TTL — нужно для быстрого обновления
      proxied: false,
    });
    logger.info('cloudflare', `Updated TXT record: ${name}`);
    return recordId;
  }

  // Создаём новую.
  const resp = await client.post('/zones/' + zoneId + '/dns_records', {
    type: 'TXT',
    name,
    content,
    ttl: 60,
    proxied: false,
  });
  logger.info('cloudflare', `Created TXT record: ${name}`);
  return resp.data.result.id;
}

/**
 * Удаляет TXT запись по id (вызывается после успешного/неуспешного challenge).
 */
export async function deleteTxtRecord(
  credentials: CloudflareCredentials,
  zoneId: string,
  recordId: string
): Promise<void> {
  try {
    const client = createClient(credentials);
    await client.delete('/zones/' + zoneId + '/dns_records/' + recordId);
    logger.info('cloudflare', `Deleted TXT record: ${recordId}`);
  } catch (err: any) {
    logger.warn('cloudflare', `Failed to delete TXT record ${recordId}`, { error: err.message });
  }
}
