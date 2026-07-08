import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNodes } from '../../hooks/useNodes';
import { RemoteInstallDialog } from '../../components/RemoteInstall/RemoteInstallDialog';
import type { RemoteInstallResult } from '../../api/remote-install';

/**
 * Страница со списком нод.
 *
 * Кнопки:
 * - "+ Добавить ноду" — ввести credentials вручную (если service-node уже установлен).
 * - "🛠 Установить удалённо" — SSH-based установка на новом сервере.
 * - Клик по карточке — переход на /nodes/:id с мониторингом.
 */

export function NodesPage() {
  const navigate = useNavigate();
  const { data: nodes, loading, error, refetch } = useNodes();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showRemoteInstall, setShowRemoteInstall] = useState(false);

  const handleRemoteInstallSuccess = (result: RemoteInstallResult) => {
    // После успешной установки обновляем список нод.
    setTimeout(() => refetch(), 1500);
  };

  return (
    <div className="nodes-page">
      <div className="page-header">
        <h1>Сервис-ноды</h1>
        <div className="header-actions">
          <button onClick={() => setShowRemoteInstall(true)} className="btn-secondary">
            🛠 Установить удалённо
          </button>
          <button onClick={() => setShowAddDialog(true)} className="btn-primary">
            + Добавить ноду
          </button>
        </div>
      </div>

      {loading && <div className="loading">Загрузка...</div>}
      {error && <div className="error-banner">{error}</div>}

      {!loading && (!nodes || nodes.length === 0) && (
        <div className="empty-state">
          <h2>Нет нод</h2>
          <p>Добавьте первую ноду одним из способов:</p>
          <ul>
            <li>
              <strong>+ Добавить ноду</strong> — если service-node уже установлен на сервере
              и у вас есть IP, port и токен.
            </li>
            <li>
              <strong>🛠 Установить удалённо</strong> — панель сама установит service-node через SSH.
              Нужны только SSH credentials удалённого сервера.
            </li>
          </ul>
        </div>
      )}

      {nodes && nodes.length > 0 && (
        <div className="nodes-grid">
          {nodes.map((node) => (
            <div
              key={node.id}
              className="node-card clickable"
              onClick={() => navigate(`/nodes/${node.id}`)}
            >
              <div className="node-card-header">
                <h3>{node.name}</h3>
                <span className="node-id">#{node.id}</span>
              </div>
              <div className="node-info">
                <div><strong>IP:</strong> <code>{node.ip}</code></div>
                <div><strong>Порт:</strong> <code>{node.port}</code></div>
                {node.domain && (
                  <div><strong>Домен:</strong> <code>{node.domain}</code></div>
                )}
                <div>
                  <strong>Добавлено:</strong>{' '}
                  {new Date(node.created_at).toLocaleDateString('ru-RU')}
                </div>
              </div>
              <div className="node-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/nodes/${node.id}`);
                  }}
                  className="btn-primary"
                >
                  📊 Мониторинг
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddDialog && (
        <div className="dialog-overlay" onClick={() => setShowAddDialog(false)}>
          <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
            <h3>Добавить существующую ноду</h3>
            <p>Этот диалог реализуется в AddNodeDialog.tsx компоненте.</p>
            <button onClick={() => setShowAddDialog(false)} className="btn-secondary">
              Закрыть
            </button>
          </div>
        </div>
      )}

      {showRemoteInstall && (
        <RemoteInstallDialog
          onClose={() => setShowRemoteInstall(false)}
          onSuccess={handleRemoteInstallSuccess}
        />
      )}
    </div>
  );
}
