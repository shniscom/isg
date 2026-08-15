import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV_ITEMS = [
  { to: '/', label: 'Ana Sayfa', icon: '🏠', end: true },
  { to: '/uygunsuzluklar', label: 'Uygunsuzluklar', icon: '⚠️' },
  { to: '/admin/projeler', label: 'Projeler', icon: '🏗️', permission: 'proje_yonetme' },
  { to: '/admin/firmalar', label: 'Firmalar', icon: '🏢', permission: 'firma_yonetme' },
  { to: '/admin/kullanicilar', label: 'Kullanıcılar', icon: '👤', permission: 'kullanici_yonetme' },
  { to: '/admin/gorevler', label: 'Görevler', icon: '🎯', permission: 'kullanici_yonetme' },
  { to: '/admin/kategoriler', label: 'Kategoriler', icon: '🏷️', adminOnly: true },
];

function NavItems({ onNavigate }) {
  const { user, hasPermission } = useAuth();
  return (
    <>
      {NAV_ITEMS.filter((item) => {
        if (item.adminOnly) return user?.isSystemAdmin;
        if (item.permission) return hasPermission(item.permission);
        return true;
      }).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition ${
              isActive ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`
          }
        >
          <span className="text-lg">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </>
  );
}

export function Layout() {
  const { user, context, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <button
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menü"
        >
          ☰
        </button>
        <div className="flex items-center gap-2 font-bold text-brand-800">
          <span className="text-xl">🦺</span> İSG Takip
        </div>
        <button onClick={() => navigate('/profil')} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100">
          <div className="hidden text-right sm:block">
            <div className="text-sm font-semibold text-slate-800">{user?.fullName}</div>
            <div className="text-xs text-slate-500">
              {user?.isSystemAdmin ? 'Sistem Admini' : context?.roleId ? 'Görev seçili' : ''}
            </div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-800">
            {user?.fullName?.charAt(0) || '?'}
          </div>
        </button>
      </header>

      <div className="mx-auto flex max-w-7xl">
        <aside
          className={`fixed inset-y-0 left-0 z-30 w-72 transform border-r border-slate-200 bg-white p-4 pt-20 transition-transform lg:static lg:z-0 lg:translate-x-0 lg:pt-4 ${
            menuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <nav className="flex flex-col gap-1">
            <NavItems onNavigate={() => setMenuOpen(false)} />
          </nav>
          <div className="mt-6 border-t border-slate-200 pt-4">
            <button
              onClick={logout}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <span className="text-lg">🚪</span> Çıkış Yap
            </button>
          </div>
        </aside>

        {menuOpen && (
          <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setMenuOpen(false)} />
        )}

        <main className="min-h-[calc(100vh-57px)] flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
