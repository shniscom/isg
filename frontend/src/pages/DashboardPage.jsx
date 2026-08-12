import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Card, Badge } from '../components/ui';

const ADMIN_SHORTCUTS = [
  { to: '/admin/projeler', label: 'Projeler', icon: '🏗️', permission: 'proje_yonetme', desc: 'Proje, blok/bölge tanımları' },
  { to: '/admin/firmalar', label: 'Firmalar', icon: '🏢', permission: 'firma_yonetme', desc: 'Ana firma, taşeron, tedarikçi yönetimi' },
  { to: '/admin/kullanicilar', label: 'Kullanıcılar', icon: '👤', permission: 'kullanici_yonetme', desc: 'Kullanıcı, proje/görev ve yetki ataması' },
  { to: '/admin/gorevler', label: 'Görevler', icon: '🎯', permission: 'kullanici_yonetme', desc: 'Görev (rol) tanımları' },
];

export function DashboardPage() {
  const { user, context, hasPermission } = useAuth();

  const shortcuts = ADMIN_SHORTCUTS.filter((s) => hasPermission(s.permission));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Merhaba, {user?.fullName?.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {user?.isSystemAdmin ? 'Sistem admini olarak giriş yaptınız.' : 'Aşağıda güncel oturum bilginizi görebilirsiniz.'}
        </p>
      </div>

      {!user?.isSystemAdmin && (
        <Card>
          <h2 className="mb-3 font-semibold text-slate-800">Aktif Oturum</h2>
          <div className="flex flex-wrap gap-2">
            <Badge variant="info">Proje bağlamı seçili</Badge>
            {context?.permissions?.length > 0 ? (
              context.permissions.map((p) => (
                <Badge key={p} variant="default">
                  {p}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-slate-500">Bu proje için özel yetkiniz tanımlanmamış.</span>
            )}
          </div>
        </Card>
      )}

      <Card className="border-brand-100 bg-brand-50">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🚧</span>
          <div>
            <h2 className="font-semibold text-brand-900">Uygunsuzluk takip modülü yakında</h2>
            <p className="mt-1 text-sm text-brand-800">
              Bu ilk sürüm (FAZ 1); proje, firma, kullanıcı ve yetki altyapısını içerir. Uygunsuzluk açma/kapama,
              itiraz, termin ve ceza modülleri sonraki fazlarda bu ana sayfaya eklenecektir.
            </p>
          </div>
        </div>
      </Card>

      {shortcuts.length > 0 && (
        <div>
          <h2 className="mb-3 font-semibold text-slate-800">Yönetim Kısayolları</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {shortcuts.map((s) => (
              <Link
                key={s.to}
                to={s.to}
                className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-300 hover:shadow-md"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-2xl">{s.icon}</span>
                <div>
                  <div className="font-semibold text-slate-800">{s.label}</div>
                  <div className="text-xs text-slate-500">{s.desc}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
