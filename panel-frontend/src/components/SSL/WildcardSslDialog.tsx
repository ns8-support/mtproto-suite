import { useState, useEffect } from 'react';
import {
  testCloudflare,
  obtainWildcard,
  getSslStatus,
  listCloudflareZones,
  type WildcardObtainRequest,
  type CertificateStatus,
  type CloudflareZone,
} from '../../api/ssl';

/**
 * Диалог для получения wildcard SSL сертификата через Cloudflare DNS-01.
 *
 * UX flow:
 * 1. Пользователь вводит Cloudflare API Token.
 * 2. Нажимает "Test Token" — показываются доступные домены.
 * 3. Выбирает домен из списка (или вводит вручную).
 * 4. Вводит контактный email для Let's Encrypt.
 * 5. Опционально включает staging (для теста).
 * 6. Нажимает "Obtain Certificate" — запускается процесс.
 * 7. Получают wildcard *.example.com от Let's Encrypt через DNS-01.
 *
 * ВАЖНО: Cloudflare API Token должен иметь права:
 * - Zone:DNS:Edit (создание/удаление TXT записей)
 * - Zone:Zone:Read (определение zone_id)
 */

interface WildcardSslDialogProps {
  onClose: () => void;
}

type Step = 'form' | 'testing' | 'obtaining' | 'success' | 'error';

interface FormState {
  apiToken: string;
  wildcardDomain: string;
  rootDomain: string;
  email: string;
  staging: boolean;
}

const INITIAL_STATE: FormState = {
  apiToken: '',
  wildcardDomain: '*.example.com',
  rootDomain: 'example.com',
  email: '',
  staging: false,
};

export function WildcardSslDialog({ onClose }: WildcardSslDialogProps) {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [zones, setZones] = useState<CloudflareZone[]>([]);
  const [certPath, setCertPath] = useState<string | null>(null);
  const [keyPath, setKeyPath] = useState<string | null>(null);
  const [validTo, setValidTo] = useState<string | null>(null);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    // Если меняется rootDomain, автоматически обновляем wildcardDomain.
    if (key === 'rootDomain' && typeof value === 'string') {
      const domain = value.trim().toLowerCase();
      if (domain) {
        setForm((f) => ({ ...f, rootDomain: domain, wildcardDomain: `*.${domain}` }));
      }
    }
  };

  const handleTestToken = async () => {
    setStep('testing');
    setError(null);
    setZones([]);
    setTokenValid(null);

    try {
      const result = await testCloudflare(form.apiToken.trim());
      if (result.success) {
        setTokenValid(true);
        // Загружаем список зон.
        const zonesResult = await listCloudflareZones(form.apiToken.trim());
        setZones(zonesResult.zones);
        setStep('form');
      } else {
        setTokenValid(false);
        setError(result.error || 'Invalid Cloudflare credentials');
        setStep('error');
      }
    } catch (err: any) {
      setTokenValid(false);
      setError(err.message || 'Network error');
      setStep('error');
    }
  };

  const handleSelectZone = (zoneName: string) => {
    updateField('rootDomain', zoneName);
  };

  const handleObtain = async () => {
    setStep('obtaining');
    setError(null);

    const payload: WildcardObtainRequest = {
      wildcardDomain: form.wildcardDomain.trim().toLowerCase(),
      rootDomain: form.rootDomain.trim().toLowerCase(),
      email: form.email.trim(),
      staging: form.staging,
      cloudflare: {
        apiToken: form.apiToken.trim(),
      },
    };

    try {
      const result = await obtainWildcard(payload);
      if (result.success) {
        setCertPath(result.certificatePath || null);
        setKeyPath(result.privateKeyPath || null);
        setValidTo(result.certInfo?.validTo || null);
        setStep('success');
      } else {
        setError(result.error || 'Certificate obtain failed');
        setStep('error');
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
      setStep('error');
    }
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-content wildcard-ssl-dialog">
        <div className="dialog-header">
          <h2>Wildcard SSL через Cloudflare</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        {step === 'form' && (
          <>
            <div className="info-banner">
              <strong>ℹ️ Как это работает:</strong>
              <ol>
                <li>Cloudflare API Token создаёт TXT запись <code>_acme-challenge.example.com</code></li>
                <li>Let's Encrypt проверяет DNS-01 challenge</li>
                <li>Выдаётся wildcard сертификат <code>*.example.com</code></li>
                <li>Сертификат сохраняется на диск, TXT запись удаляется</li>
              </ol>
            </div>

            <div className="form-section">
              <h3>Cloudflare API Token</h3>
              <label>
                <span>
                  API Token (Zone:DNS:Edit + Zone:Zone:Read)
                </span>
                <input
                  type="password"
                  value={form.apiToken}
                  onChange={(e) => updateField('apiToken', e.target.value)}
                  placeholder="Создайте на https://dash.cloudflare.com/profile/api-tokens"
                  autoComplete="off"
                />
              </label>

              {tokenValid === true && zones.length > 0 && (
                <div className="zones-selector">
                  <p><strong>Доступные домены ({zones.length}):</strong></p>
                  <div className="zones-list">
                    {zones.map((zone) => (
                      <button
                        key={zone.id}
                        type="button"
                        onClick={() => handleSelectZone(zone.name)}
                        className={form.rootDomain === zone.name ? 'zone-btn active' : 'zone-btn'}
                      >
                        {zone.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {tokenValid === false && (
                <div className="error-banner">✗ Токен невалиден</div>
              )}

              <button
                type="button"
                onClick={handleTestToken}
                disabled={!form.apiToken || form.apiToken.length < 20}
                className="btn-secondary"
              >
                🔑 Проверить токен
              </button>
            </div>

            <div className="form-section">
              <h3>Домен и контакт</h3>

              <label>
                <span>Домен (root)</span>
                <input
                  type="text"
                  value={form.rootDomain}
                  onChange={(e) => updateField('rootDomain', e.target.value)}
                  placeholder="example.com"
                />
              </label>

              <label>
                <span>Wildcard домен</span>
                <input
                  type="text"
                  value={form.wildcardDomain}
                  onChange={(e) => updateField('wildcardDomain', e.target.value)}
                  placeholder="*.example.com"
                />
                <small>Автоматически генерируется из root домена</small>
              </label>

              <label>
                <span>Email для Let's Encrypt</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="admin@example.com"
                />
                <small>Используется для ACME аккаунта и уведомлений об истечении</small>
              </label>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.staging}
                  onChange={(e) => updateField('staging', e.target.checked)}
                />
                <span>
                  Использовать <strong>staging сервер</strong> Let's Encrypt
                  <br />
                  <small>Для тестирования — сертификаты staging не валидны в браузерах</small>
                </span>
              </label>
            </div>

            <div className="dialog-footer">
              <button onClick={onClose} className="btn-secondary">Отмена</button>
              <button
                onClick={handleObtain}
                disabled={
                  !form.apiToken ||
                  !form.rootDomain ||
                  !form.wildcardDomain.startsWith('*.') ||
                  !form.email.includes('@')
                }
                className="btn-primary"
              >
                🔒 Получить wildcard сертификат
              </button>
            </div>
          </>
        )}

        {step === 'testing' && (
          <div className="progress-state">
            <div className="spinner"></div>
            <p>Проверка Cloudflare credentials...</p>
          </div>
        )}

        {step === 'obtaining' && (
          <div className="progress-state">
            <div className="spinner"></div>
            <p>Получение wildcard сертификата...</p>
            <p className="hint">
              1. Создание ACME аккаунта<br />
              2. Генерация CSR для {form.wildcardDomain}<br />
              3. Создание TXT записи в Cloudflare<br />
              4. Проверка DNS-01 challenge<br />
              5. Выдача сертификата Let's Encrypt
            </p>
            <p className="hint">Это может занять 30-60 секунд.</p>
          </div>
        )}

        {step === 'success' && (
          <div className="success-state">
            <h3>✓ Сертификат успешно получен!</h3>
            <div className="result-fields">
              {validTo && (
                <div>
                  <strong>Действителен до:</strong> <code>{new Date(validTo).toLocaleString()}</code>
                </div>
              )}
              {certPath && (
                <div>
                  <strong>Сертификат:</strong> <code className="path">{certPath}</code>
                </div>
              )}
              {keyPath && (
                <div>
                  <strong>Приватный ключ:</strong> <code className="path">{keyPath}</code>
                </div>
              )}
            </div>
            <div className="info-banner">
              <strong>ℹ️ Автообновление:</strong> добавьте cron:
              <pre className="cron-example">
{`# Каждые 60 дней проверять и обновлять при необходимости
0 3 */60 * * cd ${certPath?.replace(/\/[^\/]+$/, '') || '/opt/mtproto-suite/ssl/wildcard'} && bash install.sh --ssl-renew ${form.rootDomain}`}
              </pre>
            </div>
            <button onClick={onClose} className="btn-primary">Готово</button>
          </div>
        )}

        {step === 'error' && (
          <div className="error-state">
            <h3>Ошибка</h3>
            <div className="error-message">{error}</div>
            <button onClick={() => setStep('form')} className="btn-secondary">
              ← Назад
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
