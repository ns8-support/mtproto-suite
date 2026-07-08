import { Routes, Route, Navigate } from 'react-router-dom';
import { isAuthenticated } from './api';
import { Layout } from './components/Layout/Layout';

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
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route path="/nodes" element={<NodesPage />} />
        <Route path="/nodes/:id" element={<NodeDetailPage />} />
        <Route path="/ssl" element={<SSLPage />} />
        <Route path="/settings" element={<div>Settings (TODO)</div>} />
      </Route>

      <Route path="*" element={<Navigate to="/nodes" />} />
    </Routes>
  );
}
