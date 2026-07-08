import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from './config';
import { runMigrations, createAdminUser } from './db/migrations';
import { authMiddleware } from './middleware/auth';
import authRoutes from './routes/auth';
import nodeRoutes from './routes/nodes';
import proxyRoutes from './routes/proxies';
import allProxiesRoutes from './routes/allProxies';
import remoteInstallRoutes from './routes/remote-install';
import sslRoutes from './routes/ssl';
import monitoringRoutes from './routes/nodes-monitoring';
import { logger } from '../../shared/utils/logger';

const app = express();

// ============ Security Headers ============

// HSTS — принуждать браузеры использовать HTTPS в течение 1 года.
// Должно быть включено только если панель доступна по HTTPS.
app.use((req, res, next) => {
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
  }
  next();
});

// Дополнительные security headers (защита от XSS, clickjacking и т.д.)
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ============ CORS ============

// CORS whitelist — только доверенные origins могут делать запросы.
// По умолчанию разрешает localhost (для разработки) и Panel frontend URL.
// В production задайте PANEL_FRONTEND_URL=https://panel.example.com
const ALLOWED_ORIGINS = (process.env.PANEL_FRONTEND_URL || 'http://localhost:5173,http://localhost:80')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Разрешаем запросы без origin (curl, server-to-server)
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
        return callback(null, true);
      }
      logger.warn('cors', `Blocked CORS request from origin: ${origin}`);
      return callback(new Error('CORS: origin not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400, // 24h
  })
);

app.use(express.json({ limit: '1mb' }));

// ============ Rate Limiting ============

// Глобальный лимит — защита от DoS
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 200,             // 200 req/min на IP (нормальный usage)
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Строгий лимит для SSH/credentials endpoints — защита от брутфорса
const sshLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 минут
  max: 10,                  // 10 запросов на IP за 5 минут
  message: { error: 'Too many SSH requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Сбрасывать счётчик после успешного запроса не нужно —
  // ограничение защищает от атаки, а не от легитимного использования.
});

// Лимит для login — anti-brute-force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 10,                  // 10 попыток login за 15 минут
  message: { error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

// ============ Routes ============

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/nodes', nodeRoutes);
app.use('/api/nodes', proxyRoutes);
app.use('/api/proxies', allProxiesRoutes);

// SSH-related endpoints — строгий rate limit
app.use('/api/remote-install', sshLimiter);
app.use('/api/remote-install', remoteInstallRoutes);

// Monitoring endpoints используют SSH — тоже строгий лимит
app.use('/api/nodes/:id/metrics', sshLimiter);
app.use('/api/nodes/:id/system-info', sshLimiter);
app.use('/api/nodes/:id/docker-stats', sshLimiter);
app.use('/api/nodes/:id/restart-service', sshLimiter);
app.use('/api/nodes/:id/reboot', sshLimiter);
app.use('/api/nodes/:id/netbird', sshLimiter);

app.use('/api/ssl', sslRoutes);
app.use('/api/nodes', monitoringRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/system/version', authMiddleware, (_req, res) => {
  let version = 'unknown';
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    version = pkg.version || 'unknown';
  } catch {
    // ignore
  }
  res.json({ version });
});

// Trigger panel self-update (fire and forget)
app.post('/api/system/update', authMiddleware, (_req, res) => {
  const scriptPath = '/app/project/update.sh';
  execFile(
    '/bin/bash',
    [scriptPath],
    { cwd: '/app/project', timeout: 300000 },
    () => {
      // Nothing to do — UI опрашивает состояние через health check.
    }
  );
  res.json({
    success: true,
    message: 'Обновление запущено. Панель перезапустится через несколько минут.',
  });
});

// Глобальный обработчик ошибок (последний middleware).
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Маппинг известных ошибок в безопасные сообщения для клиента.
  const safeMessage = sanitizeErrorMessage(err);

  // Полная ошибка логируется только на сервере.
  logger.error('express', 'Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: safeMessage });
});

/**
 * Маппинг ошибок в безопасные сообщения для клиента.
 * Полная информация остаётся только в логах сервера.
 */
function sanitizeErrorMessage(err: any): string {
  const msg = err.message || 'Internal server error';

  // Известные безопасные сообщения — пропускаем как есть.
  const safePatterns = [
    /^Invalid credentials/i,
    /^Username and password/i,
    /^Invalid node id/i,
    /^Invalid host/i,
    /^Invalid ssh/i,
    /^Either password/i,
    /^Either ssh/i,
    /^Invalid ip/i,
    /^Invalid port/i,
    /^Invalid token/i,
    /^Too many requests/i,
    /^Too many login/i,
    /^Too many SSH/i,
    /^Forbidden/i,
    /^Unauthorized/i,
    /^Not found/i,
    /^CORS: origin/i,
    /^Internal server error/i,
  ];
  if (safePatterns.some((re) => re.test(msg))) {
    return msg;
  }

  // SSH-ошибки — не показываем internal details клиенту.
  if (/ssh|connect ECONNREFUSED|ETIMEDOUT|ENOTFOUND|authentication/i.test(msg)) {
    return 'SSH connection failed';
  }

  // Docker-ошибки — не показываем пути и internal details.
  if (/docker|container/i.test(msg)) {
    return 'Container operation failed';
  }

  // PostgreSQL-ошибки — sanitized
  if (/postgres|pg|sql|duplicate key|foreign key/i.test(msg)) {
    return 'Database operation failed';
  }

  // Все остальное — generic.
  return 'Internal server error';
}

async function bootstrap(): Promise<void> {
  try {
    await runMigrations();

    const adminUser = process.env.ADMIN_USERNAME;
    const adminPass = process.env.ADMIN_PASSWORD;
    if (adminUser && adminPass) {
      await createAdminUser(adminUser, adminPass);
    }

    const server = app.listen(config.port, '0.0.0.0', () => {
      logger.info('main', `Panel backend running on port ${config.port}`);
      logger.info('main', `CORS allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
    });

    const shutdown = (signal: string) => {
      logger.info('main', `Received ${signal}, shutting down gracefully`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('main', 'Failed to start panel backend', { error: String(error) });
    process.exit(1);
  }
}

bootstrap();
