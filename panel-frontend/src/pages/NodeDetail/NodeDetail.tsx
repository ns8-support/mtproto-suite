import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  getMetrics,
  getMetricsHistory,
  getSystemInfo,
  getNetBirdCachedStatus,
  type SshCredentials,
} from '../../api/monitoring';
import type {
  NodeMetrics,
  SystemInfo,
  MetricsHistoryPoint,
  NetBirdStatus,
} from '@mtproto-suite/shared/types';
import { MetricsCard } from '../../components/Monitoring/MetricsCard';
import { SystemInfoCard } from '../../components/Monitoring/SystemInfoCard';
import { MetricsChart } from '../../components/Monitoring/MetricsChart';
import { ActionPanel } from '../../components/Monitoring/ActionPanel';
import { NetBirdPanel } from '../../components/NetBird/NetBirdPanel';

/**
 * Страница детальной информации о ноде.
 *
 * Включает:
 * - Информация о системе (OS, kernel, hostname, IP)
 * - Метрики в реальном времени (CPU, RAM, Disk, контейнеры)
 * - График истории (CPU, RAM, Disk)
 * - Действия (restart service, reboot server)
 * - Статус и установка NetBird
 *
 * Требования:
 * - Пользователь должен ввести SSH credentials (либо из памяти, либо заново).
 * - Метрики собираются через SSH команды.
 * - История хранится в БД панели.
 *
 * Безопасность: SSH credentials не сохраняются, передаются только в текущей сессии.
 */

type AuthMethod = 'password' | 'key';

interface SshFormState {
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  password: string;
  privateKey: string;
  passphrase: string;
}

const INITIAL_FORM: SshFormState = {
  host: '',
  port: 22,
  username: 'root',
  authMethod: 'password',
  password: '',
  privateKey: '',
  passphrase: '',
};

export function NodeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const nodeId = parseInt(id || '0', 10);

  // SSH форма.
  const [form, setForm] = useState<SshFormState>(INITIAL_FORM);
  const [authAttempted, setAuthAttempted] = useState(false);
  const [showSshForm, setShowSshForm] = useState(true);

  // Данные мониторинга.
  const [metrics, setMetrics] = useState<NodeMetrics | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [history, setHistory] = useState<MetricsHistoryPoint[]>([]);
  const [netbirdStatus, setNetbirdStatus] = useState<NetBirdStatus | null>(null);

  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(10000); // 10 сек

  // История из БД загружается один раз (без SSH).
  useEffect(() => {
    if (!nodeId) return;
    getMetricsHistory(nodeId, '1h')
      .then(setHistory)
      .catch(() => undefined);
    getNetBirdCachedStatus(nodeId)
      .then((status) => {
        if (status) setNetbirdStatus(status);
      })
      .catch(() => undefined);
  }, [nodeId]);

  const updateField = <K extends keyof SshFormState>(key: K, value: SshFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const buildSshCredentials = (): SshCredentials => {
    const creds: SshCredentials = {
      host: form.host.trim(),
      port: form.port,
      username: form.username.trim(),
    };
    if (form.authMethod === 'password') {
      creds.password = form.password;
    } else {
      creds.privateKey = form.privateKey;
      if (form.passphrase) creds.passphrase = form.passphrase;
    }
    return creds;
  };

  const collectAllData = async () => {
    if (!form.host || !form.username) return;
    if (form.authMethod === 'password' && !form.password) return;
    if (form.authMethod === 'key' && !form.privateKey) return;

    const ssh = buildSshCredentials();
    setLoadingMetrics(true);
    setError(null);

    try {
      const [metricsRes, infoRes] = await Promise.all([
        getMetrics(nodeId, { ssh }),
        getSystemInfo(nodeId, ssh).catch(() => null),
      ]);
      setMetrics(metricsRes);
      if (metricsRes.history) setHistory(metricsRes.history);
      if (infoRes) setSystemInfo(infoRes);
      setShowSshForm(false);
      setAuthAttempted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to collect metrics');
    } finally {
      setLoadingMetrics(false);
    }
  };

  // Авто-обновление метрик.
  useEffect(() => {
    if (!authAttempted || refreshInterval === 0) return;
    const interval = setInterval(() => {
      collectAllData().catch(() => undefined);
    }, refreshInterval);
    return () => clearInterval(interval);
  }, [authAttempted, refreshInterval]);

  const refreshHistory = async (range: '1h' | '6h' | '24h' | '7d') => {
    setLoadingHistory(true);
    try {
      const newHistory = await getMetricsHistory(nodeId, range);
      setHistory(newHistory);
    } catch (err: any) {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  };

  if (showSshForm) {
    return (
      <div className="node-detail-page">
        <h1>Нода #{nodeId}</h1>

        <div className="ssh-auth-form">
          <h2>🔐 SSH Авторизация</h2>
          <p>Для сбора метрик и управления нодой требуется SSH доступ.</p>

          <div className="form-grid">
            <label>
              <span>Хост</span>
              <input
                type="text"
                value={form.host}
                onChange={(e) => updateField('host', e.target.value)}
                placeholder="IP или домен"
              />
            </label>

            <label>
              <span>Порт</span>
              <input
                type="number"
                value={form.port}
                onChange={(e) => updateField('port', parseInt(e.target.value) || 22)}
                min={1}
                max={65535}
              />
            </label>

            <label>
              <span>Пользователь</span>
              <input
                type="text"
                value={form.username}
                onChange={(e) => updateField('username', e.target.value)}
              />
            </label>

            <div className="auth-method-selector">
              <label>
                <input
                  type="radio"
                  checked={form.authMethod === 'password'}
                  onChange={() => updateField('authMethod', 'password')}
                />
                Пароль
              </label>
              <label>
                <input
                  type="radio"
                  checked={form.authMethod === 'key'}
                  onChange={() => updateField('authMethod', 'key')}
                />
                SSH ключ
              </label>
            </div>

            {form.authMethod === 'password' ? (
              <label className="full-width">
                <span>Пароль</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => updateField('password', e.target.value)}
                  autoComplete="off"
                />
              </label>
            ) : (
              <>
                <label className="full-width">
                  <span>Private Key</span>
                  <textarea
                    value={form.privateKey}
                    onChange={(e) => updateField('privateKey', e.target.value)}
                    rows={6}
                  />
                </label>
                <label>
                  <span>Passphrase (если есть)</span>
                  <input
                    type="password"
                    value={form.passphrase}
                    onChange={(e) => updateField('passphrase', e.target.value)}
                    autoComplete="off"
                  />
                </label>
              </>
            )}
          </div>

          {error && <div className="error-banner">{error}</div>}

          <button
            onClick={collectAllData}
            disabled={loadingMetrics}
            className="btn-primary"
          >
            {loadingMetrics ? '⏳ Подключение...' : '🔌 Подключиться и собрать метрики'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="node-detail-page">
      <div className="page-header">
        <h1>Нода #{nodeId}</h1>
        <div className="header-controls">
          <label>
            <span>Авто-обновление:</span>
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(parseInt(e.target.value, 10))}
            >
              <option value={5000}>5 сек</option>
              <option value={10000}>10 сек</option>
              <option value={30000}>30 сек</option>
              <option value={60000}>1 мин</option>
              <option value={0}>Выкл</option>
            </select>
          </label>
          <button onClick={() => setShowSshForm(true)} className="btn-secondary">
            🔐 Сменить SSH credentials
          </button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {metrics && (
        <div className="metrics-grid">
          <MetricsCard metrics={metrics} />
          {systemInfo && <SystemInfoCard info={systemInfo} />}
        </div>
      )}

      <div className="history-section">
        <h3>История метрик</h3>
        <div className="history-controls">
          {(['1h', '6h', '24h', '7d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => refreshHistory(range)}
              disabled={loadingHistory}
              className="btn-secondary"
            >
              {range}
            </button>
          ))}
        </div>
        <MetricsChart history={history} height={250} />
      </div>

      <div className="control-panels">
        <ActionPanel
          nodeId={nodeId}
          nodeName={metrics?.cpu.model || `Node ${nodeId}`}
          ssh={buildSshCredentials()}
        />

        <NetBirdPanel
          nodeId={nodeId}
          nodeName={`node-${nodeId}`}
          ssh={buildSshCredentials()}
          initialStatus={netbirdStatus}
          onStatusChange={setNetbirdStatus}
        />
      </div>
    </div>
  );
}
