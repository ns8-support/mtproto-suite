import { Routes, Route, Navigate } from 'react-router-dom';
import { isAuthenticated } from './api';

/**
 * Корневой компонент приложения с роутингом.
 *
 * Маршруты:
 * - /login — страница входа
 * - /nodes — список нод (с кнопкой удалённой установки)
 * - /nodes/:id — детали ноды с мониторингом (CPU/RAM/Disk, действия, NetBird)
 * - /ssl — управление SSL сертификатами (wildcard через Cloudflare)
 * - /settings — настройки
 */

function PrivateRoute({ children }: { children: React.ReactNode }) {
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" />;
}

import { LoginPage } from './pages/Login/Login';
import { NodesPage } from './pages/Nodes/Nodes';
import { NodeDetailPage } from './pages/NodeDetail/NodeDetail';
import { SSLPage } from './pages/SSL/SSL';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/nodes"
        element={
          <PrivateRoute>
            <NodesPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/nodes/:id"
        element={
          <PrivateRoute>
            <NodeDetailPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/ssl"
        element={
          <PrivateRoute>
            <SSLPage />
          </PrivateRoute>
        }
      />

      <Route
        path="/settings"
        element={
          <PrivateRoute>
            <div>Settings (TODO)</div>
          </PrivateRoute>
        }
      />

      <Route path="*" element={<Navigate to="/nodes" />} />
    </Routes>
  );
}
