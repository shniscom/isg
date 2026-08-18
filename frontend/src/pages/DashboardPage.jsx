import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';
import { Card, Badge } from '../components/ui';
import {
  STATUS_LABELS,
  STATUS_BADGE_VARIANT,
  PRIORITY_LABELS,
  PRIORITY_BADGE_VARIANT,
  formatDate,
  remainingDaysLabel,
} from '../lib/nonconformity';

const ADMIN_SHORTCUTS = [
  { to: '/admin/projeler', label: 'Projeler', icon: '🏗️', permission: 'proje_yonetme', desc: 'Proje, blok/bölge tanımları' },
  { to: '/admin/firmalar', label: 'Firmalar', icon: '🏢', permission: 'firma_yonetme', desc: 'Ana firma, taşeron, tedarikçi yönetimi' },
  { to: '/admin/kullanicilar', label: 'Kullanıcılar', icon: '👤', permission: 'kullanici_yonetme', desc: 'Kullanıcı, proje/görev ve yetki ataması' },
  { to: '/admin/gorevler', label: 'Görevler', icon: '🎯', permission: 'kullanici_yonetme', desc: 'Görev (rol) tanımları' },
];

const STATUS_FILTERS = ['ACIK', 'BEKLEMEDE', 'KAPALI'];

export function DashboardPage() {
  const { user, hasPermission } = useAuth();
  const shortcuts = ADMIN_SHORTCUTS.filter((s) => hasPermission(s.permission));

  const [assignedItems, setAssignedItems] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    if (user?.isSystemAdmin) return;
    apiClient
      .get('/nonconformities')
      .then(({ data }) => {
        const items = (data.nonconformities || []).filter((n) => (n.assignees || []).some((a) => a.userId === user.id));
        setAssignedItems(items);
      })
      .catch(() => setAssignedItems([]));
  }, [user]);

  const counts = assignedItems
    ? {
        toplam: assignedItems.length,
        ACIK: assignedItems.filter((i) => i.status === 'ACIK').length,
        BEKLEMEDE: assignedItems.filter((i) => i.status === 'BEKLEMEDE').length,
        KAPALI: assignedItems.filter((i) => i.status === 'KAPALI').length,
      }
    : null;

  const filteredItems = assignedItems
    ? statusFilter
      ? assignedItems.filter((i) => i.status === statusFilter)
      : assignedItems.filter((i) => i.status !== 'KAPALI')
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Merhaba, {user?.fullName?.split(' ')[0]}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {user?.isSystemAdmin ? 'Sistem admini olarak giriş yaptınız.' : 'Size atanan uygunsuzluklar aşağıda listelenmiştir.'}
        </p>
      </div>

      {!user?.isSystemAdmin && (
        <>
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Bana Atanan Uygunsuzluklar</h2>
              <Link to="/uygunsuzluklar" className="text-sm font-medium text-brand-700 hover:underline">
                Tüm liste →
              </Link>
            </div>
            {counts ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-200 p-3 text-center">
                  <div className="text-2xl font-bold text-slate-800">{counts.toplam}</div>
                  <div className="text-xs text-slate-500">Toplam Atanan</div>
                </div>
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center">
                  <div className="text-2xl font-bold text-red-700">{counts.ACIK}</div>
                  <div className="text-xs text-red-700">{STATUS_LABELS.ACIK}</div>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
                  <div className="text-2xl font-bold text-amber-700">{counts.BEKLEMEDE}</div>
                  <div className="text-xs text-amber-700">Onay Bekleyen</div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                  <div className="text-2xl font-bold text-emerald-700">{counts.KAPALI}</div>
                  <div className="text-xs text-emerald-700">Kapattığı</div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Yükleniyor...</p>
            )}
          </Card>

          <div className="flex gap-2">
            <button
              onClick={() => setStatusFilter('')}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                statusFilter === '' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Aktif (Açık + Beklemede)
            </button>
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  statusFilter === s ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {filteredItems?.length === 0 && (
              <p className="text-sm text-slate-500">Bu filtrede size atanan bir uygunsuzluk yok.</p>
            )}
            {filteredItems?.map((n) => {
              const remaining = remainingDaysLabel(n.dueDate, n.status);
              return (
                <Link key={n.id} to={`/uygunsuzluklar/${n.id}`}>
                  <Card className="transition hover:border-brand-300 hover:shadow-md">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-slate-400">{n.number}</span>
                          <Badge variant={STATUS_BADGE_VARIANT[n.status]}>{STATUS_LABELS[n.status]}</Badge>
                          <Badge variant={PRIORITY_BADGE_VARIANT[n.priority]}>{PRIORITY_LABELS[n.priority]}</Badge>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-sm text-slate-800">{n.description}</p>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                          {n.companyName && <span>🏢 {n.companyName}</span>}
                          <span>📅 {formatDate(n.dueDate)}</span>
                        </div>
                      </div>
                      {remaining && (
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                            remaining.tone === 'danger'
                              ? 'bg-red-100 text-red-700'
                              : remaining.tone === 'warning'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {remaining.text}
                        </span>
                      )}
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </>
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
