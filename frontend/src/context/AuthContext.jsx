import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import apiClient, { setAuthToken, setUnauthorizedHandler, getErrorMessage } from '../api/client';

const AuthContext = createContext(null);

const STORAGE_KEY = 'isg_takip_session_v1';

function loadStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistSession(session) {
  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading'); // loading | login | select-context | change-password | authenticated
  const [user, setUser] = useState(null);
  const [contextToken, setContextToken] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [accessToken, setAccessToken] = useState(null);
  const [context, setContext] = useState(null); // { projectId, roleId, permissions }
  const [error, setError] = useState(null);

  const reset = useCallback(() => {
    setAuthToken(null);
    persistSession(null);
    setUser(null);
    setContextToken(null);
    setAssignments([]);
    setAccessToken(null);
    setContext(null);
    setStatus('login');
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => reset());
  }, [reset]);

  // Sayfa yenilendiğinde kaydedilmiş oturumu doğrula.
  useEffect(() => {
    const stored = loadStoredSession();
    if (!stored?.accessToken) {
      setStatus('login');
      return;
    }
    setAuthToken(stored.accessToken);
    apiClient
      .get('/auth/me')
      .then(({ data }) => {
        setUser(data.user);
        setAccessToken(stored.accessToken);
        setContext(data.context);
        setStatus(data.user.mustChangePassword ? 'change-password' : 'authenticated');
      })
      .catch(() => {
        reset();
      });
  }, [reset]);

  const login = useCallback(async (username, password) => {
    setError(null);
    try {
      const { data } = await apiClient.post('/auth/login', { username, password });
      setUser(data.user);

      if (data.isSystemAdmin) {
        setAuthToken(data.accessToken);
        setAccessToken(data.accessToken);
        setContext(null);
        persistSession({ accessToken: data.accessToken });
        setStatus(data.mustChangePassword ? 'change-password' : 'authenticated');
        return { ok: true };
      }

      setContextToken(data.contextToken);
      setAssignments(data.assignments);
      setStatus('select-context');
      return { ok: true };
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      return { ok: false, message };
    }
  }, []);

  const selectContext = useCallback(
    async (projectId, roleId) => {
      setError(null);
      try {
        const { data } = await apiClient.post('/auth/select-context', { contextToken, projectId, roleId });
        setAuthToken(data.accessToken);
        setAccessToken(data.accessToken);
        setUser(data.user);
        setContext(data.context);
        persistSession({ accessToken: data.accessToken });
        setStatus(data.mustChangePassword ? 'change-password' : 'authenticated');
        return { ok: true };
      } catch (err) {
        const message = getErrorMessage(err);
        setError(message);
        return { ok: false, message };
      }
    },
    [contextToken]
  );

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    setError(null);
    try {
      await apiClient.post('/auth/change-password', { currentPassword, newPassword });
      setUser((prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
      setStatus('authenticated');
      return { ok: true };
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      return { ok: false, message };
    }
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/auth/me');
      setUser(data.user);
      setContext(data.context);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: getErrorMessage(err) };
    }
  }, []);

  const backToLogin = useCallback(() => {
    setContextToken(null);
    setAssignments([]);
    setStatus('login');
  }, []);

  const logout = useCallback(() => {
    reset();
  }, [reset]);

  const hasPermission = useCallback(
    (key) => {
      if (!user) return false;
      if (user.isSystemAdmin) return true;
      return Boolean(context?.permissions?.includes(key));
    },
    [user, context]
  );

  const value = useMemo(
    () => ({
      status,
      user,
      assignments,
      accessToken,
      context,
      error,
      login,
      selectContext,
      changePassword,
      refreshMe,
      backToLogin,
      logout,
      hasPermission,
      clearError: () => setError(null),
    }),
    [status, user, assignments, accessToken, context, error, login, selectContext, changePassword, refreshMe, backToLogin, logout, hasPermission]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalıdır.');
  return ctx;
}
