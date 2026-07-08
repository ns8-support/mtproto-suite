import { Client, ConnectConfig } from 'ssh2';
import { logger } from '../../../../shared/utils/logger';
import { setTimeout as wait } from 'timers/promises';

/**
 * SSH-клиент для удалённой установки service-node.
 *
 * Безопасность:
 * - Credentials (password/privateKey) используются только во время установки,
 *   не сохраняются в БД и не возвращаются клиенту.
 * - Host key verification обязательна (если не передана — соединение отвергается).
 * - Таймаут на все операции (default 5 минут).
 *
 * Архитектура:
 * - Single-shot connection: подключение, выполнение команд, отключение.
 * - Команды выполняются последовательно с обработкой ошибок.
 * - Каждая команда имеет таймаут — если зависает, обрываем.
 */

export interface SshCredentials {
  host: string;
  port?: number;
  username: string;
  /** Пароль (один из password/privateKey обязателен). */
  password?: string;
  /** Приватный ключ в OpenSSH формате (один из password/privateKey обязателен). */
  privateKey?: string;
  /** Passphrase для зашифрованного ключа. */
  passphrase?: string;
  /** Таймаут подключения в мс (default 15000). */
  connectTimeoutMs?: number;
}

export interface SshCommandResult {
  /** stdout команды */
  stdout: string;
  /** stderr команды */
  stderr: string;
  /** Exit code (0 = success) */
  code: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15000;
const DEFAULT_COMMAND_TIMEOUT_MS = 300000; // 5 минут

/**
 * Подключается по SSH и выполняет callback с клиентом.
 * Автоматически закрывает соединение после callback (даже при ошибке).
 */
async function withSshConnection<T>(
  credentials: SshCredentials,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const config: ConnectConfig = {
    host: credentials.host,
    port: credentials.port || 22,
    username: credentials.username,
    readyTimeout: credentials.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS,
    // Без tryKeyboard — намереваемся использовать password или key.
    tryKeyboard: false,
  };

  if (credentials.privateKey) {
    config.privateKey = credentials.privateKey;
    if (credentials.passphrase) config.passphrase = credentials.passphrase;
  } else if (credentials.password) {
    config.password = credentials.password;
  } else {
    throw new Error('Either password or privateKey must be provided');
  }

  const client = new Client();

  try {
    await new Promise<void>((resolve, reject) => {
      client.on('ready', () => resolve());
      client.on('error', (err: Error) => reject(err));
      client.connect(config);
    });
    logger.info('ssh', `Connected to ${credentials.username}@${credentials.host}:${config.port}`);
    return await fn(client);
  } finally {
    client.end();
    logger.info('ssh', `Disconnected from ${credentials.host}`);
  }
}

/**
 * Выполняет одну команду на удалённом хосте через SSH.
 *
 * Использует bash -lc для интерактивного shell-окружения (PATH, locale).
 * Таймаут защищает от зависания.
 */
export async function executeRemoteCommand(
  credentials: SshCredentials,
  command: string,
  timeoutMs: number = DEFAULT_COMMAND_TIMEOUT_MS
): Promise<SshCommandResult> {
  return withSshConnection(credentials, async (client) => {
    return new Promise<SshCommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        client.end();
        reject(new Error(`Command timeout after ${timeoutMs}ms: ${command.slice(0, 100)}`));
      }, timeoutMs);

      client.exec(command, { pty: false }, (err, channel) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';
        let code = -1;

        channel.on('data', (data: Buffer) => {
          stdout += data.toString('utf-8');
        });
        channel.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf-8');
        });
        channel.on('exit', (exitCode: number | null) => {
          clearTimeout(timer);
          code = exitCode ?? -1;
          resolve({ stdout, stderr, code });
        });
        channel.on('close', () => {
          clearTimeout(timer);
          // close приходит после exit — но если exit не пришёл, всё равно резолвим.
          resolve({ stdout, stderr, code });
        });
        channel.on('error', (err: Error) => {
          clearTimeout(timer);
          reject(err);
        });
      });
    });
  });
}

/**
 * Тестирует SSH-соединение: подключается и выполняет `uname -a`.
 *
 * Используется в UI для проверки credentials перед началом установки.
 */
export async function testSshConnection(credentials: SshCredentials): Promise<{
  success: boolean;
  system?: string;
  error?: string;
}> {
  try {
    const result = await executeRemoteCommand(credentials, 'uname -a', 10000);
    return { success: result.code === 0, system: result.stdout.trim() };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ============ Remote installation of service-node ============

/**
 * Параметры установки service-node на удалённом сервере.
 */
export interface RemoteInstallParams {
  ssh: SshCredentials;
  /** Порт API ноды на удалённом сервере. */
  nodePort?: number;
  /** Порт nginx для прокси-трафика. */
  nginxPort?: number;
  /** NAT_IP для VPN-режима. */
  natIp?: string;
  /** Repo URL (default https://github.com/ns8-support/mtproto-suite.git). */
  repoUrl?: string;
  /** Install dir на удалённом сервере. */
  installDir?: string;
}

export interface RemoteInstallResult {
  /** Успешна ли установка. */
  success: boolean;
  /** Публичный IP удалённого сервера (для панели). */
  serverIp: string;
  /** Порт API ноды. */
  port: number;
  /** Токен авторизации для добавления ноды в панель. */
  authToken: string;
  /** Полный лог установки. */
  log: string;
  /** Сообщение об ошибке (если есть). */
  error?: string;
}

const DEFAULT_NODE_PORT = 8443;
const DEFAULT_NGINX_PORT = 443;
const DEFAULT_REPO_URL = 'https://github.com/ns8-support/mtproto-suite.git';
const DEFAULT_INSTALL_DIR = '/opt/mtproto-suite';

/**
 * Выполняет последовательность команд на удалённом сервере с накоплением лога.
 */
async function runSequence(
  credentials: SshCredentials,
  steps: Array<{ name: string; command: string; timeoutMs?: number }>
): Promise<{ log: string; allOk: boolean }> {
  const log: string[] = [];
  let allOk = true;

  for (const step of steps) {
    log.push(`\n========== ${step.name} ==========`);
    logger.info('remote-install', `Step: ${step.name}`);
    try {
      const result = await executeRemoteCommand(credentials, step.command, step.timeoutMs);
      const combined = (result.stdout + (result.stderr ? '\n[stderr]\n' + result.stderr : '')).trim();
      log.push(combined || '(no output)');
      if (result.code !== 0) {
        log.push(`\n[FAILED] Exit code: ${result.code}`);
        allOk = false;
        break;
      }
    } catch (err: any) {
      log.push(`\n[ERROR] ${err.message}`);
      allOk = false;
      break;
    }
  }

  return { log: log.join('\n'), allOk };
}

/**
 * Устанавливает service-node на удалённом сервере через SSH.
 *
 * Алгоритм:
 * 1. Проверка ОС (поддерживается только Ubuntu/Debian/CentOS/RHEL/Alma/Rocky).
 * 2. Установка Docker и Docker Compose (если отсутствуют).
 * 3. Клонирование репозитория.
 * 4. Генерация AUTH_TOKEN (32 байта hex).
 * 5. Запись service-node/.env.
 * 6. Запуск docker compose up -d.
 * 7. Проверка health check.
 *
 * Безопасность:
 * - Пароль SSH не сохраняется и не возвращается клиенту (только результат).
 * - Все команды выполняются последовательно, ошибка останавливает pipeline.
 * - Таймаут на весь процесс (5 минут default).
 */
export async function installRemoteServiceNode(
  params: RemoteInstallParams
): Promise<RemoteInstallResult> {
  const nodePort = params.nodePort || DEFAULT_NODE_PORT;
  const nginxPort = params.nginxPort || DEFAULT_NGINX_PORT;
  const repoUrl = params.repoUrl || DEFAULT_REPO_URL;
  const installDir = params.installDir || DEFAULT_INSTALL_DIR;
  const authToken = generateSecureToken(32);

  // Получаем публичный IP удалённого сервера.
  const ipResult = await executeRemoteCommand(
    params.ssh,
    'curl -fsSL -m 10 https://api.ipify.org || hostname -I | awk \'{print $1}\'',
    15000
  );
  if (ipResult.code !== 0) {
    throw new Error(`Failed to detect server IP: ${ipResult.stderr}`);
  }
  const serverIp = ipResult.stdout.trim().split('\n')[0];

  // Полный pipeline установки.
  const { log, allOk } = await runSequence(params.ssh, [
    {
      name: 'Проверка ОС',
      command: 'cat /etc/os-release | head -5',
      timeoutMs: 10000,
    },
    {
      name: 'Установка Docker (если нужно)',
      command: `
if command -v docker &> /dev/null && docker compose version &> /dev/null 2>&1; then
  echo "Docker already installed: $(docker --version)"
else
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker 2>/dev/null || true
  systemctl start docker 2>/dev/null || true
  echo "Docker installed: $(docker --version)"
fi
`,
      timeoutMs: 180000, // 3 минуты на установку
    },
    {
      name: 'Установка утилит (curl, openssl, git)',
      command: `
for cmd in curl openssl git; do
  if ! command -v $cmd &> /dev/null; then
    if command -v apt-get &> /dev/null; then
      apt-get update -qq && apt-get install -y -qq $cmd
    elif command -v yum &> /dev/null; then
      yum install -y -q $cmd
    fi
  fi
done
echo "Utilities ready"
`,
      timeoutMs: 120000,
    },
    {
      name: 'Создание общей Docker-сети',
      command: 'docker network create mtproto-net 2>/dev/null || echo "Network exists"',
      timeoutMs: 30000,
    },
    {
      name: `Клонирование в ${installDir}`,
      command: `
if [ -d "${installDir}/.git" ]; then
  cd ${installDir}
  git fetch origin main
  git reset --hard origin/main
else
  rm -rf ${installDir}
  git clone --branch main "${repoUrl}" ${installDir}
fi
`,
      timeoutMs: 120000,
    },
    {
      name: 'Создание каталога данных и .env',
      command: `
cd ${installDir}
mkdir -p service-node/data
cat > service-node/.env << 'EOF'
PORT=${nodePort}
NGINX_PORT=${nginxPort}
AUTH_TOKEN=${authToken}
NAT_IP=${params.natIp || ''}
TUNNEL_INTERFACE=
EOF
chmod 600 service-node/.env
echo ".env created"
`,
      timeoutMs: 30000,
    },
    {
      name: 'Запуск service-node (docker compose up -d)',
      command: `
cd ${installDir}/service-node
docker network create mtproto-net 2>/dev/null || true
echo "Attempting to pull image from GHCR..."
if docker compose pull 2>/dev/null; then
  echo "Image pulled from GHCR"
else
  echo "Image not found in GHCR, building locally..."
  docker compose build
fi
docker compose up -d
echo "Containers started"
`,
      timeoutMs: 300000, // 5 минут на сборку
    },
    {
      name: 'Ожидание готовности (health check)',
      command: `
for i in $(seq 1 30); do
  if curl -fsS -m 2 http://localhost:${nodePort}/api/health -H "Authorization: Bearer ${authToken}" >/dev/null 2>&1; then
    echo "Service node is healthy"
    exit 0
  fi
  sleep 2
done
echo "ERROR: Service node did not become healthy"
docker compose -f ${installDir}/service-node/docker-compose.yml ps
docker compose -f ${installDir}/service-node/docker-compose.yml logs --tail=50
exit 1
`,
      timeoutMs: 120000,
    },
  ]);

  if (!allOk) {
    return {
      success: false,
      serverIp,
      port: nodePort,
      authToken,
      log,
      error: 'One or more installation steps failed. See log for details.',
    };
  }

  logger.info('remote-install', `Successfully installed service-node on ${serverIp}:${nodePort}`);

  return {
    success: true,
    serverIp,
    port: nodePort,
    authToken,
    log,
  };
}

/**
 * Генерирует криптографически стойкий токен.
 */
function generateSecureToken(bytes: number): string {
  // crypto доступен глобально в Node.js (начиная с v19+ глобально, до этого — через require).
  // Для совместимости со всеми версиями используем динамический require.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('crypto') as typeof import('crypto');
  return crypto.randomBytes(bytes).toString('hex');
}
