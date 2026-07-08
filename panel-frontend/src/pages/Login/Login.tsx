import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogin } from '../../hooks/useLogin';

/**
 * Страница входа в панель.
 */

export function LoginPage() {
  const navigate = useNavigate();
  const { submit, loading, error, hasToken } = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Если уже авторизован — редиректим.
  if (hasToken) {
    setTimeout(() => navigate('/nodes'), 0);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await submit(username, password);
    if (ok) {
      navigate('/nodes');
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 2L3 7v10l9 5 9-5V7l-9-5z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path d="M12 7v10M7.5 9.5l9 5M16.5 9.5l-9 5" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
            </svg>
          </span>
          <div>
            <h1>MTProto Suite</h1>
            <p>Панель управления прокси-серверами</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <label>
            <span>Логин</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
              placeholder="admin"
            />
          </label>

          <label>
            <span>Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </label>

          {error && <div className="error-banner">{error}</div>}

          <button type="submit" disabled={loading} className="btn-primary login-btn">
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>

        <div className="login-footer">
          Защищённое соединение · доступ только для администраторов
        </div>
      </div>
    </div>
  );
}
