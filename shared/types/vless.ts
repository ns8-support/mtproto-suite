/**
 * Типы для VLESS-конфигурации, парсятся из vless:// ссылки или подписки.
 * Используются только в service-node.
 */

export interface VlessConfig {
  uuid: string;
  host: string;
  port: number;
  /** 'none' | 'tls' | 'reality' */
  security: string;
  /** 'tcp' | 'ws' | 'grpc' | 'xhttp' */
  network: string;
  sni: string;
  fingerprint: string;
  /** REALITY public key */
  publicKey?: string;
  /** REALITY short ID */
  shortId?: string;
  flow?: string;
  path?: string;
  hostHeader?: string;
  grpcServiceName?: string;
  mode?: string;
  extra?: Record<string, unknown>;
  alpn?: string[];
}
