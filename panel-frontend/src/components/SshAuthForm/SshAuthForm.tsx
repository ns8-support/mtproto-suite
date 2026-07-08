import { useState } from 'react';
import type { SshCredentials } from '../../api/monitoring';

/**
 * Переиспользуемая форма SSH-авторизации.
 *
 * Сообщает валидные креды наверх через `onChange` (при каждом изменении)
 * и/или `onSubmit` (при нажатии кнопки). Используется и на странице ноды,
 * и на странице сервера панели.
 */

interface SshAuthFormProps {
  initialHost?: string;
  submitLabel?: string;
  /** Вызывается при изменении полей, если креды валидны (иначе null). */
  onChange?: (creds: SshCredentials | null) => void;
  /** Вызывается при нажатии кнопки, если креды валидны. */
  onSubmit?: (creds: SshCredentials) => void;
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
}

const INITIAL: FormState = {
  host: '',
  port: 22,
  username: 'root',
  authMethod: 'password',
  password: '',
  privateKey: '',
  passphrase: '',
};

export function SshAuthForm({
  initialHost = '',
  submitLabel = 'Сохранить',
  onChange,
  onSubmit,
}: SshAuthFormProps) {
  const [form, setForm] = useState<FormState>({ ...INITIAL, host: initialHost });
  const [error, setError] = useState<string | null>(null);

  const build = (): SshCredentials | null => {
    if (!form.host.trim() || !form.username.trim()) return null;
    if (form.authMethod === 'password' && !form.password) return null;
    if (form.authMethod === 'key' && !form.privateKey.trim()) return null;
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

  const update = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError(null);
    onChange?.(build());
  };

  const handleSubmit = () => {
    const creds = build();
    if (!creds) {
      setError('Заполните хост, пользователя и способ авторизации');
      return;
    }
    onSubmit?.(creds);
  };

  return (
    <div className="ssh-auth-form">
      <h2>🔐 SSH доступ к серверу панели</h2>
      <p>
        Укажите SSH-креды хоста, где установлена панель (обычно <code>localhost</code> или
        локальный IP сервера). Они нужны для установки NetBird и сбора информации о системе.
      </p>

      <div className="form-grid">
        <label>
          <span>Хост</span>
          <input
            type="text"
            value={form.host}
            onChange={(e) => update({ host: e.target.value })}
            placeholder="localhost или 192.168.1.10"
          />
        </label>

        <label>
          <span>Порт SSH</span>
          <input
            type="number"
            value={form.port}
            min={1}
            max={65535}
            onChange={(e) => update({ port: parseInt(e.target.value, 10) || 22 })}
          />
        </label>

        <label>
          <span>Пользователь</span>
          <input
            type="text"
            value={form.username}
            onChange={(e) => update({ username: e.target.value })}
            placeholder="root"
          />
        </label>

        <div className="auth-method-selector">
          <label>
            <input
              type="radio"
              checked={form.authMethod === 'password'}
              onChange={() => update({ authMethod: 'password' })}
            />
            Пароль
          </label>
          <label>
            <input
              type="radio"
              checked={form.authMethod === 'key'}
              onChange={() => update({ authMethod: 'key' })}
            />
            SSH ключ
          </label>
        </div>

        {form.authMethod === 'password' ? (
          <label>
            <span>Пароль</span>
            <input
              type="password"
              autoComplete="off"
              value={form.password}
              onChange={(e) => update({ password: e.target.value })}
            />
          </label>
        ) : (
          <>
            <label>
              <span>Private Key (OpenSSH формат)</span>
              <textarea
                rows={6}
                value={form.privateKey}
                onChange={(e) => update({ privateKey: e.target.value })}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              />
            </label>
            <label>
              <span>Passphrase (если есть)</span>
              <input
                type="password"
                autoComplete="off"
                value={form.passphrase}
                onChange={(e) => update({ passphrase: e.target.value })}
              />
            </label>
          </>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {onSubmit && (
        <button type="button" className="btn-primary" onClick={handleSubmit}>
          {submitLabel}
        </button>
      )}
    </div>
  );
}
