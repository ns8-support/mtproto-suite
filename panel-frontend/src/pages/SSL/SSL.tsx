import { useState } from 'react';
import { useAsync } from '../../hooks/useAsync';
import { getSslStatus, renewWildcard, type CertificateStatus } from '../../api/ssl';
import { WildcardSslDialog } from '../../components/SSL/WildcardSslDialog';

/**
 * Страница управления SSL сертификатами.
 *
 * Показывает:
 * - Список существующих wildcard сертификатов
 * - Статус (действителен / истекает)
 * - Путь к файлам на диске
 * - Кнопки: получить новый, обновить
 */

export function SSLPage() {
  const [showObtainDialog, setShowObtainDialog] = useState(false);

  const fetcher = async () => getSslStatus();
  const { data, loading, error, refetch } = useAsync(fetcher, { pollIntervalMs: 60000 });

  const handleRenew = async (cert: CertificateStatus) => {
    // В реальной реализации нужно знать Cloudflare token + email.
    // Здесь просто триггерим UI — пользователь введёт credentials заново.
    alert(
      `Для обновления сертификата "${cert.name}" необходимы Cloudflare API Token и email.\n` +
      `Откроется диалог получения нового сертификата.`
    );
    setShowObtainDialog(true);
  };

  return (
    <div className="ssl-page">
      <div className="page-header">
        <h1>SSL Сертификаты</h1>
        <button onClick={() => setShowObtainDialog(true)} className="btn-primary">
          + Получить wildcard
        </button>
      </div>

      {loading && <div className="loading">Загрузка...</div>}

      {error && <div className="error-banner">{error}</div>}

      {data && (
        <>
          <div className="info-banner">
            <strong>Хранилище:</strong> <code>{data.outputDir}</code>
            <br />
            <strong>Всего сертификатов:</strong> {data.certificates.length}
          </div>

          {data.certificates.length === 0 ? (
            <div className="empty-state">
              <p>Wildcard сертификатов пока нет.</p>
              <p>
                Нажмите "Получить wildcard" чтобы создать <code>*.yourdomain.com</code> через
                Let's Encrypt DNS-01 challenge.
              </p>
            </div>
          ) : (
            <div className="certificates-grid">
              {data.certificates.map((cert) => (
                <div key={cert.name} className="certificate-card">
                  <h3>{cert.name}</h3>
                  <div className="cert-status">
                    {cert.expiringSoon ? (
                      <span className="badge badge-warning">⚠ Истекает скоро</span>
                    ) : (
                      <span className="badge badge-success">✓ Действителен</span>
                    )}
                  </div>
                  <div className="cert-paths">
                    <div>
                      <strong>Cert:</strong>{' '}
                      <code className="path">{cert.certificatePath}</code>
                    </div>
                    <div>
                      <strong>Key:</strong>{' '}
                      <code className="path">{cert.privateKeyPath || '(missing)'}</code>
                    </div>
                  </div>
                  <button onClick={() => handleRenew(cert)} className="btn-secondary">
                    🔄 Обновить
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <button onClick={refetch} className="btn-secondary" style={{ marginTop: 16 }}>
        🔄 Обновить статус
      </button>

      {showObtainDialog && <WildcardSslDialog onClose={() => setShowObtainDialog(false)} />}
    </div>
  );
}
