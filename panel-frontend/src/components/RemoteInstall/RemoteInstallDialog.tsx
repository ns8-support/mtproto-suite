import { useState } from 'react';
import {
  testSsh,
  installRemoteNode,
  type SshTestRequest,
  type RemoteInstallResult,
} from '../../api/remote-install';
import { addNode } from '../../api';

/**
 * Диалог для удалённой установки service-node.
 *
 * Использование:
 *   <RemoteInstallDialog onSuccess={(result) => addNode(...)} />
 *
 * UX flow:
 * 1. Пользователь вводит SSH credentials (host, port, user, password или privateKey).
 * 2. Нажимает "Test Connection" — проверяется SSH доступ.
 * 3. Настраивает nodePort, nginxPort, NAT_IP.
 * 4. Нажимает "Install" — запускается установка с прогрессом.
 * 5. После успеха показываются IP, port, token + опция "Add as Node".
 */

interface RemoteInstallDialogProps {
  onClose: () => void;
  onSuccess?: (result: RemoteInstallResult) => void;
}

type AuthMethod = 'password' | 'key';

interface FormState {
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  password: string;
  privateKey: string;
  passphrase: string;
  nodePort: number;
  nginxPort: number;
  natIp: string;
}

const INITIAL_STATE: FormState = {
  host: '',
  port: 22,
  username: 'root',
  authMethod: 'password',
  password: '',
  privateKey: '',
  passphrase: '',
  nodePort: 8443,
  nginxPort: 443,
  natIp: '',
};

type Step = 'form' | 'testing' | 'installing' | 'success' | 'error';

export function RemoteInstallDialog({ onClose, onSuccess }: RemoteInstallDialogProps) {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [step, setStep] = useState<Step>('form');
  const [system, setSystem] = useState<string | null>(null);
  const [result, setResult] = useState<RemoteInstallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleTest = async () => {
    setStep('testing');
    setError(null);
    setSystem(null);

    const payload: SshTestRequest = {
      host: form.host.trim(),
      port: form.port,
      username: form.username.trim(),
    };
    if (form.authMethod === 'password') {
      payload.password = form.password;
    } else {
      payload.privateKey = form.privateKey;
      if (form.passphrase) payload.passphrase = form.passphrase;
    }

    try {
      const result = await testSsh(payload);
      if (result.success) {
        setSystem(result.system || 'unknown');
        setStep('form');
      } else {
        setError(result.error || 'SSH test failed');
        setStep('error');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
      setStep('error');
    }
  };

  const handleInstall = async () => {
    setStep('installing');
    setError(null);

    const payload: SshTestRequest = {
      host: form.host.trim(),
      port: form.port,
      username: form.username.trim(),
    };
    if (form.authMethod === 'password') {
      payload.password = form.password;
    } else {
      payload.privateKey = form.privateKey;
      if (form.passphrase) payload.passphrase = form.passphrase;
    }

    try {
      const installResult = await installRemoteNode({
        ssh: payload,
        nodePort: form.nodePort,
        nginxPort: form.nginxPort,
        natIp: form.natIp.trim() || undefined,
      });
      setResult(installResult);
      if (installResult.success) {
        setStep('success');
        if (onSuccess) onSuccess(installResult);
      } else {
        setError(installResult.error || 'Installation failed');
        setStep('error');
      }
    } catch (err: any) {
      setError(err.message || 'Installation error');
      setStep('error');
    }
  };

  const handleAddAsNode = async () => {
    if (!result || !result.success) return;
    try {
      await addNode({
        name: `Node ${result.serverIp}`,
        ip: result.serverIp,
        port: result.port,
        token: result.authToken,
      });
      setAdded(true);
    } catch (err: any) {
      setError(`Failed to add node: ${err.message}`);
    }
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-content remote-install-dialog">
        <div className="dialog-header">
          <h2>Удалённая установка service-node</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {step === 'form' && (
          <>
            <div className="form-section">
              <h3>SSH доступ</h3>

              <label>
                <span>Хост (IP или домен)</span>
                <input
                  type="text"
                  value={form.host}
                  onChange={(e) => updateField('host', e.target.value)}
                  placeholder="192.168.1.100 или node1.example.com"
                />
              </label>

              <label>
                <span>SSH порт</span>
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
                  placeholder="root"
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
                <label>
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
                  <label>
                    <span>Private Key (OpenSSH формат)</span>
                    <textarea
                      value={form.privateKey}
                      onChange={(e) => updateField('privateKey', e.target.value)}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                      rows={8}
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

              {system && (
                <div className="success-banner">
                  ✓ Соединение установлено: <code>{system}</code>
                </div>
              )}

              <button
                type="button"
                onClick={handleTest}
                disabled={!form.host || !form.username || (form.authMethod === 'password' ? !form.password : !form.privateKey)}
                className="btn-secondary"
              >
                🔌 Проверить соединение
              </button>
            </div>

            <div className="form-section">
              <h3>Параметры service-node</h3>

              <label>
                <span>Порт API ноды</span>
                <input
                  type="number"
                  value={form.nodePort}
                  onChange={(e) => updateField('nodePort', parseInt(e.target.value) || 8443)}
                  min={1}
                  max={65535}
                />
              </label>

              <label>
                <span>Порт прокси (nginx)</span>
                <input
                  type="number"
                  value={form.nginxPort}
                  onChange={(e) => updateField('nginxPort', parseInt(e.target.value) || 443)}
                  min={1}
                  max={65535}
                />
              </label>

              <label>
                <span>NAT_IP (опционально, для VPN)</span>
                <input
                  type="text"
                  value={form.natIp}
                  onChange={(e) => updateField('natIp', e.target.value)}
                  placeholder="Публичный IP VPN-сервера"
                />
              </label>
            </div>

            <div className="dialog-footer">
              <button onClick={onClose} className="btn-secondary">Отмена</button>
              <button
                onClick={handleInstall}
                disabled={!form.host || !form.username || (form.authMethod === 'password' ? !form.password : !form.privateKey)}
                className="btn-primary"
              >
                🚀 Установить
              </button>
            </div>
          </>
        )}

        {step === 'testing' && (
          <div className="progress-state">
            <div className="spinner"></div>
            <p>Проверка SSH соединения...</p>
          </div>
        )}

        {step === 'installing' && (
          <div className="progress-state">
            <div className="spinner"></div>
            <p>Установка service-node на удалённом сервере...</p>
            <p className="hint">Это может занять несколько минут.</p>
          </div>
        )}

        {step === 'error' && (
          <div className="error-state">
            <h3>Ошибка</h3>
            <div className="error-message">{error}</div>
            {result?.log && (
              <details>
                <summary>Лог установки</summary>
                <pre className="install-log">{result.log}</pre>
              </details>
            )}
            <button onClick={() => setStep('form')} className="btn-secondary">
              ← Назад
            </button>
          </div>
        )}

        {step === 'success' && result && (
          <div className="success-state">
            <h3>✓ Установка завершена успешно</h3>

            <div className="result-fields">
              <div>
                <strong>IP сервера:</strong> <code>{result.serverIp}</code>
              </div>
              <div>
                <strong>API порт:</strong> <code>{result.port}</code>
              </div>
              <div>
                <strong>Токен:</strong> <code className="token">{result.authToken}</code>
              </div>
            </div>

            <details>
              <summary>Полный лог установки</summary>
              <pre className="install-log">{result.log}</pre>
            </details>

            <div className="dialog-footer">
              {!added ? (
                <button onClick={handleAddAsNode} className="btn-primary">
                  + Добавить как ноду в панель
                </button>
              ) : (
                <div className="success-banner">✓ Нода добавлена в панель</div>
              )}
              <button onClick={onClose} className="btn-secondary">Закрыть</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
