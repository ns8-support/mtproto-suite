import { Router, Response } from 'express';
import { pool } from '../db';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { proxyToNode } from '../utils/node-proxy';

const router = Router();
router.use(authMiddleware);

async function getNodeWithToken(nodeId: string) {
  const result = await pool.query('SELECT ip, port, token FROM nodes WHERE id = $1', [nodeId]);
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

// List proxies on a node
router.get('/:nodeId/proxies', async (req: AuthRequest, res: Response) => {
  try {
    const node = await getNodeWithToken(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const result = await proxyToNode(node, 'GET', '');
    res.status(result.status).json(result.data);
  } catch (error: any) {
    res.status(502).json({ error: `Failed to connect to node: ${error.message}` });
  }
});

// Create proxy on a node
router.post('/:nodeId/proxies', async (req: AuthRequest, res: Response) => {
  try {
    const node = await getNodeWithToken(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const result = await proxyToNode(node, 'POST', '', req.body);
    res.status(result.status).json(result.data);
  } catch (error: any) {
    res.status(502).json({ error: `Failed to connect to node: ${error.message}` });
  }
});

// Get proxy details
router.get('/:nodeId/proxies/:proxyId', async (req: AuthRequest, res: Response) => {
  try {
    const node = await getNodeWithToken(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const result = await proxyToNode(node, 'GET', `/${req.params.proxyId}`);
    res.status(result.status).json(result.data);
  } catch (error: any) {
    res.status(502).json({ error: `Failed to connect to node: ${error.message}` });
  }
});

// Update proxy
router.put('/:nodeId/proxies/:proxyId', async (req: AuthRequest, res: Response) => {
  try {
    const node = await getNodeWithToken(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const result = await proxyToNode(node, 'PUT', `/${req.params.proxyId}`, req.body);
    res.status(result.status).json(result.data);
  } catch (error: any) {
    res.status(502).json({ error: `Failed to connect to node: ${error.message}` });
  }
});

// Delete proxy
router.delete('/:nodeId/proxies/:proxyId', async (req: AuthRequest, res: Response) => {
  try {
    const node = await getNodeWithToken(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const result = await proxyToNode(node, 'DELETE', `/${req.params.proxyId}`);
    res.status(result.status).json(result.data);
  } catch (error: any) {
    res.status(502).json({ error: `Failed to connect to node: ${error.message}` });
  }
});

// Get proxy stats
router.get('/:nodeId/proxies/:proxyId/stats', async (req: AuthRequest, res: Response) => {
  try {
    const node = await getNodeWithToken(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const result = await proxyToNode(node, 'GET', `/${req.params.proxyId}/stats`);
    res.status(result.status).json(result.data);
  } catch (error: any) {
    res.status(502).json({ error: `Failed to connect to node: ${error.message}` });
  }
});

// Get proxy link
router.get('/:nodeId/proxies/:proxyId/link', async (req: AuthRequest, res: Response) => {
  try {
    const node = await getNodeWithToken(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const result = await pool.query('SELECT domain FROM nodes WHERE id = $1', [req.params.nodeId]);
    const nodeDomain = result.rows[0]?.domain;
    const serverHost = nodeDomain || node.ip;
    const linkResult = await proxyToNode(node, 'GET', `/${req.params.proxyId}/link?server_ip=${encodeURIComponent(serverHost)}`);
    res.status(linkResult.status).json(linkResult.data);
  } catch (error: any) {
    res.status(502).json({ error: `Failed to connect to node: ${error.message}` });
  }
});

// Pause / unpause proxy
router.post('/:nodeId/proxies/:proxyId/pause', async (req: AuthRequest, res: Response) => {
  try {
    const node = await getNodeWithToken(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const result = await proxyToNode(node, 'POST', `/${req.params.proxyId}/pause`);
    res.status(result.status).json(result.data);
  } catch (error: any) {
    res.status(502).json({ error: `Failed to connect to node: ${error.message}` });
  }
});

router.post('/:nodeId/proxies/:proxyId/unpause', async (req: AuthRequest, res: Response) => {
  try {
    const node = await getNodeWithToken(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const result = await proxyToNode(node, 'POST', `/${req.params.proxyId}/unpause`);
    res.status(result.status).json(result.data);
  } catch (error: any) {
    res.status(502).json({ error: `Failed to connect to node: ${error.message}` });
  }
});

// Stats & IP history
router.get('/:nodeId/proxies/:proxyId/stats-history', async (req: AuthRequest, res: Response) => {
  try {
    const node = await getNodeWithToken(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const result = await proxyToNode(node, 'GET', `/${req.params.proxyId}/stats-history`);
    res.status(result.status).json(result.data);
  } catch (error: any) {
    res.status(502).json({ error: `Failed to connect to node: ${error.message}` });
  }
});

router.get('/:nodeId/proxies/:proxyId/ip-history', async (req: AuthRequest, res: Response) => {
  try {
    const node = await getNodeWithToken(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const result = await proxyToNode(node, 'GET', `/${req.params.proxyId}/ip-history`);
    res.status(result.status).json(result.data);
  } catch (error: any) {
    res.status(502).json({ error: `Failed to connect to node: ${error.message}` });
  }
});

router.delete('/:nodeId/proxies/:proxyId/clear-history', async (req: AuthRequest, res: Response) => {
  try {
    const node = await getNodeWithToken(req.params.nodeId);
    if (!node) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const result = await proxyToNode(node, 'DELETE', `/${req.params.proxyId}/clear-history`);
    res.status(result.status).json(result.data);
  } catch (error: any) {
    res.status(502).json({ error: `Failed to connect to node: ${error.message}` });
  }
});

export default router;
