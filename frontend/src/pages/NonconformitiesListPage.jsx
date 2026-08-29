import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Button, Select, Alert, Badge, Input } from '../components/ui';
import {
  STATUS_LABELS,
  STATUS_BADGE_VARIANT,
  STATUS_DOT_COLOR,
  PRIORITY_LABELS,
  PRIORITY_BADGE_VARIANT,
  formatDate,
  formatDateTime,
  remainingDaysLabel,
  nonconformitySequenceNumber,
} from '../lib/nonconformity';

const STATUS_FILTERS = ['ACIK', 'BEKLEMEDE', 'KAPALI'];
const RANGE_LABELS = { all: 'Tümü', today: 'Bugün', week: 'Bu Hafta', month: 'Bu Ay', custom: 'Özel Aralık' };

/** 'today'/'week'/'month' için ISO dateFrom/dateTo aralığını hesaplar. */
function rangeToDates(range, customFrom, customTo) {
  if (range === 'all') return { dateFrom: null, dateTo: null };
  if (range === 'custom') {
    if (!customFrom) return { dateFrom: null, dateTo: null };
    const from = new Date(customFrom);
    const to = customTo ? new Date(customTo) : new Date();
    to.setHours(23, 59, 59, 999);
    return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
  }
  const now = new Date();
  const from = new Date(now);
  if (range === 'today') from.setHours(0, 0, 0, 0);
  else if (range === 'week') from.setTime(now.getTime() - 7 * 86400000);
  else if (range === 'month') from.setTime(now.getTime() - 30 * 86400000);
  return { dateFrom: from.toISOString(), dateTo: null };
}

export function NonconformitiesListPage() {
  const { user, hasPermission } = useAuth();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  // Açık uygunsuzluklar en çok ihtiyaç duyulan görünüm olduğundan varsayılan filtre budur.
  const [status, setStatus] = useState('ACIK');
  const [range, setRange] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Sistem admini herhangi bir projeye önceden bağlı olmadığından, liste görüntülemek
  // için burada bir proje seçmesi gerekir.
  const [adminProjects, setAdminProjects] = useState(null);
  const [adminProjectId, setAdminProjectId] = useState('');

  useEffect(() => {
    if (user?.isSystemAdmin) {
      apiClient
        .get('/admin/projects')
        .then(({ data }) => {
          setAdminProjects(data.projects);
          if (data.projects.length > 0) setAdminProjectId(data.projects[0].id);
        })
        .catch((err) => setError(getErrorMessage(err)));
    }
  }, [user]);

  async function load() {
    if (user?.isSystemAdmin && !adminProjectId) return;
    if (range === 'custom' && !customFrom) {
      setItems([]);
      return;
    }
    try {
      const params = {};
      if (status) params.status = status;
      if (user?.isSystemAdmin) params.projectId = adminProjectId;
      const { dateFrom, dateTo } = rangeToDates(range, customFrom, customTo);
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      const { data } = await apiClient.get('/nonconformities', { params });
      setItems(data.nonconformities);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, adminProjectId, range, customFrom, customTo]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">Uygunsuzluklar</h1>
        <div className="flex flex-wrap gap-2">
          {(hasPermission('uygunsuzluk_acma') || user?.isSystemAdmin) && (
            <Link to="/uygunsuzluklar/yeni">
              <Button>+ Yeni Uygunsuzluk</Button>
            </Link>
          )}
          {(hasPermission('kaza_bildirimi') || hasPermission('firma_yonetme') || user?.isSystemAdmin) && (
            <Link to="/kaza-bildir">
              <Button variant="secondary">+ Kaza / Ramak Kala Bildir</Button>
            </Link>
          )}
        </div>
      </div>

      {user?.isSystemAdmin && adminProjects && (
        <Select value={adminProjectId} onChange={(e) => setAdminProjectId(e.target.value)}>
          {adminProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      )}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${
              status === s ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT_COLOR[s]}`} />
            {STATUS_LABELS[s]}
          </button>
        ))}
        <button
          onClick={() => setStatus('')}
          className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${
            status === '' ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Tümü
        </button>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:flex-wrap">
        {Object.entries(RANGE_LABELS).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setRange(key)}
            className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              range === key ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {range === 'custom' && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input label="Başlangıç" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="sm:flex-1" />
          <Input label="Bitiş (boşsa bugün)" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="sm:flex-1" />
        </div>
      )}

      {error && <Alert>{error}</Alert>}

      {items && (
        <p className="text-xs text-slate-500">
          Bu filtrede <span className="font-semibold text-slate-700">{items.length}</span> kayıt listeleniyor.
        </p>
      )}

      <div className="space-y-3">
        {items === null && <p className="text-sm text-slate-500">Yükleniyor...</p>}
        {items?.length === 0 && <p className="text-sm text-slate-500">Kayıt bulunamadı.</p>}
        {items?.map((n) => {
          const remaining = remainingDaysLabel(n.dueDate, n.status);
          const seq = nonconformitySequenceNumber(n.number);
          return (
            <Link key={n.id} to={`/uygunsuzluklar/${n.id}`}>
              <Card className="transition hover:border-brand-300 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">{n.number}</span>
                      {seq !== null && <Badge variant="purple">Projede {seq}. kayıt</Badge>}
                      <Badge variant={STATUS_BADGE_VARIANT[n.status]}>{STATUS_LABELS[n.status]}</Badge>
                      <Badge variant={PRIORITY_BADGE_VARIANT[n.priority]}>{PRIORITY_LABELS[n.priority]}</Badge>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm text-slate-800">{n.description}</p>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      {n.categoryName && <span>🏷️ {n.categoryName}</span>}
                      {n.blockName && <span>📍 {n.blockName}</span>}
                      {n.companyName && <span>🏢 {n.companyName}</span>}
                      <span>👤 {(n.assignees || []).map((a) => a.fullName).join(', ') || '—'}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                      <span>🕐 Açıldı: {formatDateTime(n.createdAt)}</span>
                      <span>📅 Termin: {formatDate(n.dueDate)}</span>
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
    </div>
  );
}
