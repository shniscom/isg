import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';
import { Card, Badge } from '../components/ui';
import { STATUS_LABELS } from '../lib/nonconformity';

const ADMIN_SHORTCUTS = [
  { to: '/admin/projeler', label: 'Projeler', icon: '🏗️', permission: 'proje_yonetme', desc: 'Proje, blok/bölge tanımları' },
  { to: '/admin/firmalar', label: 'Firmalar', icon: '🏢', permission: 'firma_yonetme', desc: 'Ana firma, taşeron, tedarikçi yönetimi' },
  { to: '/admin/kullanicilar', label: 'Kullanıcılar', icon: '👤', permission: 'kullanici_yonetme', desc: 'Kullanıcı, proje/görev ve yetki ataması' },
  { to: '/admin/gorevler', label: 'Görevler', icon: '🎯', permission: 'kullanici_yonetme', desc: 'Görev (rol) tanımları' },
];

export function DashboardPage() {
  const { user, context, hasPermission } = useAuth();

  const shortcuts = ADMIN_SHORTCUTS.filter((s) => hasPermission(s.permission));

  const [counts, setCounts] = useState(null);

  useEffect(() => {
    if (user?.isSystemAdmin) return;
    apiClient
      .get('/nonconformities')
      .then(({ data }) => {
        const items = data.nonconformities || [];
        setCounts({
          toplam: items.length,
          ACIK: items.filter((i) => i.status === 'ACIK').length,
          BEKLEMEDE: items.filter((i) => i.status === 'BEKLEMEDE').length,
          KAPALI: items.filter((i) => i.status === 'KAPALI').length,
        });
      })
      .catch(() => setCounts(null));
  }, [user]);

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

      {!user?.isSystemAdmin && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Uygunsuzluklar</h2>
            <Link to="/uygunsuzluklar" className="text-sm font-medium text-brand-700 hover:underline">
              Tümünü gör →
            </Link>
          </div>
          {counts ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 p-3 text-center">
                <div className="text-2xl font-bold text-slate-800">{counts.toplam}</div>
                <div className="text-xs text-slate-500">Toplam</div>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center">
                <div className="text-2xl font-bold text-red-700">{counts.ACIK}</div>
                <div className="text-xs text-red-700">{STATUS_LABELS.ACIK}</div>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
                <div className="text-2xl font-bold text-amber-700">{counts.BEKLEMEDE}</div>
                <div className="text-xs text-amber-700">{STATUS_LABELS.BEKLEMEDE}</div>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                <div className="text-2xl font-bold text-emerald-700">{counts.KAPALI}</div>
                <div className="text-xs text-emerald-700">{STATUS_LABELS.KAPALI}</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Yükleniyor...</p>
          )}
        </Card>
      )}

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
