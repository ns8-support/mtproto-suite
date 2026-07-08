import { logger } from '../../../../shared/utils/logger';
import { executeRemoteCommand, SshCredentials } from '../ssh/remote-install';
import { NetBirdStatus, NetBirdInstallRequest } from '../../../../shared/types/monitoring';

/**
 * NetBird интеграция для создания mesh VPN сети между нодами.
 *
 * NetBird — это open-source VPN mesh (WireGuard + ZeroTrust), который позволяет:
 * - Объединить ноды в единую приватную сеть без публичных IP
 * - Использовать ноды по внутренним IP через панель
 * - Безопасный доступ к нодам за NAT/firewall
 *
 * Архитектура:
 * - Management server: либо SaaS (netbird.io), либо self-hosted
 * - Каждая нода = peer с уникальным ключом
 * - Подключение через setup key (одноразовый, с TTL)
 *
 * Установка клиента:
 * 1. Скачиваем .deb/.rpm пакет с GitHub releases
 * 2. Устанавливаем через apt/yum
 * 3. Запускаем `netbird up --setup-key <key>`
 * 4. Проверяем `netbird status`
 */

const NETBIRD_VERSION = '0.27.0';
const NETBIRD_RELEASES_URL = 'https://github.com/netbirdio/netbird/releases';

/**
 * Определяет архитектуру и ОС удалённого сервера для выбора правильного пакета.
 */
async function detectPackageInfo(ssh: SshCredentials): Promise<{
  os: 'debian' | 'rhel';
  arch: string;
}> {
  const osResult = await executeRemoteCommand(ssh, 'cat /etc/os-release | grep ^ID=', 5000);
  const archResult = await executeRemoteCommand(ssh, 'uname -m', 5000);

  const osId = osResult.stdout.toLowerCase();
  const arch = archResult.stdout.trim();

  const os = osId.includes('ubuntu') || osId.includes('debian') ? 'debian' : 'rhel';

  // Нормализуем arch: aarch64 → arm64
  const normalizedArch = arch === 'aarch64' ? 'arm64' : arch === 'x86_64' ? 'amd64' : arch;

  return { os, arch: normalizedArch };
}

/**
 * Проверяет, установлен ли NetBird на удалённом сервере.
 */
export async function getNetBirdStatus(ssh: SshCredentials): Promise<NetBirdStatus> {
  // Проверяем наличие бинарника.
  const checkResult = await executeRemoteCommand(
    ssh,
    'command -v netbird && echo "installed" || echo "not-installed"',
    5000
  );

  const installed = checkResult.stdout.includes('installed');
  if (!installed) {
    return {
      installed: false,
      connected: false,
      meshIp: null,
      peerName: null,
      managementUrl: null,
      version: null,
      peers: [],
    };
  }

  // Получаем статус.
  const statusResult = await executeRemoteCommand(ssh, 'netbird status --json 2>&1', 10000);
  const versionResult = await executeRemoteCommand(ssh, 'netbird version 2>&1', 5000);

  let parsed: {
    connected?: boolean;
    managementState?: { connected?: boolean };
    localPeerState?: {
      fqdn?: string;
      ip?: string;
      pubKey?: string;
    };
    peers?: Record<
      string,
      {
        fqdn?: string;
        ip?: string;
        connected?: boolean;
      }
    >;
  } = {};
  try {
    parsed = JSON.parse(statusResult.stdout);
  } catch {
    parsed = {};
  }

  // Парсим peers.
  const peers: NetBirdStatus['peers'] = [];
  if (parsed.peers) {
    for (const [name, info] of Object.entries(parsed.peers)) {
      peers.push({
        name: info.fqdn || name,
        ip: info.ip || '',
        connected: !!info.connected,
      });
    }
  }

  const version = versionResult.stdout.trim().split('\n')[0] || null;
  const meshIp = parsed.localPeerState?.ip || null;
  const peerName = parsed.localPeerState?.fqdn || null;
  const connected = parsed.managementState?.connected === true;

  // Management URL определяем из netbird status (опционально).
  // В новых версиях это `Management: Connected to https://...`
  let managementUrl: string | null = null;
  const urlMatch = statusResult.stdout.match(/https?:\/\/[^\s)]+/);
  if (urlMatch) managementUrl = urlMatch[0];

  return {
    installed: true,
    connected,
    meshIp,
    peerName,
    managementUrl,
    version,
    peers,
  };
}

/**
 * Устанавливает и настраивает NetBird на удалённом сервере.
 *
 * Алгоритм:
 * 1. Скачиваем .deb или .rpm пакет
 * 2. Устанавливаем через apt/yum
 * 3. Запускаем netbird up с setup key
 * 4. Проверяем статус
 */
export async function installNetBird(
  ssh: SshCredentials,
  request: NetBirdInstallRequest
): Promise<{ success: boolean; log: string; status?: NetBirdStatus; error?: string }> {
  const log: string[] = [];

  log.push(`[1] Установка NetBird v${NETBIRD_VERSION}`);

  const { os, arch } = await detectPackageInfo(ssh);
  log.push(`[2] ОС: ${os}, архитектура: ${arch}`);

  const packageName =
    os === 'debian'
      ? `netbird_${NETBIRD_VERSION}_${arch}.deb`
      : `netbird_${NETBIRD_VERSION}_${arch}.rpm`;

  const downloadUrl = `${NETBIRD_RELEASES_URL}/download/v${NETBIRD_VERSION}/${packageName}`;
  log.push(`[3] Скачивание ${downloadUrl}`);

  const downloadResult = await executeRemoteCommand(
    ssh,
    `curl -fsSL -o /tmp/${packageName} "${downloadUrl}" && echo "downloaded" || echo "download-failed"`,
    60000
  );

  if (downloadResult.stdout.includes('download-failed')) {
    return {
      success: false,
      log: log.join('\n'),
      error: 'Не удалось скачать пакет NetBird',
    };
  }

  // Установка.
  const installCmd =
    os === 'debian'
      ? `dpkg -i /tmp/${packageName} 2>&1 || (apt-get install -f -y && dpkg -i /tmp/${packageName})`
      : `rpm -Uvh /tmp/${packageName} 2>&1 || yum install -y /tmp/${packageName}`;

  const installResult = await executeRemoteCommand(ssh, installCmd, 120000);
  log.push(`[4] Установка:\n${installResult.stdout}${installResult.stderr}`);
  if (installResult.code !== 0) {
    return {
      success: false,
      log: log.join('\n'),
      error: 'Не удалось установить пакет NetBird',
    };
  }

  log.push(`[5] Подключение к management server через setup key`);

  // Setup key — формат: NETBIRD-SETUP-KEY-XXXXX
  const upCmd = [
    'netbird up',
    `--setup-key "${request.setupKey}"`,
    request.managementUrl ? `--management-url "${request.managementUrl}"` : '',
    request.hostname ? `--hostname "${request.hostname}"` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const upResult = await executeRemoteCommand(ssh, upCmd, 60000);
  log.push(`[6] netbird up:\n${upResult.stdout}${upResult.stderr}`);
  if (upResult.code !== 0) {
    return {
      success: false,
      log: log.join('\n'),
      error: 'Не удалось подключиться к management server',
    };
  }

  // Проверяем статус.
  const status = await getNetBirdStatus(ssh);
  log.push(`[7] Статус: installed=${status.installed}, connected=${status.connected}`);

  logger.info('netbird', `Installed on ${ssh.host}: connected=${status.connected}, meshIp=${status.meshIp}`);

  return {
    success: status.installed && status.connected,
    log: log.join('\n'),
    status,
  };
}

/**
 * Удаляет NetBird с удалённого сервера.
 */
export async function uninstallNetBird(
  ssh: SshCredentials
): Promise<{ success: boolean; log: string }> {
  const log: string[] = [];
  const { os } = await detectPackageInfo(ssh);

  // Сначала отключаемся.
  await executeRemoteCommand(ssh, 'netbird down 2>&1 || true', 30000);
  log.push('[1] netbird down выполнен');

  // Удаляем пакет.
  const removeCmd =
    os === 'debian'
      ? 'apt-get remove -y netbird && apt-get autoremove -y'
      : 'yum remove -y netbird';

  const result = await executeRemoteCommand(ssh, removeCmd, 60000);
  log.push(`[2] Удаление:\n${result.stdout}${result.stderr}`);

  return {
    success: result.code === 0,
    log: log.join('\n'),
  };
}
