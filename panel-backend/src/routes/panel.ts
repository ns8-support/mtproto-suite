import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { logger, sanitizeErrorMessage } from '../../../shared/utils/logger';
import { isValidIPv4, sanitizeString } from '../utils/validation';
import { getSystemInfo } from '../services/ssh/metrics';
import {
  getNetBirdStatus,
  installNetBird,
  uninstallNetBird,
} from '../services/netbird';
import { executeRemoteCommand, SshCredentials } from '../services/ssh/remote-install';

/**
 * Endpoints для управления самим сервером панели (host, где запущена панель).
 *
 * В отличие от нод, у сервера панели нет записи в БД — доступ осуществляется
 * по SSH к хосту (localhost или его локальный IP). Все действия требуют
 * SSH-креды в теле запроса (как и для нод).
 *
 * Доступно:
 * - POST /api/panel/system-info — информация о системе хоста
 * - POST /api/panel/netbird/status — статус NetBird на сервере панели
 * - POST /api/panel/netbird/install — установка + подключение NetBird
 * - POST /api/panel/netbird/uninstall — удаление NetBird
 * - POST /api/panel/netbird/disconnect — отключение от mesh (netbird down)
 */

const router = Router();
router.use(authMiddleware);

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

router.post('/system-info', async (req: AuthRequest, res: Response) => {
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

router.post('/netbird/status', async (req: AuthRequest, res: Response) => {
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

router.post('/netbird/install', async (req: AuthRequest, res: Response) => {
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
      managementUrl: req.body?.managementUrl
        ? sanitizeString(req.body.managementUrl)
        : undefined,
      hostname: req.body?.hostname ? sanitizeString(req.body.hostname) : undefined,
    });
    logger.info('netbird', `Install on panel server`, { success: result.success });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, log: '', error: sanitizeErrorMessage(err) });
  }
});

router.post('/netbird/uninstall', async (req: AuthRequest, res: Response) => {
  const ssh = parseSshCredentials(req.body);
  if ('error' in ssh) {
    res.status(400).json({ error: ssh.error });
    return;
  }
  try {
    const result = await uninstallNetBird(ssh);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, log: '', error: sanitizeErrorMessage(err) });
  }
});

router.post('/netbird/disconnect', async (req: AuthRequest, res: Response) => {
  const ssh = parseSshCredentials(req.body);
  if ('error' in ssh) {
    res.status(400).json({ error: ssh.error });
    return;
  }
  try {
    const result = await executeRemoteCommand(ssh, 'netbird down 2>&1 || true', 30000);
    res.json({ success: result.code === 0, log: result.stdout + result.stderr });
  } catch (err: any) {
    res.status(500).json({ success: false, log: '', error: sanitizeErrorMessage(err) });
  }
});

export default router;
