import { Router, Response } from 'express';
import { pool } from '../db';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { proxyToNode } from '../utils/node-proxy';
import { config } from '../config';
import { logger, sanitizeErrorMessage } from '../../../shared/utils/logger';

const router = Router();
router.use(authMiddleware);

/**
 * Получить все прокси со всех нод параллельно.
 *
 * Исправление: в оригинале не было таймаутов на fetch, и если одна нода
 * мертва, запрос висел до browser timeout (60+ секунд).
 * Теперь используется proxyToNode с timeout, и Promise.allSettled вместо .all —
 * одна мертвая нода не ломает ответ от остальных.
 */
router.get('/all', async (_req: AuthRequest, res: Response) => {
  try {
    const nodesResult = await pool.query('SELECT id, name, ip, port, token FROM nodes ORDER BY id');
    const nodes = nodesResult.rows;

    const results = await Promise.allSettled(
      nodes.map(async (node) => {
        try {
          const result = await proxyToNode(node, 'GET', '', undefined, {
            timeoutMs: config.nodeRequestTimeoutMs,
          });
          const proxies = Array.isArray(result.data) ? result.data : [];
          return {
            nodeId: node.id,
            nodeName: node.name,
            nodeIp: node.ip,
            online: result.status === 200,
            proxies,
          };
        } catch (err: any) {
          logger.warn('panel.allProxies', `Node ${node.id} (${node.ip}) unreachable`, {
            error: err.message,
          });
          return {
            nodeId: node.id,
            nodeName: node.name,
            nodeIp: node.ip,
            online: false,
            proxies: [],
          };
        }
      })
    );

    interface NodeWithProxies {
      nodeId: number;
      nodeName: string;
      nodeIp: string;
      online: boolean;
      proxies: unknown[];
    }

    const data = results
      .filter((r): r is PromiseFulfilledResult<NodeWithProxies> => r.status === 'fulfilled')
      .map((r) => r.value);

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

export default router;
