import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ProtectedRoute, PermissionRoute, AdminRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { FullScreenLoader } from './components/ui';

import { LoginPage } from './pages/LoginPage';
import { InvitePage } from './pages/InvitePage';
import { SelectContextPage } from './pages/SelectContextPage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProfilePage } from './pages/ProfilePage';
import { PermissionsPage } from './pages/PermissionsPage';
import { AppearancePage } from './pages/AppearancePage';
import { ProjectsPage } from './pages/admin/ProjectsPage';
import { ProjectDetailPage } from './pages/admin/ProjectDetailPage';
import { CompaniesPage } from './pages/admin/CompaniesPage';
import { CompanyDetailPage } from './pages/admin/CompanyDetailPage';
import { UsersPage } from './pages/admin/UsersPage';
import { UserDetailPage } from './pages/admin/UserDetailPage';
import { RolesPage } from './pages/admin/RolesPage';
import { CategoriesPage } from './pages/admin/CategoriesPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { ArchivesPage } from './pages/admin/ArchivesPage';
import { NonconformitiesListPage } from './pages/NonconformitiesListPage';
import { NonconformityCompanyCardsPage } from './pages/NonconformityCompanyCardsPage';
import { NewNonconformityPage } from './pages/NewNonconformityPage';
import { NonconformityDetailPage } from './pages/NonconformityDetailPage';
import { NewIncidentPage } from './pages/NewIncidentPage';
import { ReportsPage } from './pages/ReportsPage';
import { PenaltiesPage } from './pages/PenaltiesPage';
import { EmployeesPage } from './pages/EmployeesPage';
import { EmployeeDetailPage } from './pages/EmployeeDetailPage';

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
      <Route path="/davet/:token" element={<InvitePage />} />
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
        <Route path="/gorunum" element={<AppearancePage />} />
        <Route path="/uygunsuzluklar" element={<NonconformityCompanyCardsPage />} />
        <Route path="/uygunsuzluklar/liste" element={<NonconformitiesListPage />} />
        <Route path="/uygunsuzluklar/yeni" element={<NewNonconformityPage />} />
        <Route path="/uygunsuzluklar/:id" element={<NonconformityDetailPage />} />
        <Route path="/kaza-bildir" element={<NewIncidentPage />} />
        <Route path="/raporlar" element={<ReportsPage />} />
        <Route path="/cezalar" element={<PenaltiesPage />} />
        <Route path="/calisanlar" element={<EmployeesPage />} />
        <Route path="/calisanlar/:id" element={<EmployeeDetailPage />} />

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
            <PermissionRoute permission={['firma_yonetme', 'firma_goruntuleme']}>
              <CompaniesPage />
            </PermissionRoute>
          }
        />
        <Route
          path="/admin/firmalar/:id"
          element={
            <PermissionRoute permission={['firma_yonetme', 'firma_goruntuleme']}>
              <CompanyDetailPage />
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
        <Route
          path="/admin/arsiv"
          element={
            <AdminRoute>
              <ArchivesPage />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/ayarlar"
          element={
            <AdminRoute>
              <SettingsPage />
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
        <ThemeProvider>
          <AppRoutes />
        </ThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
