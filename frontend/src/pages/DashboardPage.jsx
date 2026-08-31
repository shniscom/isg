import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import apiClient from '../api/client';
import { Badge } from '../components/ui';
import {
  STATUS_LABELS,
  STATUS_BADGE_VARIANT,
  PRIORITY_LABELS,
  PRIORITY_BADGE_VARIANT,
  PENALTY_STATUS_LABELS,
  PENALTY_STATUS_BADGE_VARIANT,
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

const STAT_CARDS = [
  { key: 'toplam', label: 'Toplam Atanan', icon: '📋', tone: 'bg-slate-50 border-slate-200 text-slate-800' },
  { key: 'ACIK', label: 'Açık', icon: '⚠️', tone: 'bg-red-50 border-red-200 text-red-700' },
  { key: 'BEKLEMEDE', label: 'Onay Bekleyen', icon: '⏳', tone: 'bg-amber-50 border-amber-200 text-amber-700' },
  { key: 'KAPALI', label: 'Kapattığı', icon: '✅', tone: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
];

export function DashboardPage() {
  const { user, hasPermission } = useAuth();
  const shortcuts = ADMIN_SHORTCUTS.filter((s) => hasPermission(s.permission));

  const [assignedItems, setAssignedItems] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [myPenalties, setMyPenalties] = useState(null);

  useEffect(() => {
    if (user?.isSystemAdmin) return;
    apiClient
      .get('/nonconformities')
      .then(({ data }) => {
        const items = (data.nonconformities || []).filter((n) => (n.assignees || []).some((a) => a.userId === user.id));
        setAssignedItems(items);
      })
      .catch(() => setAssignedItems([]));
    apiClient
      .get('/penalties/mine')
      .then(({ data }) => setMyPenalties(data.penalties))
      .catch(() => setMyPenalties([]));
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
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800 sm:text-2xl">Merhaba, {user?.fullName?.split(' ')[0]}</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {user?.isSystemAdmin ? 'Sistem admini olarak giriş yaptınız.' : 'Size atanan uygunsuzluklar aşağıda listelenmiştir.'}
        </p>
      </div>

      {!user?.isSystemAdmin && (
        <>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Bana Atanan Uygunsuzluklar</h2>
              <Link to="/uygunsuzluklar/liste" className="text-xs font-medium text-brand-700 hover:underline">
                Tüm liste →
              </Link>
            </div>
            {counts ? (
              <div className="grid grid-cols-2 gap-2.5">
                {STAT_CARDS.map((c) => (
                  <div key={c.key} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${c.tone}`}>
                    <span className="text-lg leading-none">{c.icon}</span>
                    <div className="min-w-0">
                      <div className="text-xl font-bold leading-tight">{counts[c.key]}</div>
                      <div className="truncate text-[11px] font-medium opacity-80">{c.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Yükleniyor...</p>
            )}
          </div>

          {/* Cezalarım */}
          {myPenalties?.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Cezalarım</h2>
              <div className="space-y-2">
                {myPenalties.map((p) => (
                  <Link key={p.id} to={`/uygunsuzluklar/${p.nonconformityId}`}>
                    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-surface px-3 py-2.5 transition hover:border-brand-300 hover:shadow-sm">
                      <span className="text-lg leading-none">⚖️</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-slate-400">{p.nonconformityNumber}</span>
                          <Badge variant={PENALTY_STATUS_BADGE_VARIANT[p.status]}>{PENALTY_STATUS_LABELS[p.status]}</Badge>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-slate-600">
                          Açan: <span className="font-medium text-slate-800">{p.openedByName || '—'}</span> · Ceza gönderen:{' '}
                          <span className="font-medium text-slate-800">{p.requestedByName || '—'}</span>
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:flex-wrap">
            <button
              onClick={() => setStatusFilter('')}
              className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                statusFilter === '' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Aktif (Açık + Beklemede)
            </button>
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                  statusFilter === s ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {filteredItems?.length === 0 && (
              <p className="text-sm text-slate-500">Bu filtrede size atanan bir uygunsuzluk yok.</p>
            )}
            {filteredItems?.map((n) => {
              const remaining = remainingDaysLabel(n.dueDate, n.status);
              return (
                <Link key={n.id} to={`/uygunsuzluklar/${n.id}`}>
                  <div className="rounded-xl border border-slate-200 bg-surface p-3 transition hover:border-brand-300 hover:shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] text-slate-400">{n.number}</span>
                          <Badge variant={STATUS_BADGE_VARIANT[n.status]}>{STATUS_LABELS[n.status]}</Badge>
                          <Badge variant={PRIORITY_BADGE_VARIANT[n.priority]}>{PRIORITY_LABELS[n.priority]}</Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-800">{n.description}</p>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                          {n.companyName && <span>🏢 {n.companyName}</span>}
                          <span>📅 {formatDate(n.dueDate)}</span>
                        </div>
                      </div>
                      {remaining && (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
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
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}

      {shortcuts.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Yönetim Kısayolları</h2>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {shortcuts.map((s) => (
              <Link
                key={s.to}
                to={s.to}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-surface p-3 shadow-sm transition hover:border-brand-300 hover:shadow-md"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-xl">{s.icon}</span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800">{s.label}</div>
                  <div className="truncate text-xs text-slate-500">{s.desc}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
