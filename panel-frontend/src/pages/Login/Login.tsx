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
      <form onSubmit={handleSubmit} className="login-form">
        <h1>MTProto Panel</h1>

        <label>
          <span>Логин</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
        </label>

        <label>
          <span>Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <div className="error-banner">{error}</div>}

        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? 'Вход...' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
