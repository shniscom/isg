import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute, PermissionRoute, AdminRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { FullScreenLoader } from './components/ui';

import { LoginPage } from './pages/LoginPage';
import { SelectContextPage } from './pages/SelectContextPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProfilePage } from './pages/ProfilePage';
import { PermissionsPage } from './pages/PermissionsPage';
import { ProjectsPage } from './pages/admin/ProjectsPage';
import { ProjectDetailPage } from './pages/admin/ProjectDetailPage';
import { CompaniesPage } from './pages/admin/CompaniesPage';
import { UsersPage } from './pages/admin/UsersPage';
import { UserDetailPage } from './pages/admin/UserDetailPage';
import { RolesPage } from './pages/admin/RolesPage';
import { CategoriesPage } from './pages/admin/CategoriesPage';
import { NonconformitiesListPage } from './pages/NonconformitiesListPage';
import { NewNonconformityPage } from './pages/NewNonconformityPage';
import { NonconformityDetailPage } from './pages/NonconformityDetailPage';

function PublicOnlyRoute({ children, expectedStatus }) {
  const { status } = useAuth();
  if (status === 'loading') return <FullScreenLoader />;
  if (status !== expectedStatus) {
    if (status === 'authenticated') return <Navigate to="/" replace />;
    if (status === 'select-context') return <Navigate to="/proje-secimi" replace />;
    if (status === 'change-password') return <Navigate to="/sifre-degistir" replace />;
    return <Navigate to="/giris" replace />;
  }
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/giris"
        element={
          <PublicOnlyRoute expectedStatus="login">
            <LoginPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/proje-secimi"
        element={
          <PublicOnlyRoute expectedStatus="select-context">
            <SelectContextPage />
          </PublicOnlyRoute>
        }
      />
      <Route
        path="/sifre-degistir"
        element={
          <PublicOnlyRoute expectedStatus="change-password">
            <ChangePasswordPage />
          </PublicOnlyRoute>
        }
      />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/profil" element={<ProfilePage />} />
        <Route path="/yetkilerim" element={<PermissionsPage />} />
        <Route path="/uygunsuzluklar" element={<NonconformitiesListPage />} />
        <Route path="/uygunsuzluklar/yeni" element={<NewNonconformityPage />} />
        <Route path="/uygunsuzluklar/:id" element={<NonconformityDetailPage />} />

        <Route
          path="/admin/projeler"
          element={
            <PermissionRoute permission="proje_yonetme">
              <ProjectsPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/admin/projeler/:id"
          element={
            <PermissionRoute permission="proje_yonetme">
              <ProjectDetailPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/admin/firmalar"
          element={
            <PermissionRoute permission="firma_yonetme">
              <CompaniesPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/admin/kullanicilar"
          element={
            <PermissionRoute permission="kullanici_yonetme">
              <UsersPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/admin/kullanicilar/:id"
          element={
            <PermissionRoute permission="kullanici_yonetme">
              <UserDetailPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/admin/gorevler"
          element={
            <PermissionRoute permission="kullanici_yonetme">
              <RolesPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/admin/kategoriler"
          element={
            <AdminRoute>
              <CategoriesPage />
            </AdminRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
