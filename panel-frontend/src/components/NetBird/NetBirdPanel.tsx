import { useState, useEffect } from 'react';
import {
  getNetBirdStatus,
  installNetBird,
  uninstallNetBird,
  getPanelNetBirdStatus,
  installPanelNetBird,
  uninstallPanelNetBird,
  disconnectPanelNetBird,
  type SshCredentials,
} from '../../api/monitoring';
import type { NetBirdStatus } from '@mtproto-suite/shared/types';

/**
 * Панель управления NetBird на удалённой ноде.
 *
 * NetBird — это mesh VPN (WireGuard-based), который объединяет все ноды
 * в единую приватную сеть. После установки ноды доступны по внутренним IP
 * через mesh, без необходимости публичных IP.
 *
 * Использование:
 * 1. Получите setup key в NetBird dashboard (https://app.netbird.io)
 *    или self-hosted management server.
 * 2. Введите setup key здесь.
 * 3. Нажмите "Install & Connect" — клиент устанавливается и подключается.
 * 4. После успеха нода получит внутренний mesh IP и будет доступна через него.
 */

interface NetBirdPanelProps {
  /** ID ноды. Для сервера панели не передаётся (используются /api/panel/... эндпоинты). */
  nodeId?: number;
  nodeName: string;
  ssh: SshCredentials;
  initialStatus: NetBirdStatus | null;
  onStatusChange?: (status: NetBirdStatus | null) => void;
}

type Step = 'idle' | 'installing' | 'uninstalling' | 'error';

export function NetBirdPanel({ nodeId, nodeName, ssh, initialStatus, onStatusChange }: NetBirdPanelProps) {
  const isPanel = nodeId == null;
  const [status, setStatus] = useState<NetBirdStatus | null>(initialStatus);
  const [step, setStep] = useState<Step>('idle');
  const [setupKey, setSetupKey] = useState('');
  const [managementUrl, setManagementUrl] = useState('');
  const [hostname, setHostname] = useState(nodeName);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string | null>(null);

  useEffect(() => {
    if (initialStatus) {
      setStatus(initialStatus);
    }
  }, [initialStatus]);

  // Для сервера панели нет кешированного статуса в БД — подтягиваем при монтировании.
  useEffect(() => {
    if (isPanel && !initialStatus && ssh) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    setError(null);
    try {
      const newStatus = isPanel
        ? await getPanelNetBirdStatus(ssh)
        : await getNetBirdStatus(nodeId as number, ssh);
      setStatus(newStatus);
      if (onStatusChange) onStatusChange(newStatus);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleInstall = async () => {
    if (!setupKey) {
      setError('Setup key обязателен');
      return;
    }

    setStep('installing');
    setError(null);
    setLog(null);

    try {
      const payload = {
        setupKey,
        managementUrl: managementUrl || undefined,
        hostname: hostname || undefined,
      };
      const result = isPanel
        ? await installPanelNetBird(ssh, payload)
        : await installNetBird(nodeId as number, ssh, payload);

      setLog(result.log);

      if (result.success && result.status) {
        setStatus(result.status);
        if (onStatusChange) onStatusChange(result.status);
        setSetupKey(''); // Очищаем setup key после использования
        setStep('idle');
      } else {
        setError(result.error || 'Installation failed');
        setStep('error');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
      setStep('error');
    }
  };

  const handleUninstall = async () => {
    if (!confirm(`Удалить NetBird с ${isPanel ? 'сервера панели' : `ноды ${nodeName}`}?`)) return;

    setStep('uninstalling');
    setError(null);
    try {
      if (isPanel) {
        await uninstallPanelNetBird(ssh);
      } else {
        await uninstallNetBird(nodeId as number, ssh);
      }
      setStatus(null);
      if (onStatusChange) onStatusChange(null);
      setStep('idle');
    } catch (err: any) {
      setError(err.message || 'Network error');
      setStep('error');
    }
  };

  const handleDisconnect = async () => {
    setStep('uninstalling');
    setError(null);
    try {
      await disconnectPanelNetBird(ssh);
      await refresh();
      setStep('idle');
    } catch (err: any) {
      setError(err.message || 'Network error');
      setStep('error');
    }
  };

  if (!status?.installed) {
    return (
      <div className="netbird-panel">
        <h3>🔒 NetBird VPN</h3>

        <div className="info-banner">
          <strong>Что такое NetBird?</strong>
          <p>
            NetBird объединяет все ноды в единую mesh-сеть через WireGuard.
            После установки ноды доступны по внутренним IP через панель,
            даже если находятся за NAT или firewall.
          </p>
        </div>

        {!status?.installed && (
          <>
            <label>
              <span>Setup Key</span>
              <input
                type="password"
                value={setupKey}
                onChange={(e) => setSetupKey(e.target.value)}
                placeholder="NETBIRD-SETUP-KEY-XXXXX"
                autoComplete="off"
              />
              <small>
                Получите в{' '}
                <a href="https://app.netbird.io/setup-keys" target="_blank" rel="noreferrer">
                  NetBird dashboard
                </a>{' '}
                или в вашем self-hosted management server
              </small>
            </label>

            <label>
              <span>Management URL (опционально)</span>
              <input
                type="text"
                value={managementUrl}
                onChange={(e) => setManagementUrl(e.target.value)}
                placeholder="https://netbird.example.com"
              />
              <small>Для self-hosted. Оставьте пустым для SaaS (netbird.io)</small>
            </label>

            <label>
              <span>Hostname в mesh</span>
              <input
                type="text"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
              />
              <small>Имя этой ноды в mesh-сети (по умолчанию — {nodeName})</small>
            </label>

            {error && <div className="error-banner">{error}</div>}

            <button
              onClick={handleInstall}
              disabled={step === 'installing' || !setupKey}
              className="btn-primary"
            >
              {step === 'installing' ? '⏳ Установка...' : '🚀 Install & Connect'}
            </button>

            {log && (
              <details>
                <summary>Лог установки</summary>
                <pre>{log}</pre>
              </details>
            )}
          </>
        )}
      </div>
    );
  }

  // Статус установлен — показываем детали.
  return (
    <div className="netbird-panel">
      <h3>🔒 NetBird VPN</h3>

      <div className="netbird-status">
        <div>
          <strong>Статус:</strong>{' '}
          {status.connected ? (
            <span className="badge badge-success">✓ Подключён</span>
          ) : (
            <span className="badge badge-warning">⚠ Установлен, но не подключён</span>
          )}
        </div>
        {status.meshIp && (
          <div>
            <strong>Mesh IP:</strong> <code>{status.meshIp}</code>
          </div>
        )}
        {status.peerName && (
          <div>
            <strong>Peer name:</strong> <code>{status.peerName}</code>
          </div>
        )}
        {status.managementUrl && (
          <div>
            <strong>Management:</strong> <code>{status.managementUrl}</code>
          </div>
        )}
        {status.version && (
          <div>
            <strong>Версия:</strong> <code>{status.version}</code>
          </div>
        )}
      </div>

      {status.peers.length > 0 && (
        <div className="netbird-peers">
          <h4>Другие ноды в mesh ({status.peers.length}):</h4>
          <table>
            <thead>
              <tr>
                <th>Имя</th>
                <th>Mesh IP</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {status.peers.map((peer) => (
                <tr key={peer.name + peer.ip}>
                  <td><code>{peer.name}</code></td>
                  <td><code>{peer.ip}</code></td>
                  <td>
                    {peer.connected ? (
                      <span className="badge badge-success">online</span>
                    ) : (
                      <span className="badge badge-warning">offline</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="action-buttons">
        {isPanel && status.connected && (
          <button
            onClick={handleDisconnect}
            disabled={step === 'uninstalling'}
            className="btn-secondary"
          >
            {step === 'uninstalling' ? '⏳ Disconnecting...' : '🔌 Disconnect'}
          </button>
        )}
        <button onClick={refresh} className="btn-secondary">
          🔄 Refresh
        </button>
        <button onClick={handleUninstall} disabled={step === 'uninstalling'} className="btn-danger">
          {step === 'uninstalling' ? '⏳ Uninstalling...' : '🗑️ Uninstall'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
