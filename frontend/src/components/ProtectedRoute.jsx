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

/** `permission` tekil bir yetki anahtarı ya da bir dizi olabilir; dizi verilirse bunlardan
 * herhangi birine sahip olmak yeterlidir (ör. 'firma_yonetme' VEYA 'firma_goruntuleme'). */
export function PermissionRoute({ permission, children }) {
  const { hasPermission } = useAuth();
  const keys = Array.isArray(permission) ? permission : [permission];
  if (!keys.some((key) => hasPermission(key))) return <Navigate to="/" replace />;
  return <ProtectedRoute>{children}</ProtectedRoute>;
}
