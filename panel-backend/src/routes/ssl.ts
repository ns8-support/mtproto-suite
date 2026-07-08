import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import {
  testCloudflareCredentials,
  getZone,
  CloudflareCredentials,
} from '../services/ssl/cloudflare';
import {
  obtainWildcardCertificate,
  isCertificateExpiringSoon,
  WildcardCertificateParams,
} from '../services/ssl/acme';
import { logger } from '../../../shared/utils/logger';
import { sanitizeErrorMessage } from '../utils/error-sanitizer';
import { isValidDomain, sanitizeString } from '../utils/validation';

const router = Router();
router.use(authMiddleware);

/**
 * Директория для wildcard сертификатов.
 * По умолчанию: /opt/mtproto-suite/ssl/wildcard.
 * Может быть переопределена через env SSL_OUTPUT_DIR.
 */
const SSL_OUTPUT_DIR = process.env.SSL_OUTPUT_DIR || path.join('/opt/mtproto-suite', 'ssl', 'wildcard');

/**
 * POST /api/ssl/cloudflare/test
 *
 * Тестирует Cloudflare API Token: возвращает количество зон в аккаунте.
 */
router.post('/cloudflare/test', async (req: AuthRequest, res: Response) => {
  const apiToken = sanitizeString(req.body?.apiToken);
  if (!apiToken || apiToken.length < 20) {
    res.status(400).json({ error: 'Invalid apiToken' });
    return;
  }

  const credentials: CloudflareCredentials = { apiToken };
  const result = await testCloudflareCredentials(credentials);
  logger.info('ssl', `Cloudflare credentials test`, { success: result.success });
  res.json(result);
});

/**
 * POST /api/ssl/wildcard/obtain
 *
 * Получает wildcard Let's Encrypt сертификат через Cloudflare DNS-01 challenge.
 *
 * Body:
 *   - wildcardDomain: "*.example.com"
 *   - rootDomain: "example.com"
 *   - cloudflare: { apiToken }
 *   - email: "admin@example.com"
 *   - staging?: boolean (default false)
 *
 * Response:
 *   - success: boolean
 *   - certificatePath?: string
 *   - privateKeyPath?: string
 *   - certInfo?: { domain, issuer, validFrom, validTo, serialNumber }
 *   - error?: string
 */
router.post('/wildcard/obtain', async (req: AuthRequest, res: Response) => {
  const wildcardDomain = sanitizeString(req.body?.wildcardDomain).toLowerCase();
  const rootDomain = sanitizeString(req.body?.rootDomain).toLowerCase();
  const email = sanitizeString(req.body?.email);
  const staging = req.body?.staging === true;
  const apiToken = sanitizeString(req.body?.cloudflare?.apiToken);

  // Валидация.
  if (!wildcardDomain.startsWith('*.')) {
    res.status(400).json({ error: 'wildcardDomain must start with "*." (e.g. *.example.com)' });
    return;
  }
  const wildcardBase = wildcardDomain.slice(2);
  if (!isValidDomain(wildcardBase)) {
    res.status(400).json({ error: 'Invalid wildcardDomain' });
    return;
  }
  if (!isValidDomain(rootDomain)) {
    res.status(400).json({ error: 'Invalid rootDomain' });
    return;
  }
  if (wildcardBase !== rootDomain) {
    res.status(400).json({ error: 'wildcardDomain base must equal rootDomain' });
    return;
  }
  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'Valid email is required for ACME account' });
    return;
  }
  if (!apiToken || apiToken.length < 20) {
    res.status(400).json({ error: 'Valid Cloudflare apiToken is required' });
    return;
  }

  const params: WildcardCertificateParams = {
    wildcardDomain,
    rootDomain,
    cloudflare: { apiToken },
    email,
    staging,
    outputDir: SSL_OUTPUT_DIR,
    fileName: wildcardBase.replace(/\./g, '_'),
  };

  logger.info('ssl', `Obtaining wildcard certificate for ${wildcardDomain}`);

  try {
    const result = await obtainWildcardCertificate(params);

    if (result.success) {
      logger.info('ssl', `Wildcard certificate obtained`, {
        domain: wildcardDomain,
        path: result.certificatePath,
        validTo: result.certInfo?.validTo,
      });
    } else {
      logger.warn('ssl', `Failed to obtain wildcard certificate`, { error: result.error });
    }

    res.json(result);
  } catch (err: any) {
    logger.error('ssl', `Wildcard certificate error`, { error: err.message });
    res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(err),
    });
  }
});

/**
 * GET /api/ssl/wildcard/status
 *
 * Возвращает статус текущего wildcard сертификата (если есть).
 */
router.get('/wildcard/status', async (_req: AuthRequest, res: Response) => {
  try {
    await fs.mkdir(SSL_OUTPUT_DIR, { recursive: true });
    const files = await fs.readdir(SSL_OUTPUT_DIR);
    const certFiles = files.filter((f) => f.endsWith('.cert.pem'));

    const certificates = [];
    for (const certFile of certFiles) {
      const certPath = path.join(SSL_OUTPUT_DIR, certFile);
      const expiringSoon = await isCertificateExpiringSoon(certPath, 30);
      const keyPath = certPath.replace(/\.cert\.pem$/, '.key.pem');
      const hasKey = await fs
        .access(keyPath)
        .then(() => true)
        .catch(() => false);

      certificates.push({
        name: certFile.replace(/\.cert\.pem$/, ''),
        certificatePath: certPath,
        privateKeyPath: hasKey ? keyPath : null,
        expiringSoon,
        lastChecked: new Date().toISOString(),
      });
    }

    res.json({
      outputDir: SSL_OUTPUT_DIR,
      certificates,
    });
  } catch (err: any) {
    logger.error('ssl', `Failed to check certificate status`, { error: err.message });
    res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

/**
 * POST /api/ssl/wildcard/renew
 *
 * Принудительное обновление wildcard сертификата.
 * Используется cron-ом или вручную из UI.
 */
router.post('/wildcard/renew', async (req: AuthRequest, res: Response) => {
  const wildcardDomain = sanitizeString(req.body?.wildcardDomain).toLowerCase();
  const rootDomain = sanitizeString(req.body?.rootDomain).toLowerCase();
  const email = sanitizeString(req.body?.email);
  const apiToken = sanitizeString(req.body?.cloudflare?.apiToken);

  if (!wildcardDomain.startsWith('*.') || !isValidDomain(rootDomain) || !email || !apiToken) {
    res.status(400).json({ error: 'Missing required parameters' });
    return;
  }

  // Переиспользуем obtain — он перезапишет сертификат.
  const params: WildcardCertificateParams = {
    wildcardDomain,
    rootDomain,
    cloudflare: { apiToken },
    email,
    outputDir: SSL_OUTPUT_DIR,
    fileName: rootDomain.replace(/\./g, '_'),
  };

  const result = await obtainWildcardCertificate(params);
  res.json(result);
});

/**
 * GET /api/ssl/zones
 *
 * Возвращает список Cloudflare zones для указанного API Token.
 * Полезно для UI — показать пользователю, какие домены доступны.
 */
router.get('/zones', async (req: AuthRequest, res: Response) => {
  const apiToken = sanitizeString(req.query.apiToken as string);

  if (!apiToken) {
    res.status(400).json({ error: 'apiToken query parameter is required' });
    return;
  }

  try {
    const credentials: CloudflareCredentials = { apiToken };
    // Используем низкоуровневый API для получения списка зон.
    const resp = await fetch('https://api.cloudflare.com/client/v4/zones?per_page=50', {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const data: any = await resp.json();
    if (!data.success) {
      res.status(400).json({ error: data.errors?.[0]?.message || 'Cloudflare API error' });
      return;
    }
    res.json({
      zones: (data.result as any[]).map((z) => ({ id: z.id, name: z.name })),
    });
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

export default router;
