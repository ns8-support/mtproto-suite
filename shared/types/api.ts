/**
 * Типы для API-контракта между panel-backend и service-node.
 * Должны быть синхронизированы на обеих сторонах — теперь живут в shared.
 */

export interface ServiceNodeHealth {
  status: 'ok';
  timestamp: string;
  version: string;
}

export interface ProxyLinkResponse {
  link: string;
}

export interface ExportBundle {
  version: 1;
  exportedAt: string;
  proxies: Array<{
    name: string;
    note: string;
    secret: string;
    domain: string;
    port: number;
    listenPort?: number;
    tag?: string;
    maxConnections?: number;
    vpnSubscription?: string;
    maskHost?: string;
    natIp?: string;
    tunnelInterface?: string;
  } & Record<string, unknown>>;
}

export interface ImportResult {
  imported: number;
  errors: string[];
}

export interface DomainsResponse {
  domains: string[];
}

export interface BlacklistResponse {
  ips: string[];
}

/**
 * Ошибка, возвращаемая API в формате { error: string }.
 * Используется для типобезопасной обработки на фронте.
 */
export interface ApiError {
  error: string;
}
