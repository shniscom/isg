import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FullScreenLoader } from './ui';

export function ProtectedRoute({ children }) {
  const { status } = useAuth();

  if (status === 'loading') return <FullScreenLoader />;
  if (status === 'login') return <Navigate to="/giris" replace />;
  if (status === 'select-context') return <Navigate to="/proje-secimi" replace />;
  if (status === 'change-password') return <Navigate to="/sifre-degistir" replace />;

  return children;
}

export function AdminRoute({ children }) {
  const { user } = useAuth();
  if (!user?.isSystemAdmin) return <Navigate to="/" replace />;
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

export function PermissionRoute({ permission, children }) {
  const { hasPermission } = useAuth();
  if (!hasPermission(permission)) return <Navigate to="/" replace />;
  return <ProtectedRoute>{children}</ProtectedRoute>;
}
