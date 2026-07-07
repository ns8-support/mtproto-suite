/**
 * API для wildcard SSL сертификатов через Cloudflare DNS-01 challenge.
 */

export interface CloudflareTestResult {
  success: boolean;
  zoneCount?: number;
  error?: string;
}

export interface WildcardObtainRequest {
  wildcardDomain: string;
  rootDomain: string;
  email: string;
  staging?: boolean;
  cloudflare: {
    apiToken: string;
  };
}

export interface CertificateInfo {
  domain: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  serialNumber: string;
}

export interface WildcardObtainResult {
  success: boolean;
  certificatePath?: string;
  privateKeyPath?: string;
  certInfo?: CertificateInfo;
  error?: string;
}

export interface CertificateStatus {
  name: string;
  certificatePath: string;
  privateKeyPath: string | null;
  expiringSoon: boolean;
  lastChecked: string;
}

export interface SslStatusResult {
  outputDir: string;
  certificates: CertificateStatus[];
}

export interface CloudflareZone {
  id: string;
  name: string;
}

import { request } from './index';

export async function testCloudflare(apiToken: string): Promise<CloudflareTestResult> {
  return request('POST', '/api/ssl/cloudflare/test', { apiToken }, { timeoutMs: 30000 });
}

export async function obtainWildcard(data: WildcardObtainRequest): Promise<WildcardObtainResult> {
  return request('POST', '/api/ssl/wildcard/obtain', data, { timeoutMs: 600000 });
}

export async function getSslStatus(): Promise<SslStatusResult> {
  return request('GET', '/api/ssl/wildcard/status');
}

export async function listCloudflareZones(apiToken: string): Promise<{ zones: CloudflareZone[] }> {
  return request('GET', `/api/ssl/zones?apiToken=${encodeURIComponent(apiToken)}`);
}

export async function renewWildcard(data: WildcardObtainRequest): Promise<WildcardObtainResult> {
  return request('POST', '/api/ssl/wildcard/renew', data, { timeoutMs: 600000 });
}
