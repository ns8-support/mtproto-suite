import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { setToken } from '../../api';

/**
 * Общий каркас админ-панели: верхняя навигационная панель + контент.
 * Используется для всех авторизованных маршрутов.
 */

function LogoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2L3 7v10l9 5 9-5V7l-9-5z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M12 7v10M7.5 9.5l9 5M16.5 9.5l-9 5" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
    </svg>
  );
}

export function Layout() {
  const navigate = useNavigate();

  const handleLogout = () => {
    setToken(null);
    navigate('/login');
  };

  return (
    <div className="app-layout">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-logo">
            <LogoMark />
          </span>
          MTProto Suite
        </div>

        <nav className="topbar-nav">
          <NavLink to="/nodes" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            Ноды
          </NavLink>
          <NavLink to="/ssl" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            SSL
          </NavLink>
        </nav>

        <div className="topbar-user">
          <span className="topbar-avatar">👤</span>
          <button onClick={handleLogout} className="btn-secondary" style={{ padding: '7px 14px' }}>
            Выйти
          </button>
        </div>
      </header>

      <main className="topbar-content">
        <Outlet />
      </main>
    </div>
  );
}
