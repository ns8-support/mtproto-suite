import { useState } from 'react';
import { SshAuthForm } from '../../components/SshAuthForm/SshAuthForm';
import { NetBirdPanel } from '../../components/NetBird/NetBirdPanel';
import { getPanelSystemInfo, type SshCredentials } from '../../api/monitoring';
import type { NetBirdStatus, SystemInfo } from '@mtproto-suite/shared/types';

/**
 * Страница «Сервер панели».
 *
 * Позволяет подключиться по SSH к хосту, где установлена панель, и:
 * - посмотреть информацию о системе (ОС, ядро, uptime, IP);
 * - установить и настроить NetBird (mesh VPN) на этом сервере.
 *
 * В отличие от нод, сервер панели не хранится в БД — доступ только по SSH.
 */

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}д`);
  if (h) parts.push(`${h}ч`);
  if (m) parts.push(`${m}м`);
  return parts.join(' ') || '0м';
}

export function PanelServerPage() {
  const [savedSsh, setSavedSsh] = useState<SshCredentials | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [netbirdStatus, setNetbirdStatus] = useState<NetBirdStatus | null>(null);

  const handleSubmit = async (creds: SshCredentials) => {
    setSavedSsh(creds);
    setInfoError(null);
    setSystemInfo(null);
    try {
      const info = await getPanelSystemInfo(creds);
      setSystemInfo(info);
    } catch (err: any) {
      setInfoError(err.message || 'Не удалось получить информацию о системе');
    }
  };

  return (
    <div className="panel-server-page">
      <div className="page-header">
        <h1>Сервер панели</h1>
      </div>

      <p className="hint">
        Подключитесь по SSH к хосту, где запущена панель (обычно <code>localhost</code> или его
        локальный IP), чтобы установить и настроить NetBird, а также посмотреть информацию о
        системе. Это объединит сервер панели и ноды в единую mesh-сеть.
      </p>

      <SshAuthForm onSubmit={handleSubmit} submitLabel="Подключить" />

      {infoError && <div className="error-banner">{infoError}</div>}

      {systemInfo && (
        <div className="system-info-card">
          <h3>ℹ️ Система</h3>
          <div className="info-table">
            <div>
              <strong>Хост:</strong> <code>{systemInfo.hostname}</code>
            </div>
            <div>
              <strong>ОС:</strong> {systemInfo.os} {systemInfo.osVersion}
            </div>
            <div>
              <strong>Ядро:</strong> <code>{systemInfo.kernel}</code>
            </div>
            <div>
              <strong>Архитектура:</strong> {systemInfo.arch}
            </div>
            <div>
              <strong>Аптайм:</strong> {formatUptime(systemInfo.uptimeSeconds)}
            </div>
            <div>
              <strong>IP адреса:</strong>{' '}
              {systemInfo.ipAddresses.map((ip: string) => (
                <code key={ip} style={{ marginRight: 6 }}>
                  {ip}
                </code>
              ))}
            </div>
          </div>
        </div>
      )}

      {savedSsh && (
        <NetBirdPanel
          nodeId={undefined}
          nodeName="panel-server"
          ssh={savedSsh}
          initialStatus={netbirdStatus}
          onStatusChange={setNetbirdStatus}
        />
      )}
    </div>
  );
}
