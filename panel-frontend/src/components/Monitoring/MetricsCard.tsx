import type { NodeMetrics } from '@mtproto-suite/shared/types';

/**
 * Карточка с основными метриками ноды.
 *
 * Отображает:
 * - CPU usage (с цветовой индикацией)
 * - RAM usage
 * - Disk usage (для каждого диска)
 * - Количество работающих контейнеров
 * - Uptime
 */

interface MetricsCardProps {
  metrics: NodeMetrics;
}

function getUsageColor(percent: number): string {
  if (percent >= 90) return '#dc3545'; // красный
  if (percent >= 75) return '#fd7e14'; // оранжевый
  if (percent >= 50) return '#ffc107'; // жёлтый
  return '#28a745'; // зелёный
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

export function MetricsCard({ metrics }: MetricsCardProps) {
  const { cpu, memory, disks, containers } = metrics;
  const runningContainers = containers.filter((c) => c.status.includes('Up')).length;

  return (
    <div className="metrics-card">
      <h3>Состояние системы</h3>

      <div className="metric-row">
        <div className="metric-label">
          <strong>CPU</strong>
          <span className="metric-detail">{cpu.cores} ядер · load {cpu.loadAvg1.toFixed(2)}</span>
        </div>
        <div className="metric-bar-container">
          <div
            className="metric-bar"
            style={{
              width: `${Math.min(cpu.usagePercent, 100)}%`,
              backgroundColor: getUsageColor(cpu.usagePercent),
            }}
          />
        </div>
        <div className="metric-value" style={{ color: getUsageColor(cpu.usagePercent) }}>
          {cpu.usagePercent.toFixed(1)}%
        </div>
      </div>

      <div className="metric-row">
        <div className="metric-label">
          <strong>RAM</strong>
          <span className="metric-detail">
            {formatBytes(memory.usedBytes)} / {formatBytes(memory.totalBytes)}
          </span>
        </div>
        <div className="metric-bar-container">
          <div
            className="metric-bar"
            style={{
              width: `${Math.min(memory.usagePercent, 100)}%`,
              backgroundColor: getUsageColor(memory.usagePercent),
            }}
          />
        </div>
        <div className="metric-value" style={{ color: getUsageColor(memory.usagePercent) }}>
          {memory.usagePercent.toFixed(1)}%
        </div>
      </div>

      {disks.map((disk) => (
        <div className="metric-row" key={disk.mountPoint}>
          <div className="metric-label">
            <strong>💾 {disk.mountPoint}</strong>
            <span className="metric-detail">
              {formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)} · {disk.filesystem}
            </span>
          </div>
          <div className="metric-bar-container">
            <div
              className="metric-bar"
              style={{
                width: `${Math.min(disk.usagePercent, 100)}%`,
                backgroundColor: getUsageColor(disk.usagePercent),
              }}
            />
          </div>
          <div className="metric-value" style={{ color: getUsageColor(disk.usagePercent) }}>
            {disk.usagePercent.toFixed(1)}%
          </div>
        </div>
      ))}

      <div className="metric-summary">
        <div>
          <strong>🐳 Контейнеры:</strong> {runningContainers} работает из {containers.length}
        </div>
      </div>

      {cpu.model && (
        <div className="metric-summary">
          <div>
            <strong>Процессор:</strong> <code>{cpu.model}</code>
          </div>
        </div>
      )}
    </div>
  );
}
