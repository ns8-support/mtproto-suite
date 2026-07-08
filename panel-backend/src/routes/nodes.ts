import { Router, Response } from 'express';
import { pool } from '../db';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { proxyCustomToNode } from '../utils/node-proxy';
import {
  isValidIPv4,
  isValidDomain,
  isValidPort,
  isValidToken,
  sanitizeString,
} from '../utils/validation';
import { config } from '../config';
import { logger, sanitizeErrorMessage } from '../../../shared/utils/logger';

const router = Router();
router.use(authMiddleware);

// List all nodes
router.get('/', async (_req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, ip, port, domain, created_at FROM nodes ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

/**
 * Health check до добавления ноды — показывает, доступна ли нода.
 */
router.post('/check-health', async (req: AuthRequest, res: Response) => {
  const ip = sanitizeString(req.body?.ip);
  const port = req.body?.port;
  const token = sanitizeString(req.body?.token);

  if (!isValidIPv4(ip) || !isValidPort(port) || !isValidToken(token, config.minTokenLength)) {
    res.status(400).json({ error: 'Invalid ip, port, or token' });
    return;
  }

  try {
    const result = await proxyCustomToNode({ ip, port, token }, '/health', { timeoutMs: 5000 });
    res.json({ online: result.status === 200 });
  } catch {
    res.json({ online: false });
  }
});

// Add a node
router.post('/', async (req: AuthRequest, res: Response) => {
  const name = sanitizeString(req.body?.name);
  const ip = sanitizeString(req.body?.ip);
  const port = req.body?.port;
  const token = sanitizeString(req.body?.token);
  const domain = sanitizeString(req.body?.domain);

  if (!isValidIPv4(ip) || !isValidPort(port) || !isValidToken(token, config.minTokenLength)) {
    res.status(400).json({ error: 'ip, port (1-65535), and token (min 16 chars) are required' });
    return;
  }
  if (domain && !isValidDomain(domain)) {
    res.status(400).json({ error: 'Invalid domain format' });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO nodes (name, ip, port, token, domain)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, ip, port, domain, created_at`,
      [name || `Node ${ip}`, ip, port, token, domain]
    );
    res.status(201).json(result.rows[0]);
  } catch (error: any) {
    logger.error('panel.nodes', 'Failed to add node', { error: error.message });
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

// Get a node
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, name, ip, port, token, domain, created_at FROM nodes WHERE id = $1',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

// Update node
router.put('/:id', async (req: AuthRequest, res: Response) => {
  const name = req.body?.name !== undefined ? sanitizeString(req.body.name) : undefined;
  const ip = req.body?.ip !== undefined ? sanitizeString(req.body.ip) : undefined;
  const port = req.body?.port;
  const token = req.body?.token !== undefined ? sanitizeString(req.body.token) : undefined;
  const domain = req.body?.domain !== undefined ? sanitizeString(req.body.domain) : undefined;

  if (ip !== undefined && !isValidIPv4(ip)) {
    res.status(400).json({ error: 'Invalid ip' });
    return;
  }
  if (port !== undefined && !isValidPort(port)) {
    res.status(400).json({ error: 'Invalid port' });
    return;
  }
  if (token !== undefined && !isValidToken(token, config.minTokenLength)) {
    res.status(400).json({ error: `Token must be at least ${config.minTokenLength} chars` });
    return;
  }
  if (domain !== undefined && domain && !isValidDomain(domain)) {
    res.status(400).json({ error: 'Invalid domain' });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE nodes
       SET name = COALESCE($1, name),
           ip = COALESCE($2, ip),
           port = COALESCE($3, port),
           token = COALESCE($4, token),
           domain = COALESCE($5, domain)
       WHERE id = $6
       RETURNING id, name, ip, port, domain, created_at`,
      [name, ip, port, token, domain, req.params.id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

// Health check a node (existing node)
router.get('/:id/health', async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query('SELECT ip, port, token FROM nodes WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const node = result.rows[0];
    try {
      const r = await proxyCustomToNode(node, '/health', { timeoutMs: 5000 });
      if (r.status === 200) {
        const data = r.data as { version?: string } | null;
        res.json({ online: true, version: data?.version ?? null });
      } else {
        res.json({ online: false });
      }
    } catch {
      res.json({ online: false });
    }
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

// Delete a node
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query('DELETE FROM nodes WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

// Trigger update on a node
router.post('/:id/update', async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query('SELECT ip, port, token FROM nodes WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const node = result.rows[0];
    try {
      const r = await proxyCustomToNode(node, '/update', { method: 'POST', timeoutMs: 120000 });
      res.status(r.status).json(r.data);
    } catch (err: any) {
      res.status(502).json({ error: sanitizeErrorMessage(err) });
    }
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

// Domains proxy endpoints
router.get('/:id/domains', async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query('SELECT ip, port, token FROM nodes WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const node = result.rows[0];
    try {
      const r = await proxyCustomToNode(node, '/domains', { timeoutMs: 10000 });
      res.status(r.status).json(r.data);
    } catch (err: any) {
      res.status(502).json({ error: sanitizeErrorMessage(err) });
    }
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

router.put('/:id/domains', async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query('SELECT ip, port, token FROM nodes WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const node = result.rows[0];
    try {
      const r = await proxyCustomToNode(node, '/domains', {
        method: 'PUT',
        body: req.body,
        timeoutMs: 10000,
      });
      res.status(r.status).json(r.data);
    } catch (err: any) {
      res.status(502).json({ error: sanitizeErrorMessage(err) });
    }
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

// Blacklist proxy endpoints
router.get('/:id/blacklist', async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query('SELECT ip, port, token FROM nodes WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const node = result.rows[0];
    try {
      const r = await proxyCustomToNode(node, '/blacklist', { timeoutMs: 10000 });
      res.status(r.status).json(r.data);
    } catch (err: any) {
      res.status(502).json({ error: sanitizeErrorMessage(err) });
    }
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

router.put('/:id/blacklist', async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query('SELECT ip, port, token FROM nodes WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const node = result.rows[0];
    try {
      const r = await proxyCustomToNode(node, '/blacklist', {
        method: 'PUT',
        body: req.body,
        timeoutMs: 10000,
      });
      res.status(r.status).json(r.data);
    } catch (err: any) {
      res.status(502).json({ error: sanitizeErrorMessage(err) });
    }
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

// Export / Import
router.get('/:id/export', async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query('SELECT ip, port, token FROM nodes WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const node = result.rows[0];
    try {
      const r = await proxyCustomToNode(node, '/export', { timeoutMs: 30000 });
      // Пересылаем Content-Disposition от ноды.
      // (Express не даёт прямой доступ к upstream headers без отдельного fetch)
      res.status(r.status).json(r.data);
    } catch (err: any) {
      res.status(502).json({ error: sanitizeErrorMessage(err) });
    }
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

router.post('/:id/import', async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query('SELECT ip, port, token FROM nodes WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }
    const node = result.rows[0];
    try {
      const r = await proxyCustomToNode(node, '/import', {
        method: 'POST',
        body: req.body,
        timeoutMs: 60000,
      });
      res.status(r.status).json(r.data);
    } catch (err: any) {
      res.status(502).json({ error: sanitizeErrorMessage(err) });
    }
  } catch (error: any) {
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});

export default router;
