import { useState } from 'react';
import { addNode, checkNodeHealth, type NodeInfo } from '../../api';

/**
 * Диалог добавления уже установленного (существующего) service-node.
 *
 * Пользователь вводит IP, порт API и токен ноды (плюс опционально имя и домен).
 * Перед добавлением можно проверить доступность ноды через /api/nodes/check-health.
 *
 * Использование:
 *   <AddNodeDialog onClose={...} onSuccess={(node) => { refetch(); }} />
 */

interface AddNodeDialogProps {
  onClose: () => void;
  onSuccess?: (node: NodeInfo) => void;
}

interface FormState {
  name: string;
  ip: string;
  port: number;
  token: string;
  domain: string;
}

const INITIAL: FormState = {
  name: '',
  ip: '',
  port: 8443,
  token: '',
  domain: '',
};

// Клиентская валидация — правила совпадают с backend (shared/utils/validation.ts),
// чтобы сразу подсказывать пользователю, не дожидаясь ответа сервера.
function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (Number.isNaN(n) || n < 0 || n > 255 || String(n) !== p.trim()) return false;
  }
  return true;
}

function isValidPort(p: unknown): p is number {
  const n = typeof p === 'number' ? p : parseInt(String(p), 10);
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}

function isValidToken(t: string): boolean {
  return typeof t === 'string' && t.length >= 16 && /^[a-zA-Z0-9_-]+$/.test(t);
}

function isValidDomain(d: string): boolean {
  if (!d || d.length > 253) return false;
  if (!d.includes('.')) return false;
  return /^[a-zA-Z0-9]([a-zA-Z0-9-_.]*[a-zA-Z0-9])?$/.test(d);
}

const fieldErrorStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 4,
  fontSize: 12,
  color: 'var(--danger)',
};

export function AddNodeDialog({ onClose, onSuccess }: AddNodeDialogProps) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<boolean | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setHealth(null);
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.ip.trim()) next.ip = 'Укажите IP-адрес';
    else if (!isValidIPv4(form.ip.trim())) next.ip = 'Некорректный IPv4-адрес';

    if (!isValidPort(form.port)) next.port = 'Порт: число от 1 до 65535';

    if (!form.token.trim()) next.token = 'Укажите токен';
    else if (!isValidToken(form.token.trim()))
      next.token = 'Токен: минимум 16 символов, только A-Z a-z 0-9 _ -';

    if (form.domain.trim() && !isValidDomain(form.domain.trim()))
      next.domain = 'Некорректный формат домена';

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleCheck = async () => {
    setApiError(null);
    if (!form.ip.trim() || !isValidPort(form.port) || !form.token.trim()) {
      setApiError('Для проверки укажите корректные IP, порт и токен');
      return;
    }
    setChecking(true);
    setHealth(null);
    try {
      const res = await checkNodeHealth({
        ip: form.ip.trim(),
        port: form.port,
        token: form.token.trim(),
      });
      setHealth(res.online);
      if (!res.online) {
        setApiError(
          'Нода не отвечает. Проверьте IP, порт, токен и что service-node запущен и доступен.'
        );
      }
    } catch (err: any) {
      setHealth(false);
      setApiError(err?.message || 'Ошибка проверки соединения');
    } finally {
      setChecking(false);
    }
  };

  const handleSubmit = async () => {
    setApiError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const node = await addNode({
        name: form.name.trim() || undefined,
        ip: form.ip.trim(),
        port: form.port,
        token: form.token.trim(),
        domain: form.domain.trim() || undefined,
      });
      onSuccess?.(node);
      onClose();
    } catch (err: any) {
      setApiError(err?.message || 'Не удалось добавить ноду');
    } finally {
      setSubmitting(false);
    }
  };

  const canCheck =
    !!form.ip.trim() && isValidPort(form.port) && !!form.token.trim();

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-content add-node-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 480 }}
      >
        <div className="dialog-header">
          <h2>Добавить существующую ноду</h2>
          <button className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <p className="hint">
          Укажите данные уже установленного service-node, чтобы панель могла к нему
          подключиться.
        </p>

        {apiError && <div className="error-banner">{apiError}</div>}

        <div className="form-section">
          <label>
            <span>Имя ноды (необязательно)</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder="Например, EU-Node-1"
            />
          </label>

          <label>
            <span>IP-адрес service-node</span>
            <input
              type="text"
              value={form.ip}
              onChange={(e) => setField('ip', e.target.value)}
              placeholder="192.168.1.100"
            />
            {errors.ip && <span style={fieldErrorStyle}>{errors.ip}</span>}
          </label>

          <label>
            <span>Порт API</span>
            <input
              type="number"
              value={form.port}
              min={1}
              max={65535}
              onChange={(e) => setField('port', parseInt(e.target.value, 10) || 0)}
            />
            {errors.port && <span style={fieldErrorStyle}>{errors.port}</span>}
          </label>

          <label>
            <span>Токен (минимум 16 символов)</span>
            <input
              type="password"
              autoComplete="off"
              value={form.token}
              onChange={(e) => setField('token', e.target.value)}
              placeholder="••••••••••••••••"
            />
            {errors.token && <span style={fieldErrorStyle}>{errors.token}</span>}
          </label>

          <label>
            <span>Домен (необязательно)</span>
            <input
              type="text"
              value={form.domain}
              onChange={(e) => setField('domain', e.target.value)}
              placeholder="proxy.example.com"
            />
            {errors.domain && <span style={fieldErrorStyle}>{errors.domain}</span>}
          </label>

          <button
            type="button"
            className="btn-secondary"
            onClick={handleCheck}
            disabled={checking || !canCheck}
          >
            {checking ? 'Проверка…' : '🔌 Проверить соединение'}
          </button>

          {health === true && (
            <div className="success-banner">✓ Нода отвечает</div>
          )}
        </div>

        <div className="dialog-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Отмена
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Добавление…' : 'Добавить ноду'}
          </button>
        </div>
      </div>
    </div>
  );
}
