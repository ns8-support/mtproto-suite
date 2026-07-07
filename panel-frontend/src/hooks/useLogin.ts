import { useCallback, useState } from 'react';
import { login, setToken, getToken } from '../api';

interface LoginState {
  loading: boolean;
  error: string | null;
}

export function useLogin() {
  const [state, setState] = useState<LoginState>({ loading: false, error: null });

  const submit = useCallback(async (username: string, password: string): Promise<boolean> => {
    setState({ loading: true, error: null });
    try {
      const result = await login(username, password);
      setToken(result.token);
      setState({ loading: false, error: null });
      return true;
    } catch (err: any) {
      setState({ loading: false, error: err?.message || 'Login failed' });
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    setToken(null);
  }, []);

  return {
    ...state,
    submit,
    logout,
    hasToken: !!getToken(),
  };
}
