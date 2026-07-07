import express from 'express';
import cors from 'cors';
import { config, validateConfig } from './config';
import { FAKE_TLS_DOMAINS } from '../../shared/types/constants';
import { authMiddleware } from './middleware/auth';
import proxyRoutes from './routes/proxy';
import healthRoutes from './routes/health';
import * as docker from './services/docker';
import * as nginx from './services/nginx';
import * as xray from './services/xray';
import * as proxyService from './services/proxy';
import * as store from './store';
import { logger } from '../../shared/utils/logger';
import { execFile } from 'child_process';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Без авторизации: только health check (для liveness/readiness probes).
app.use('/api/health', healthRoutes);

// Под авторизацией: всё остальное.
app.use('/api/proxies', authMiddleware, proxyRoutes);

// Запуск self-update на ноде (через UI панели).
app.post('/api/update', authMiddleware, (_req, res) => {
  const scriptPath = '/app/project/update.sh';
  execFile(
    '/bin/bash',
    [scriptPath],
    { cwd: '/app/project', timeout: 120000 },
    (error, stdout, stderr) => {
      if (error) {
        res.status(500).json({
          success: false,
          error: error.message,
          output: stderr || stdout,
        });
        return;
      }
      res.json({ success: true, output: stdout });
    }
  );
});

// Custom domains для fake TLS.
app.get('/api/domains', authMiddleware, async (_req, res) => {
  const custom = await store.getCustomDomains();
  res.json({ domains: custom.length > 0 ? custom : FAKE_TLS_DOMAINS });
});

app.put('/api/domains', authMiddleware, async (req, res) => {
  const { domains } = req.body;
  if (!Array.isArray(domains) || !domains.every((d: unknown) => typeof d === 'string')) {
    res.status(400).json({ error: 'domains must be an array of strings' });
    return;
  }
  await store.setCustomDomains(domains);
  res.json({ domains: await store.getCustomDomains() });
});

// IP blacklist.
app.get('/api/blacklist', authMiddleware, async (_req, res) => {
  res.json({ ips: await store.getBlacklistedIps() });
});

app.put('/api/blacklist', authMiddleware, async (req, res) => {
  const { ips } = req.body;
  if (!Array.isArray(ips) || !ips.every((ip: unknown) => typeof ip === 'string')) {
    res.status(400).json({ error: 'ips must be an array of strings' });
    return;
  }
  await store.setBlacklistedIps(ips);
  try {
    await nginx.updateNginxConfig(await store.getAllProxies());
  } catch (err) {
    logger.warn('main', 'nginx reload after blacklist update failed', {
      error: String(err),
    });
  }
  res.json({ ips: await store.getBlacklistedIps() });
});

// Export/import прокси-конфигурации.
app.get('/api/export', authMiddleware, async (_req, res) => {
  const bundle = await proxyService.exportProxies();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="proxies-export-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.json(bundle);
});

app.post(
  '/api/import',
  authMiddleware,
  express.json({ limit: '10mb' }),
  async (req, res) => {
    const bundle = req.body;
    if (!bundle || bundle.version !== 1 || !Array.isArray(bundle.proxies)) {
      res.status(400).json({ error: 'Invalid export bundle format' });
      return;
    }
    try {
      const result = await proxyService.importProxies(bundle);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ============ Bootstrap ============

async function bootstrap(): Promise<void> {
  try {
    // Валидируем конфиг ДО любых side-effects.
    validateConfig();

    logger.info('main', 'Warming up caches');
    await store.warmupCaches();

    logger.info('main', 'Initializing Docker network');
    await docker.ensureNetwork();

    // HTTP-сервер стартует ДО тяжёлой инициализации — health check отвечает сразу.
    const server = app.listen(config.port, '0.0.0.0', () => {
      logger.info('main', `Service node running on port ${config.port}`);
    });

    // Graceful shutdown.
    const shutdown = async (signal: string) => {
      logger.info('main', `Received ${signal}, shutting down gracefully`);
      server.close();
      await store.flushIpHistory();
      process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Тяжёлая фоновая инициализация — не блокирует HTTP.
    (async () => {
      try {
        logger.info('main', 'Reconnecting containers to network');
        await docker.reconnectContainersToNetwork();

        logger.info('main', 'Building telemt proxy image');
        await docker.ensureProxyImage();

        // xray должен подняться ДО telemt, иначе после reboot proxychains не подключится.
        const xrayNames = (await store.getAllProxies())
          .map((p) => p.vpnContainerName)
          .filter((n): n is string => !!n);
        if (xrayNames.length > 0) {
          logger.info('main', `Ensuring ${xrayNames.length} xray container(s) running`);
          await xray.ensureXrayContainersRunning(xrayNames);
        }

        logger.info('main', 'Initializing nginx container');
        await nginx.ensureNginxContainer();

        const proxies = await store.getAllProxies();
        if (proxies.length > 0) {
          logger.info('main', `Restoring nginx config for ${proxies.length} proxies`);
          await nginx.updateNginxConfig(proxies);
        }

        // Фоновый сборщик статистики.
        setInterval(() => {
          proxyService.collectAllProxyStats().catch((err) => {
            logger.error('main', 'Background stats collection error', { error: String(err) });
          });
        }, config.statsIntervalMs);

        setTimeout(() => {
          proxyService.collectAllProxyStats().catch(() => {
            // ignore
          });
        }, config.initialStatsDelayMs);

        // Real-time IP recording из nginx access-логов.
        nginx.startNginxLogWatcher();

        logger.info('main', 'Background initialization complete');
      } catch (err) {
        logger.error('main', 'Background initialization error', { error: String(err) });
      }
    })();
  } catch (error) {
    logger.error('main', 'Failed to start service node', { error: String(error) });
    process.exit(1);
  }
}

bootstrap();
