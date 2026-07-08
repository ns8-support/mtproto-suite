import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import {
  testSshConnection,
  installRemoteServiceNode,
  RemoteInstallParams,
  SshCredentials,
} from '../services/ssh/remote-install';
import { logger, sanitizeErrorMessage } from '../../../shared/utils/logger';
import { isValidIPv4, isValidDomain, isValidPort, sanitizeString } from '../utils/validation';

const router = Router();
router.use(authMiddleware);

/**
 * POST /api/remote-install/test-ssh
 *
 * Тестирует SSH-соединение и возвращает информацию о системе.
 * Не выполняет никаких модификаций.
 */
router.post('/test-ssh', async (req: AuthRequest, res: Response) => {
  const host = sanitizeString(req.body?.host);
  const port = req.body?.port || 22;
  const username = sanitizeString(req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : undefined;
  const privateKey = typeof req.body?.privateKey === 'string' ? req.body.privateKey : undefined;
  const passphrase = typeof req.body?.passphrase === 'string' ? req.body.passphrase : undefined;

  if (!host || (!isValidIPv4(host) && !isValidDomain(host))) {
    res.status(400).json({ error: 'Invalid host (must be IP or domain)' });
    return;
  }
  if (!isValidPort(port)) {
    res.status(400).json({ error: 'Invalid port' });
    return;
  }
  if (!username) {
    res.status(400).json({ error: 'Username is required' });
    return;
  }
  if (!password && !privateKey) {
    res.status(400).json({ error: 'Either password or privateKey is required' });
    return;
  }

  const credentials: SshCredentials = {
    host,
    port,
    username,
    password,
    privateKey,
    passphrase,
  };

  const result = await testSshConnection(credentials);
  logger.info('remote-install', `SSH test to ${host}:${port} by user ${username}`, {
    success: result.success,
  });
  res.json(result);
});

/**
 * POST /api/remote-install/node
 *
 * Устанавливает service-node на удалённом сервере через SSH.
 *
 * Body:
 *   - ssh: { host, port, username, password? | privateKey? }
 *   - nodePort?: number (default 8443)
 *   - nginxPort?: number (default 443)
 *   - natIp?: string
 *
 * Response:
 *   - success: boolean
 *   - serverIp: string (публичный IP удалённого сервера)
 *   - port: number
 *   - authToken: string (для добавления ноды в панель)
 *   - log: string (полный лог установки)
 *   - error?: string
 */
router.post('/node', async (req: AuthRequest, res: Response) => {
  const ssh = req.body?.ssh;
  if (!ssh) {
    res.status(400).json({ error: 'ssh credentials are required' });
    return;
  }

  const host = sanitizeString(ssh.host);
  const port = ssh.port || 22;
  const username = sanitizeString(ssh.username);
  const password = typeof ssh.password === 'string' ? ssh.password : undefined;
  const privateKey = typeof ssh.privateKey === 'string' ? ssh.privateKey : undefined;
  const passphrase = typeof ssh.passphrase === 'string' ? ssh.passphrase : undefined;

  if (!host || (!isValidIPv4(host) && !isValidDomain(host))) {
    res.status(400).json({ error: 'Invalid ssh.host' });
    return;
  }
  if (!isValidPort(port)) {
    res.status(400).json({ error: 'Invalid ssh.port' });
    return;
  }
  if (!username) {
    res.status(400).json({ error: 'ssh.username is required' });
    return;
  }
  if (!password && !privateKey) {
    res.status(400).json({ error: 'Either ssh.password or ssh.privateKey is required' });
    return;
  }

  const nodePort = req.body?.nodePort || 8443;
  const nginxPort = req.body?.nginxPort || 443;
  const natIp = req.body?.natIp ? sanitizeString(req.body.natIp) : '';

  if (!isValidPort(nodePort)) {
    res.status(400).json({ error: 'Invalid nodePort' });
    return;
  }
  if (!isValidPort(nginxPort)) {
    res.status(400).json({ error: 'Invalid nginxPort' });
    return;
  }

  const params: RemoteInstallParams = {
    ssh: { host, port, username, password, privateKey, passphrase },
    nodePort,
    nginxPort,
    natIp,
  };

  logger.info('remote-install', `Starting installation on ${host}:${port} by ${username}`);

  try {
    const result = await installRemoteServiceNode(params);

    if (result.success) {
      logger.info('remote-install', `Installation successful on ${result.serverIp}:${result.port}`);
    } else {
      logger.warn('remote-install', `Installation failed on ${host}`, {
        error: result.error,
      });
    }

    res.json(result);
  } catch (err: any) {
    logger.error('remote-install', `Installation error for ${host}`, { error: err.message });
    res.status(500).json({
      success: false,
      serverIp: '',
      port: nodePort,
      authToken: '',
      log: '',
      error: sanitizeErrorMessage(err),
    });
  }
});

export default router;
