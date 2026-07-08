import { Router, Response } from 'express';
import { pool } from '../db';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { logger } from '../../../shared/utils/logger';
import { sanitizeErrorMessage } from '../utils/error-sanitizer';
import { isValidIPv4, sanitizeString } from '../utils/validation';
import {
  getCpuMetrics,
  getMemoryMetrics,
  getDiskMetrics,
  getSystemInfo,
  getDockerStats,
  getNodeMetrics,
  listDockerContainers,
  restartServiceNode,
  rebootServer,
  collectMetricsPoint,
} from '../services/ssh/metrics';
import {
  getNetBirdStatus,
  installNetBird,
  uninstallNetBird,
} from '../services/netbird';
import { executeRemoteCommand, SshCredentials } from '../services/ssh/remote-install';

/**
 * Endpoints для мониторинга нод.
 *
 * Все endpoints принимают SSH credentials в теле запроса для подключения к ноде.
 *
 * Почему SSH credentials в каждом запросе, а не хранятся в БД:
 * - Безопасность: credentials не сохраняются на стороне панели.
 * - Актуальность: пользователь может обновить пароль SSH — старый в БД будет невалиден.
 * - Гибкость: пользователь выбирает способ авторизации per-request.
 *
 * Для production: можно хранить SSH credentials в БД в зашифрованном виде
 * (AES-256-GCM с ключом из JWT_SECRET) — реализация готова в cloudflare_credentials.
 */

const router = Router();
router.use(authMiddleware);

/**
 * Парсит и валидирует SSH credentials из тела запроса.
 */
function parseSshCredentials(body: any): SshCredentials | { error: string } {
  const ssh = body?.ssh;
  if (!ssh) return { error: 'ssh credentials are required' };

  const host = sanitizeString(ssh.host);
  const port = ssh.port || 22;
  const username = sanitizeString(ssh.username);
  const password = typeof ssh.password === 'string' ? ssh.password : undefined;
  const privateKey = typeof ssh.privateKey === 'string' ? ssh.privateKey : undefined;
  const passphrase = typeof ssh.passphrase === 'string' ? ssh.passphrase : undefined;

  if (!host || (!isValidIPv4(host) && !host.includes('.'))) {
    return { error: 'Invalid ssh.host' };
  }
  if (!username) return { error: 'ssh.username is required' };
  if (!password && !privateKey) return { error: 'Either password or privateKey required' };

  return { host, port, username, password, privateKey, passphrase };
}

/**
 * Записывает точку метрик в историю.
 * Хранится последние ~1000 точек на ноду (≈3.5 дня при 5-мин интервале).
 */
async function saveMetricsHistory(nodeId: number, point: {
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  runningContainers: number;
  loadAvg1?: number;
  loadAvg5?: number;
}): Promise<void> {
  await pool.query(
    `INSERT INTO node_metrics_history
       (node_id, cpu_percent, memory_percent, disk_percent, running_containers, load_avg_1, load_avg_5)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      nodeId,
      point.cpuPercent,
      point.memoryPercent,
      point.diskPercent,
      point.runningContainers,
      point.loadAvg1 ?? null,
      point.loadAvg5 ?? null,
    ]
  );

  // Trim: оставляем последние 1000 точек на ноду.
  await pool.query(
    `DELETE FROM node_metrics_history
     WHERE node_id = $1
       AND id NOT IN (
         SELECT id FROM node_metrics_history
         WHERE node_id = $1
         ORDER BY timestamp DESC
         LIMIT 1000
       )`,
    [nodeId]
  );
}

/**
 * GET /api/nodes/:id/metrics
 *
 * Собирает все метрики ноды (CPU, RAM, Disk, Docker) и сохраняет в историю.
 *
 * Body: { ssh: SshCredentials }
 *
 * Query: ?history=1h|6h|24h|7d — возвращает историю метрик (опционально).
 */
router.post('/:id/metrics', async (req: AuthRequest, res: Response) => {
  const nodeId = parseInt(req.params.id, 10);
  if (!nodeId) {
    res.status(400).json({ error: 'Invalid node id' });
    return;
  }

  const ssh = parseSshCredentials(req.body);
  if ('error' in ssh) {
    res.status(400).json({ error: ssh.error });
    return;
  }

  try {
    const metrics = await getNodeMetrics(ssh, nodeId);

    // Сохраняем точку в историю (для графиков).
    const mainDisk = metrics.disks.find((d) => d.mountPoint === '/') || metrics.disks[0];
    const runningContainers = metrics.containers.filter((c) => c.status.includes('Up')).length;

    await saveMetricsHistory(nodeId, {
      cpuPercent: metrics.cpu.usagePercent,
      memoryPercent: metrics.memory.usagePercent,
      diskPercent: mainDisk?.usagePercent || 0,
      runningContainers,
      loadAvg1: metrics.cpu.loadAvg1,
      loadAvg5: metrics.cpu.loadAvg5,
    }).catch((err) => {
      logger.warn('monitoring', `Failed to save metrics history for node ${nodeId}`, {
        error: err.message,
      });
    });

    // Опционально возвращаем историю.
    let history: Array<{
      timestamp: string;
      cpuPercent: number;
      memoryPercent: number;
      diskPercent: number;
      runningContainers: number;
    }> | undefined;

    const range = (req.query.history as string) || '1h';
    const rangeMap: Record<string, string> = {
      '1h': '1 hour',
      '6h': '6 hours',
      '24h': '24 hours',
      '7d': '7 days',
    };
    const interval = rangeMap[range];
    if (interval) {
      const historyResult = await pool.query(
        `SELECT timestamp, cpu_percent, memory_percent, disk_percent, running_containers
         FROM node_metrics_history
         WHERE node_id = $1 AND timestamp > NOW() - $2::interval
         ORDER BY timestamp ASC`,
        [nodeId, interval]
      );
      history = historyResult.rows.map((row) => ({
        timestamp: row.timestamp.toISOString(),
        cpuPercent: parseFloat(row.cpu_percent),
        memoryPercent: parseFloat(row.memory_percent),
        diskPercent: parseFloat(row.disk_percent),
        runningContainers: row.running_containers,
      }));
    }

    res.json({
      ...metrics,
      history: history || [],
    });
  } catch (err: any) {
    logger.error('monitoring', `Failed to collect metrics for node ${nodeId}`, {
      error: err.message,
      code: err.code,
    });
    res.status(500).json({
      error: sanitizeErrorMessage(err),
    });
  }
});

/**
 * GET /api/nodes/:id/metrics/history
 *
 * Возвращает только историю метрик (без SSH запроса — данные из БД).
 */
router.get('/:id/metrics/history', async (req: AuthRequest, res: Response) => {
  const nodeId = parseInt(req.params.id, 10);
  const range = (req.query.range as string) || '1h';
  const rangeMap: Record<string, string> = {
    '1h': '1 hour',
    '6h': '6 hours',
    '24h': '24 hours',
    '7d': '7 days',
  };
  const interval = rangeMap[range] || '1 hour';

  try {
    const result = await pool.query(
      `SELECT timestamp, cpu_percent, memory_percent, disk_percent, running_containers, load_avg_1, load_avg_5
       FROM node_metrics_history
       WHERE node_id = $1 AND timestamp > NOW() - $2::interval
       ORDER BY timestamp ASC`,
      [nodeId, interval]
    );
    res.json(
      result.rows.map((row) => ({
        timestamp: row.timestamp.toISOString(),
        cpuPercent: parseFloat(row.cpu_percent),
        memoryPercent: parseFloat(row.memory_percent),
        diskPercent: parseFloat(row.disk_percent),
        runningContainers: row.running_containers,
        loadAvg1: row.load_avg_1 ? parseFloat(row.load_avg_1) : null,
        loadAvg5: row.load_avg_5 ? parseFloat(row.load_avg_5) : null,
      }))
    );
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

/**
 * POST /api/nodes/:id/system-info
 *
 * Возвращает информацию о системе (OS, kernel, hostname, IP, uptime).
 */
router.post('/:id/system-info', async (req: AuthRequest, res: Response) => {
  const ssh = parseSshCredentials(req.body);
  if ('error' in ssh) {
    res.status(400).json({ error: ssh.error });
    return;
  }

  try {
    const info = await getSystemInfo(ssh);
    res.json(info);
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

/**
 * POST /api/nodes/:id/docker-stats
 *
 * Возвращает расширенную статистику Docker контейнеров.
 */
router.post('/:id/docker-stats', async (req: AuthRequest, res: Response) => {
  const ssh = parseSshCredentials(req.body);
  if ('error' in ssh) {
    res.status(400).json({ error: ssh.error });
    return;
  }

  try {
    const [stats, containers] = await Promise.all([
      getDockerStats(ssh),
      listDockerContainers(ssh).catch(() => []),
    ]);
    res.json({ stats, containers });
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

/**
 * POST /api/nodes/:id/restart-service
 *
 * Перезапускает service-node через docker compose restart.
 */
router.post('/:id/restart-service', async (req: AuthRequest, res: Response) => {
  const nodeId = parseInt(req.params.id, 10);
  const ssh = parseSshCredentials(req.body);
  if ('error' in ssh) {
    res.status(400).json({ error: ssh.error });
    return;
  }

  const installDir = sanitizeString(req.body?.installDir) || '/opt/mtproto-suite';

  try {
    const result = await restartServiceNode(ssh, installDir);
    logger.info('monitoring', `Restart service-node on node ${nodeId}`, {
      success: result.success,
    });
    res.json(result);
  } catch (err: any) {
    logger.error('monitoring', `Failed to restart service on node ${nodeId}`, {
      error: err.message,
    });
    res.status(500).json({ success: false, log: '', error: sanitizeErrorMessage(err) });
  }
});

/**
 * POST /api/nodes/:id/reboot
 *
 * Перезагружает удалённый сервер через sudo reboot.
 *
 * Требует явного подтверждения: body.confirm === true.
 * В UI должно быть предупреждение о деструктивности операции.
 */
router.post('/:id/reboot', async (req: AuthRequest, res: Response) => {
  const nodeId = parseInt(req.params.id, 10);
  if (req.body?.confirm !== true) {
    res.status(400).json({
      error: 'Reboot requires explicit confirmation. Set confirm: true in body.',
    });
    return;
  }

  const ssh = parseSshCredentials(req.body);
  if ('error' in ssh) {
    res.status(400).json({ error: ssh.error });
    return;
  }

  try {
    const result = await rebootServer(ssh);
    logger.warn('monitoring', `Reboot initiated for node ${nodeId}`, {
      success: result.success,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, log: '', error: sanitizeErrorMessage(err) });
  }
});

/**
 * POST /api/nodes/:id/netbird/status
 *
 * Возвращает статус NetBird на удалённой ноде.
 */
router.post('/:id/netbird/status', async (req: AuthRequest, res: Response) => {
  const ssh = parseSshCredentials(req.body);
  if ('error' in ssh) {
    res.status(400).json({ error: ssh.error });
    return;
  }

  try {
    const status = await getNetBirdStatus(ssh);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

/**
 * POST /api/nodes/:id/netbird/install
 *
 * Устанавливает NetBird на удалённой ноде и подключает к management server.
 *
 * Body:
 *   - ssh: SshCredentials
 *   - setupKey: string (одноразовый ключ из NetBird dashboard)
 *   - managementUrl?: string (для self-hosted)
 *   - hostname?: string
 */
router.post('/:id/netbird/install', async (req: AuthRequest, res: Response) => {
  const nodeId = parseInt(req.params.id, 10);
  const ssh = parseSshCredentials(req.body);
  if ('error' in ssh) {
    res.status(400).json({ error: ssh.error });
    return;
  }

  const setupKey = sanitizeString(req.body?.setupKey);
  if (!setupKey || setupKey.length < 10) {
    res.status(400).json({ error: 'Valid setupKey is required' });
    return;
  }

  try {
    const result = await installNetBird(ssh, {
      setupKey,
      managementUrl: req.body?.managementUrl ? sanitizeString(req.body.managementUrl) : undefined,
      hostname: req.body?.hostname ? sanitizeString(req.body.hostname) : undefined,
    });

    if (result.success && result.status) {
      // Сохраняем статус в БД.
      await pool.query(
        `INSERT INTO netbird_status (node_id, installed, connected, mesh_ip, peer_name, management_url, version, peers_json, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
         ON CONFLICT (node_id) DO UPDATE SET
           installed = EXCLUDED.installed,
           connected = EXCLUDED.connected,
           mesh_ip = EXCLUDED.mesh_ip,
           peer_name = EXCLUDED.peer_name,
           management_url = EXCLUDED.management_url,
           version = EXCLUDED.version,
           peers_json = EXCLUDED.peers_json,
           updated_at = CURRENT_TIMESTAMP`,
        [
          nodeId,
          result.status.installed,
          result.status.connected,
          result.status.meshIp,
          result.status.peerName,
          result.status.managementUrl,
          result.status.version,
          JSON.stringify(result.status.peers),
        ]
      );
    }

    logger.info('netbird', `Install on node ${nodeId}`, { success: result.success });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, log: '', error: sanitizeErrorMessage(err) });
  }
});

/**
 * POST /api/nodes/:id/netbird/uninstall
 *
 * Удаляет NetBird с удалённой ноды.
 */
router.post('/:id/netbird/uninstall', async (req: AuthRequest, res: Response) => {
  const nodeId = parseInt(req.params.id, 10);
  const ssh = parseSshCredentials(req.body);
  if ('error' in ssh) {
    res.status(400).json({ error: ssh.error });
    return;
  }

  try {
    const result = await uninstallNetBird(ssh);
    if (result.success) {
      await pool.query(`DELETE FROM netbird_status WHERE node_id = $1`, [nodeId]);
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, log: '', error: sanitizeErrorMessage(err) });
  }
});

/**
 * GET /api/nodes/:id/netbird/cached-status
 *
 * Возвращает последний сохранённый статус NetBird из БД (без SSH запроса).
 */
router.get('/:id/netbird/cached-status', async (req: AuthRequest, res: Response) => {
  const nodeId = parseInt(req.params.id, 10);
  try {
    const result = await pool.query(
      `SELECT installed, connected, mesh_ip, peer_name, management_url, version, peers_json, updated_at
       FROM netbird_status WHERE node_id = $1`,
      [nodeId]
    );
    if (result.rows.length === 0) {
      res.json(null);
      return;
    }
    const row = result.rows[0];
    res.json({
      installed: row.installed,
      connected: row.connected,
      meshIp: row.mesh_ip,
      peerName: row.peer_name,
      managementUrl: row.management_url,
      version: row.version,
      peers: typeof row.peers_json === 'string' ? JSON.parse(row.peers_json) : row.peers_json || [],
      updatedAt: row.updated_at?.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: sanitizeErrorMessage(err) });
  }
});

export default router;
