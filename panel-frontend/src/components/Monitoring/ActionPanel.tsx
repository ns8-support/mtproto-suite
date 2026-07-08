import { useState } from 'react';
import {
  restartService,
  rebootServer,
  type SshCredentials,
  type RestartResult,
} from '../../api/monitoring';

/**
 * Панель действий с удалённой нодой.
 *
 * Действия:
 * - 🔄 Restart service — перезапуск service-node (безопасно)
 * - 🔌 Reboot server — перезагрузка ОС (требует подтверждения)
 */

interface ActionPanelProps {
  nodeId: number;
  nodeName: string;
  ssh: SshCredentials;
  onSuccess?: (action: string, result: RestartResult) => void;
}

type Action = 'restart' | 'reboot' | null;

export function ActionPanel({ nodeId, nodeName, ssh, onSuccess }: ActionPanelProps) {
  const [running, setRunning] = useState<Action>(null);
  const [result, setResult] = useState<RestartResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReboot, setConfirmReboot] = useState(false);
  const [rebootText, setRebootText] = useState('');

  const handleRestart = async () => {
    if (running) return;
    setRunning('restart');
    setError(null);
    setResult(null);

    try {
      const result = await restartService(nodeId, ssh);
      setResult(result);
      if (onSuccess) onSuccess('restart', result);
      if (!result.success) {
        setError(result.error || 'Restart failed');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setRunning(null);
    }
  };

  const handleReboot = async () => {
    if (running) return;
    if (!confirmReboot) {
      setConfirmReboot(true);
      return;
    }
    if (rebootText !== nodeName) {
      setError(`Введите имя ноды "${nodeName}" для подтверждения`);
      return;
    }

    setRunning('reboot');
    setError(null);
    setResult(null);

    try {
      const result = await rebootServer(nodeId, ssh);
      setResult(result);
      if (onSuccess) onSuccess('reboot', result);
      if (!result.success) {
        setError(result.error || 'Reboot failed');
      }
      setConfirmReboot(false);
      setRebootText('');
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="action-panel">
      <h3>Действия</h3>

      <div className="action-buttons">
        <button
          onClick={handleRestart}
          disabled={!!running}
          className="btn-action btn-secondary"
        >
          {running === 'restart' ? '⏳ Restarting...' : '🔄 Restart service'}
        </button>

        <button
          onClick={handleReboot}
          disabled={!!running}
          className="btn-action btn-danger"
        >
          {running === 'reboot' ? '⏳ Rebooting...' : '🔌 Reboot server'}
        </button>
      </div>

      {confirmReboot && (
        <div className="reboot-confirm">
          <div className="warning-banner">
            ⚠️ <strong>ВНИМАНИЕ:</strong> Это перезагрузит ОС на удалённом сервере.
            Все запущенные процессы будут остановлены. Соединение с нодой пропадёт на 1-3 минуты.
          </div>

          <p>
            Для подтверждения введите имя ноды <code>{nodeName}</code>:
          </p>
          <input
            type="text"
            value={rebootText}
            onChange={(e) => setRebootText(e.target.value)}
            placeholder={nodeName}
            className="reboot-input"
          />

          <div className="confirm-actions">
            <button
              onClick={handleReboot}
              disabled={rebootText !== nodeName}
              className="btn-action btn-danger"
            >
              Подтвердить reboot
            </button>
            <button
              onClick={() => {
                setConfirmReboot(false);
                setRebootText('');
              }}
              className="btn-secondary"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {result && (
        <details className="action-log">
          <summary>
            {result.success ? '✓ Успешно' : '✗ Ошибка'} — кликните для просмотра лога
          </summary>
          <pre>{result.log}</pre>
        </details>
      )}
    </div>
  );
}
