import type { SystemInfo } from '@mtproto-suite/shared/types';

/**
 * Карточка с информацией о системе.
 */

interface SystemInfoCardProps {
  info: SystemInfo;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

export function SystemInfoCard({ info }: SystemInfoCardProps) {
  return (
    <div className="system-info-card">
      <h3>Информация о системе</h3>

      <table className="info-table">
        <tbody>
          <tr>
            <td><strong>Hostname</strong></td>
            <td><code>{info.hostname}</code></td>
          </tr>
          <tr>
            <td><strong>ОС</strong></td>
            <td>
              <code>{info.os}</code>
              {info.osVersion && <span className="muted"> {info.osVersion}</span>}
            </td>
          </tr>
          <tr>
            <td><strong>Ядро</strong></td>
            <td><code>{info.kernel}</code></td>
          </tr>
          <tr>
            <td><strong>Архитектура</strong></td>
            <td><code>{info.arch}</code></td>
          </tr>
          <tr>
            <td><strong>Аптайм</strong></td>
            <td><code>{formatUptime(info.uptimeSeconds)}</code></td>
          </tr>
          <tr>
            <td><strong>Текущее время</strong></td>
            <td><code>{new Date(info.currentTime).toLocaleString('ru-RU')}</code></td>
          </tr>
        </tbody>
      </table>

      {info.ipAddresses.length > 0 && (
        <div className="ip-list">
          <strong>IP адреса:</strong>
          <ul>
            {info.ipAddresses.map((ip) => (
              <li key={ip}>
                <code>{ip}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
