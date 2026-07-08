import * as acme from 'acme-client';
import * as forge from 'node-forge';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../../../shared/utils/logger';
import {
  CloudflareCredentials,
  createTxtRecord,
  deleteTxtRecord,
  getZone,
} from './cloudflare';

/**
 * ACME клиент для wildcard Let's Encrypt сертификатов через DNS-01 challenge.
 *
 * Использует acme-client v5+ с новым Client API.
 * Wildcard сертификаты (*.example.com) можно получить ТОЛЬКО через DNS-01 challenge.
 *
 * Production: https://acme-v02.api.letsencrypt.org/directory
 * Staging: https://acme-staging-v02.api.letsencrypt.org/directory
 */

const PRODUCTION_DIRECTORY_URL = 'https://acme-v02.api.letsencrypt.org/directory';
const STAGING_DIRECTORY_URL = 'https://acme-staging-v02.api.letsencrypt.org/directory';

export interface WildcardCertificateParams {
  /** Wildcard домен (например, "*.example.com"). */
  wildcardDomain: string;
  /** Root домен (например, "example.com"). */
  rootDomain: string;
  /** Cloudflare credentials. */
  cloudflare: CloudflareCredentials;
  /** Использовать staging сервер. */
  staging?: boolean;
  /** Email для ACME account. */
  email: string;
  /** Каталог для сохранения сертификата и ключа. */
  outputDir: string;
  /** Имя файла (default — rootDomain с подчёркиваниями). */
  fileName?: string;
}

export interface WildcardCertificateResult {
  success: boolean;
  certificatePath?: string;
  privateKeyPath?: string;
  certInfo?: {
    domain: string;
    issuer: string;
    validFrom: string;
    validTo: string;
    serialNumber: string;
  };
  error?: string;
}

/**
 * Получает wildcard сертификат от Let's Encrypt через DNS-01 challenge.
 *
 * Алгоритм:
 * 1. Создаём ACME Client с RSA ключом (account key).
 * 2. Создаём CSR для wildcard домена через crypto.createCsr().
 * 3. Создаём order через client.createOrder().
 * 4. Получаем authorizations (обычно одна для wildcard).
 * 5. Для DNS-01 challenge — получаем keyAuthorization, создаём TXT запись через Cloudflare.
 * 6. Сообщаем ACME серверу challenge.complete().
 * 7. Ждём valid status, finalize order с CSR.
 * 8. Получаем сертификат и сохраняем на диск.
 * 9. Удаляем TXT запись из Cloudflare.
 */
export async function obtainWildcardCertificate(
  params: WildcardCertificateParams
): Promise<WildcardCertificateResult> {
  const fileName = params.fileName || params.rootDomain.replace(/\./g, '_');
  const outputDir = params.outputDir;
  const certPath = path.join(outputDir, `${fileName}.cert.pem`);
  const keyPath = path.join(outputDir, `${fileName}.key.pem`);

  await fs.mkdir(outputDir, { recursive: true });

  // 1. Создаём ACME Client с RSA ключом.
  const accountKey = await acme.crypto.createPrivateRsaKey(2048);
  const client = new acme.Client({
    directoryUrl: params.staging ? STAGING_DIRECTORY_URL : PRODUCTION_DIRECTORY_URL,
    accountKey,
  });

  // Регистрируем аккаунт.
  try {
    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [`mailto:${params.email}`],
    });
  } catch (err: any) {
    logger.error('acme', 'Failed to create ACME account', { error: err.message });
    return { success: false, error: `ACME account creation failed: ${err.message}` };
  }

  // 2. Генерируем CSR + private key для wildcard домена.
  const altNames = [params.wildcardDomain];
  let privateKey: Buffer;
  let csr: Buffer;
  try {
    const result = await acme.crypto.createCsr(
      {
        commonName: params.rootDomain,
        altNames,
        country: 'RU',
        organization: 'MTProto Panel',
      },
      undefined
    );
    [privateKey, csr] = result;
  } catch (err: any) {
    return { success: false, error: `CSR generation failed: ${err.message}` };
  }

  // 3. Получаем zone в Cloudflare.
  let zoneId: string;
  try {
    const zone = await getZone(params.cloudflare, params.rootDomain);
    zoneId = zone.id;
  } catch (err: any) {
    return { success: false, error: `Cloudflare zone lookup failed: ${err.message}` };
  }

  // 4. Создаём order (без CSR — он передаётся в finalizeOrder).
  let order;
  try {
    order = await client.createOrder({
      identifiers: [
        { type: 'dns', value: params.wildcardDomain },
      ],
    });
  } catch (err: any) {
    return { success: false, error: `ACME order creation failed: ${err.message}` };
  }

  // 5. Authorizations.
  const authorizations = await client.getAuthorizations(order);
  const createdRecords: Array<{ recordId: string; zoneId: string }> = [];

  for (const authz of authorizations) {
    const dnsChallenge = authz.challenges.find((c) => c.type === 'dns-01');
    if (!dnsChallenge) {
      await cleanupRecords(params.cloudflare, createdRecords);
      return {
        success: false,
        error: 'DNS-01 challenge not offered by ACME server for wildcard',
      };
    }

    // Вычисляем keyAuthorization для DNS-01 challenge.
    const keyAuthorization = await client.getChallengeKeyAuthorization(dnsChallenge);

    // TXT запись на _acme-challenge.<rootDomain>.
    const txtName = `_acme-challenge.${params.rootDomain}`;

    let recordId: string;
    try {
      recordId = await createTxtRecord(params.cloudflare, zoneId, txtName, keyAuthorization);
      createdRecords.push({ recordId, zoneId });
    } catch (err: any) {
      await cleanupRecords(params.cloudflare, createdRecords);
      return { success: false, error: `TXT record creation failed: ${err.message}` };
    }

    // Сообщаем ACME серверу, что challenge готов к проверке.
    try {
      await client.completeChallenge(dnsChallenge);
    } catch (err: any) {
      await cleanupRecords(params.cloudflare, createdRecords);
      return { success: false, error: `Challenge completion failed: ${err.message}` };
    }

    // Ждём valid status (challenge становится valid после прохождения DNS-01).
    try {
      await client.waitForValidStatus(dnsChallenge);
    } catch (err: any) {
      await cleanupRecords(params.cloudflare, createdRecords);
      return { success: false, error: `Challenge validation timeout: ${err.message}` };
    }
  }

  // 6. Finalize order с CSR.
  let finalizedOrder;
  try {
    finalizedOrder = await client.finalizeOrder(order, csr);
  } catch (err: any) {
    await cleanupRecords(params.cloudflare, createdRecords);
    return { success: false, error: `Order finalization failed: ${err.message}` };
  }

  // 7. Получаем сертификат.
  const cert = finalizedOrder.certificate;
  if (!cert) {
    await cleanupRecords(params.cloudflare, createdRecords);
    return { success: false, error: 'Certificate not returned by ACME server' };
  }

  // 8. Сохраняем на диск.
  await fs.writeFile(certPath, cert, { mode: 0o644 });
  await fs.writeFile(keyPath, privateKey, { mode: 0o600 });

  // 9. Удаляем TXT записи.
  await cleanupRecords(params.cloudflare, createdRecords);

  // Парсим сертификат.
  const certInfo = parseCertificateInfo(cert);

  logger.info('acme', `Wildcard certificate obtained for ${params.wildcardDomain}`);

  return {
    success: true,
    certificatePath: certPath,
    privateKeyPath: keyPath,
    certInfo,
  };
}

/**
 * Удаляет TXT записи из Cloudflare (cleanup при ошибках и после успеха).
 */
async function cleanupRecords(
  credentials: CloudflareCredentials,
  records: Array<{ recordId: string; zoneId: string }>
): Promise<void> {
  await Promise.all(
    records.map((r) => deleteTxtRecord(credentials, r.zoneId, r.recordId).catch(() => undefined))
  );
}

/**
 * Парсит PEM сертификат (через node-forge) и возвращает основные поля.
 */
function parseCertificateInfo(pem: string): WildcardCertificateResult['certInfo'] {
  try {
    const cert = forge.pki.certificateFromPem(pem);
    const issuerAttrs = cert.issuer.attributes.map((a) => `${a.shortName ?? a.name}=${a.value}`);
    return {
      domain:
        cert.subject.attributes.find((a) => a.name === 'commonName')?.value?.toString() ||
        'unknown',
      issuer: issuerAttrs.join(', '),
      validFrom: cert.validity.notBefore.toISOString(),
      validTo: cert.validity.notAfter.toISOString(),
      serialNumber: cert.serialNumber,
    };
  } catch (err: any) {
    logger.warn('acme', `Failed to parse certificate: ${err.message}`);
    return undefined;
  }
}

/**
 * Проверяет, истекает ли сертификат в ближайшие N дней.
 */
export async function isCertificateExpiringSoon(
  certPath: string,
  daysThreshold = 30
): Promise<boolean> {
  try {
    const pem = await fs.readFile(certPath, 'utf-8');
    const info = acme.crypto.readCertificateInfo(pem);
    const now = new Date();
    const daysLeft = Math.floor((info.notAfter.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    return daysLeft < daysThreshold;
  } catch {
    return true;
  }
}
