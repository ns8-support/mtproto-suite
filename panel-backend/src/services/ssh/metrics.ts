import { logger } from '../../../../shared/utils/logger';
import {
  CpuMetrics,
  MemoryMetrics,
  DiskMetrics,
  SystemInfo,
  NodeMetrics,
  ContainerStats,
  MetricsHistoryPoint,
} from '../../../../shared/types/monitoring';
import { executeRemoteCommand, SshCredentials } from './remote-install';

/**
 * Сбор метрик удалённого сервера через SSH.
 *
 * Использует стандартные Linux команды:
 * - `top -bn1` или `/proc/stat` для CPU
 * - `free -b` для памяти
 * - `df -B1` для дисков
 * - `docker stats --no-stream` для контейнеров
 * - `uname`, `/etc/os-release` для system info
 *
 * Преимущества:
 * - Не требует установки агента на ноде.
 * - Работает на любом Linux.
 * - Простая отладка — команды можно выполнить вручную.
 *
 * Недостаток:
 * - Каждый вызов — это N SSH round-trips. Для production можно кэшировать
 *   на стороне панели (5 минут) — реализовано в /api/nodes/:id/metrics endpoint.
 */

/**
 * Парсит вывод `top -bn1 | head -20` для получения CPU usage.
 *
 * top выводит строки вроде:
 *   %Cpu(s):  5.3 us,  1.2 sy,  0.0 ni, 93.5 id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st
 *
 * % использования = 100 - idle (id)
 */
function parseCpuFromTop(output: string): number {
  const match = output.match(/(\d+\.\d+)\s+id/);
  if (!match) return 0;
  const idle = parseFloat(match[1]);
  return Math.round((100 - idle) * 10) / 10;
}

function parseCpuCores(output: string): number {
  // nproc выводит одно число.
  const trimmed = output.trim();
  const n = parseInt(trimmed, 10);
  return isNaN(n) ? 1 : n;
}

function parseLoadAvg(output: string): { l1: number; l5: number; l15: number } {
  // uptime выводит: " 17:30:01 up 42 days,  3:15,  2 users,  load average: 0.15, 0.10, 0.05"
  const match = output.match(/load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  if (!match) return { l1: 0, l5: 0, l15: 0 };
  return {
    l1: parseFloat(match[1]),
    l5: parseFloat(match[2]),
    l15: parseFloat(match[3]),
  };
}

function parseCpuModel(output: string): string {
  // /proc/cpuinfo первая строка "model name"
  const match = output.match(/model name\s*:\s*(.+)/);
  return match ? match[1].trim() : 'unknown';
}

/**
 * Парсит `free -b` для памяти.
 *
 * Формат:
 *                total        used        free      shared  buff/cache   available
 * Mem:     8243979264  4123456789  1234567890    12345678  2886014585  3870123456
 * Swap:     2097151488         0    2097151488
 */
function parseMemory(output: string): MemoryMetrics {
  const lines = output.split('\n');
  const memLine = lines.find((l) => l.startsWith('Mem:'));
  const swapLine = lines.find((l) => l.startsWith('Swap:'));

  if (!memLine) {
    return {
      totalBytes: 0,
      usedBytes: 0,
      freeBytes: 0,
      usagePercent: 0,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
    };
  }

  const memParts = memLine.split(/\s+/);
  const total = parseInt(memParts[1], 10) || 0;
  const used = parseInt(memParts[2], 10) || 0;
  const free = parseInt(memParts[3], 10) || 0;

  const swapParts = swapLine ? swapLine.split(/\s+/) : [];
  const swapTotal = swapParts.length > 1 ? parseInt(swapParts[1], 10) || 0 : 0;
  const swapUsed = swapParts.length > 2 ? parseInt(swapParts[2], 10) || 0 : 0;

  return {
    totalBytes: total,
    usedBytes: used,
    freeBytes: free,
    usagePercent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
    swapTotalBytes: swapTotal,
    swapUsedBytes: swapUsed,
  };
}

/**
 * Парсит `df -B1 -P` для дисков.
 *
 * Формат:
 * Filesystem     1B-blocks      Used  Available Use% Mounted on
 * /dev/sda1   500107608064 12345678 12345678  3% /
 */
function parseDisks(output: string): DiskMetrics[] {
  const lines = output.trim().split('\n');
  if (lines.length < 2) return [];

  const disks: DiskMetrics[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(/\s+/);
    if (parts.length < 6) continue;

    const filesystem = parts[0];
    const total = parseInt(parts[1], 10);
    const used = parseInt(parts[2], 10);
    const free = parseInt(parts[3], 10);
    const usageStr = parts[4].replace('%', '');
    const mount = parts[5];

    // Игнорируем tmpfs, devtmpfs, overlay, и т.д.
    if (filesystem.startsWith('tmpfs') || filesystem.startsWith('devtmpfs')) continue;
    if (filesystem.startsWith('overlay')) continue;
    if (filesystem.startsWith('squashfs')) continue;

    // Игнорируем /boot/efi (обычно маленький).
    if (mount === '/boot/efi' || mount === '/boot') continue;

    if (isNaN(total) || total === 0) continue;

    disks.push({
      mountPoint: mount,
      totalBytes: total,
      usedBytes: used,
      freeBytes: free,
      usagePercent: parseFloat(usageStr) || 0,
      filesystem,
    });
  }
  return disks;
}

/**
 * Парсит `uname -a`, `/etc/os-release`, `uptime`.
 */
function parseSystemInfo(
  unameOutput: string,
  osReleaseOutput: string,
  uptimeOutput: string,
  ipOutput: string
): SystemInfo {
  // uname: Linux hostname 5.15.0-91-generic #101-Ubuntu SMP x86_64 GNU/Linux
  const unameParts = unameOutput.trim().split(/\s+/);
  const kernel = unameParts[2] || 'unknown';
  const arch = unameParts[unameParts.length - 2] || 'unknown';
  const hostname = unameParts[1] || 'unknown';

  // /etc/os-release
  const osLines = osReleaseOutput.split('\n');
  const getValue = (key: string): string => {
    const line = osLines.find((l) => l.startsWith(key + '='));
    return line ? line.slice(key.length + 1).replace(/"/g, '').trim() : '';
  };
  const os = getValue('ID') || getValue('NAME') || 'unknown';
  const osVersion = getValue('VERSION_ID') || getValue('VERSION') || '';

  // uptime: 17:30:01 up 42 days,  3:15,  2 users,  load average: 0.15, 0.10, 0.05
  const uptimeMatch = uptimeOutput.match(/up\s+(.+?),\s+\d+\s+user/);
  const uptimeSeconds = parseUptimeToSeconds(uptimeMatch ? uptimeMatch[1] : '');

  return {
    hostname,
    os,
    osVersion,
    kernel,
    arch,
    uptimeSeconds,
    currentTime: new Date().toISOString(),
    ipAddresses: ipOutput
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('lo:') && l !== '127.0.0.1'),
  };
}

function parseUptimeToSeconds(uptimeStr: string): number {
  // Форматы: "42 days", "3:15", "1:30:45", "5 min"
  let seconds = 0;
  const dayMatch = uptimeStr.match(/(\d+)\s*day/);
  if (dayMatch) seconds += parseInt(dayMatch[1], 10) * 86400;
  const timeMatch = uptimeStr.match(/(\d+):(\d+)(?::(\d+))?/);
  if (timeMatch) {
    seconds += parseInt(timeMatch[1], 10) * 3600;
    seconds += parseInt(timeMatch[2], 10) * 60;
    if (timeMatch[3]) seconds += parseInt(timeMatch[3], 10);
  }
  const minMatch = uptimeStr.match(/(\d+)\s*min/);
  if (minMatch) seconds += parseInt(minMatch[1], 10) * 60;
  return seconds;
}

/**
 * Парсит `docker stats --no-stream --format '{{json .}}'` для контейнеров.
 *
 * Каждая строка — JSON объект:
 * {"Name":"mtproto-nginx","CPUPerc":"2.34%","MemUsage":"123MiB / 1GiB",...}
 */
function parseDockerStats(output: string): ContainerStats[] {
  const containers: ContainerStats[] = [];
  const lines = output.trim().split('\n').filter((l) => l.trim());

  for (const line of lines) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = JSON.parse(line) as Record<string, any>;
      const memUsage = obj.MemUsage || '';
      // MemUsage: "123MiB / 1GiB" → [123, MiB, 1, GiB]
      const memMatch = memUsage.match(/([\d.]+)\s*(\w+)\s*\/\s*([\d.]+)\s*(\w+)/);
      const memoryBytes = memMatch ? parseSizeToBytes(memMatch[1], memMatch[2]) : 0;
      const memoryLimit = memMatch ? parseSizeToBytes(memMatch[3], memMatch[4]) : 0;

      const netIn = obj.NetIO?.split(' / ')[0] || '0B';
      const netOut = obj.NetIO?.split(' / ')[1] || '0B';

      containers.push({
        name: obj.Name || obj.Container || 'unknown',
        image: obj.Image || 'unknown',
        status: obj.Status || 'unknown',
        cpuPercent: parseFloat(obj.CPUPerc?.replace('%', '') || '0') || 0,
        memoryBytes,
        memoryLimit,
        networkRxBytes: parseSizeToBytes(netIn.replace(/[^\d.]/g, ''), netIn.replace(/[\d.]/g, '')),
        networkTxBytes: parseSizeToBytes(netOut.replace(/[^\d.]/g, ''), netOut.replace(/[\d.]/g, '')),
        created: obj.Created || '',
      });
    } catch {
      // Игнорируем некорректные строки.
    }
  }
  return containers;
}

function parseSizeToBytes(value: string, unit: string): number {
  const num = parseFloat(value) || 0;
  const u = unit.toUpperCase();
  if (u === 'B') return num;
  if (u === 'KB' || u === 'KIB') return num * 1024;
  if (u === 'MB' || u === 'MIB') return num * 1024 * 1024;
  if (u === 'GB' || u === 'GIB') return num * 1024 * 1024 * 1024;
  if (u === 'TB' || u === 'TIB') return num * 1024 * 1024 * 1024 * 1024;
  return num;
}

// ============ Публичные методы ============

/**
 * Собирает CPU метрики.
 */
export async function getCpuMetrics(ssh: SshCredentials): Promise<CpuMetrics> {
  const [topResult, nprocResult, uptimeResult, cpuinfoResult] = await Promise.all([
    executeRemoteCommand(ssh, 'top -bn1 | head -10', 15000),
    executeRemoteCommand(ssh, 'nproc', 5000),
    executeRemoteCommand(ssh, 'uptime', 5000),
    executeRemoteCommand(ssh, 'grep "model name" /proc/cpuinfo | head -1', 5000),
  ]);

  const usagePercent = parseCpuFromTop(topResult.stdout);
  const cores = parseCpuCores(nprocResult.stdout);
  const { l1, l5, l15 } = parseLoadAvg(uptimeResult.stdout);
  const model = parseCpuModel(cpuinfoResult.stdout);

  return {
    usagePercent,
    cores,
    loadAvg1: l1,
    loadAvg5: l5,
    loadAvg15: l15,
    model,
  };
}

/**
 * Собирает метрики памяти.
 */
export async function getMemoryMetrics(ssh: SshCredentials): Promise<MemoryMetrics> {
  const result = await executeRemoteCommand(ssh, 'free -b', 5000);
  return parseMemory(result.stdout);
}

/**
 * Собирает метрики дисков.
 */
export async function getDiskMetrics(ssh: SshCredentials): Promise<DiskMetrics[]> {
  const result = await executeRemoteCommand(ssh, 'df -B1 -P -x tmpfs -x devtmpfs', 10000);
  return parseDisks(result.stdout);
}

/**
 * Собирает информацию о системе.
 */
export async function getSystemInfo(ssh: SshCredentials): Promise<SystemInfo> {
  const [unameResult, osResult, uptimeResult, ipResult] = await Promise.all([
    executeRemoteCommand(ssh, 'uname -a', 5000),
    executeRemoteCommand(ssh, 'cat /etc/os-release', 5000),
    executeRemoteCommand(ssh, 'uptime', 5000),
    executeRemoteCommand(ssh, 'ip -4 addr show | grep inet | awk "{print $2}" | cut -d/ -f1', 10000),
  ]);

  return parseSystemInfo(unameResult.stdout, osResult.stdout, uptimeResult.stdout, ipResult.stdout);
}

/**
 * Собирает статистику Docker контейнеров.
 */
export async function getDockerStats(ssh: SshCredentials): Promise<ContainerStats[]> {
  const result = await executeRemoteCommand(
    ssh,
    'docker stats --no-stream --format \'{{json .}}\' 2>&1',
    30000
  );
  // Если Docker не установлен или нет контейнеров — пустой массив.
  if (!result.stdout.trim()) return [];
  return parseDockerStats(result.stdout);
}

/**
 * Собирает ВСЕ метрики одним вызовом (5 параллельных SSH запросов).
 */
export async function getNodeMetrics(ssh: SshCredentials, nodeId: number): Promise<NodeMetrics> {
  const [cpu, memory, disks, containers] = await Promise.all([
    getCpuMetrics(ssh),
    getMemoryMetrics(ssh),
    getDiskMetrics(ssh),
    getDockerStats(ssh),
  ]);

  return {
    nodeId,
    cpu,
    memory,
    disks,
    containers,
    collectedAt: new Date().toISOString(),
  };
}

/**
 * Получает список Docker контейнеров через `docker ps -a`.
 * Используется для более детальной информации.
 */
export async function listDockerContainers(ssh: SshCredentials): Promise<
  Array<{
    id: string;
    name: string;
    image: string;
    status: string;
    created: string;
    ports: string;
  }>
> {
  const result = await executeRemoteCommand(
    ssh,
    'docker ps -a --format "table {{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.CreatedAt}}\\t{{.Ports}}"',
    10000
  );
  const lines = result.stdout.trim().split('\n').slice(1); // Skip header
  return lines.map((line) => {
    const parts = line.split('\t');
    return {
      id: parts[0] || '',
      name: parts[1] || '',
      image: parts[2] || '',
      status: parts[3] || '',
      created: parts[4] || '',
      ports: parts[5] || '',
    };
  });
}

// ============ Действия: перезапуск сервиса и сервера ============

/**
 * Перезапускает service-node на удалённом сервере через docker compose restart.
 *
 * Находит каталог установки (по умолчанию /opt/mtproto-suite), выполняет
 * `docker compose restart service-node` или `docker compose up -d` если
 * контейнер не запущен.
 *
 * Возвращает лог операции.
 */
export async function restartServiceNode(
  ssh: SshCredentials,
  installDir = '/opt/mtproto-suite'
): Promise<{ success: boolean; log: string; error?: string }> {
  const log: string[] = [];

  // Шаг 1: проверить, что каталог существует.
  const checkResult = await executeRemoteCommand(
    ssh,
    `test -d ${installDir} && echo "exists" || echo "missing"`,
    5000
  );
  if (checkResult.stdout.trim() !== 'exists') {
    return {
      success: false,
      log: `Каталог ${installDir} не найден на удалённом сервере`,
      error: 'Service node не установлен',
    };
  }

  log.push(`[1] Каталог ${installDir} найден`);

  // Шаг 2: проверить состояние контейнера.
  const statusResult = await executeRemoteCommand(
    ssh,
    `cd ${installDir}/service-node && docker compose ps --format json 2>&1 | head -5`,
    15000
  );
  log.push(`[2] Состояние контейнеров:\n${statusResult.stdout}`);

  // Шаг 3: перезапустить.
  const restartResult = await executeRemoteCommand(
    ssh,
    `cd ${installDir}/service-node && docker compose restart service-node 2>&1`,
    60000
  );
  log.push(`[3] Команда restart:\n${restartResult.stdout}${restartResult.stderr}`);
  if (restartResult.code !== 0) {
    return {
      success: false,
      log: log.join('\n'),
      error: `docker compose restart завершился с кодом ${restartResult.code}`,
    };
  }

  // Шаг 4: подождать готовности.
  const healthResult = await executeRemoteCommand(
    ssh,
    `
cd ${installDir}/service-node
for i in $(seq 1 15); do
  if curl -fsS -m 2 http://localhost:8443/api/health -H "Authorization: Bearer $(grep AUTH_TOKEN .env | cut -d= -f2)" >/dev/null 2>&1; then
    echo "Service node is healthy"
    exit 0
  fi
  sleep 2
done
echo "Health check timeout"
exit 1
`,
    60000
  );
  log.push(`[4] Health check:\n${healthResult.stdout}`);

  if (healthResult.code !== 0) {
    return {
      success: false,
      log: log.join('\n'),
      error: 'Service node не прошёл health check после restart',
    };
  }

  logger.info('ssh-metrics', `Service node restarted successfully on ${ssh.host}`);

  return { success: true, log: log.join('\n') };
}

/**
 * Перезагружает удалённый сервер через `sudo reboot`.
 *
 * ВАЖНО: Это деструктивная операция. В UI должно быть явное подтверждение.
 *
 * Если `sudo` требует пароль и мы работаем через SSH key — обычно работает
 * (NOPASSWD в sudoers). Если нет — операция упадёт.
 */
export async function rebootServer(
  ssh: SshCredentials
): Promise<{ success: boolean; log: string; error?: string }> {
  const log: string[] = [];

  log.push(`[1] Инициализация перезагрузки ${ssh.host}`);

  // Проверяем наличие sudo без пароля.
  const sudoResult = await executeRemoteCommand(
    ssh,
    'sudo -n true 2>&1 && echo "sudo-ok" || echo "sudo-needs-password"',
    5000
  );

  if (sudoResult.stdout.includes('sudo-needs-password')) {
    return {
      success: false,
      log: log.join('\n') + '\n[ERROR] sudo требует пароль. Настройте NOPASSWD в /etc/sudoers.',
      error: 'sudo без NOPASSWD не поддерживается',
    };
  }

  log.push(`[2] sudo OK, инициируем reboot...`);

  // Команда `sudo reboot` сразу отключает соединение, поэтому оборачиваем в nohup.
  // Используем `&` чтобы не ждать завершения.
  const rebootResult = await executeRemoteCommand(
    ssh,
    'sudo nohup reboot >/dev/null 2>&1 & sleep 1 && echo "reboot-initiated" || echo "reboot-failed"',
    10000
  );
  log.push(`[3] Результат: ${rebootResult.stdout.trim()}`);

  if (!rebootResult.stdout.includes('reboot-initiated')) {
    return {
      success: false,
      log: log.join('\n'),
      error: 'Не удалось инициировать reboot',
    };
  }

  logger.warn('ssh-metrics', `Server reboot initiated on ${ssh.host}`);

  return { success: true, log: log.join('\n') };
}

/**
 * Собирает исторические метрики (для графиков) — упрощённая версия.
 *
 * Полная история хранится в БД (node_metrics таблица). Эта функция возвращает
 * текущие метрики для немедленного отображения.
 */
export async function collectMetricsPoint(
  ssh: SshCredentials
): Promise<MetricsHistoryPoint> {
  const [cpu, memory, disks, containers] = await Promise.all([
    getCpuMetrics(ssh),
    getMemoryMetrics(ssh),
    getDiskMetrics(ssh),
    getDockerStats(ssh),
  ]);

  const runningContainers = containers.filter((c) => c.status.includes('Up')).length;
  const mainDisk = disks.find((d) => d.mountPoint === '/') || disks[0];

  return {
    timestamp: new Date().toISOString(),
    cpuPercent: cpu.usagePercent,
    memoryPercent: memory.usagePercent,
    diskPercent: mainDisk?.usagePercent || 0,
    runningContainers,
  };
}
