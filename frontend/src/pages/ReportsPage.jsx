import { useEffect, useState } from 'react';
import apiClient, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Select, Alert, Button, Input } from '../components/ui';

const RANGE_LABELS = { today: 'Bugün', week: 'Bu Hafta (son 7 gün)', month: 'Bu Ay (son 30 gün)', custom: 'Özel Aralık' };

function downloadCsv(rows, fileName) {
  const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const { user, hasPermission } = useAuth();
  const [range, setRange] = useState('today');
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  const [adminProjects, setAdminProjects] = useState(null);
  const [adminProjectId, setAdminProjectId] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

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
    if (range === 'custom' && (!customFrom || !customTo)) {
      setReport(null);
      return;
    }
    try {
      const params = { range };
      if (user?.isSystemAdmin) params.projectId = adminProjectId;
      if (range === 'custom') {
        params.from = new Date(customFrom).toISOString();
        params.to = new Date(customTo).toISOString();
      }
      const { data } = await apiClient.get('/nonconformities/report', { params });
      setReport(data);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, adminProjectId, customFrom, customTo]);

  async function handleFullExport() {
    if (!user?.isSystemAdmin || !adminProjectId) return;
    const from = range === 'custom' && customFrom ? new Date(customFrom).toISOString() : report?.from;
    const to = range === 'custom' && customTo ? new Date(customTo).toISOString() : new Date().toISOString();
    if (!from) return;
    setExporting(true);
    setExportError(null);
    try {
      const { data } = await apiClient.get('/nonconformities/full-export', { params: { projectId: adminProjectId, from, to } });
      if (data.nonconformities.length === 0) {
        setExportError('Bu tarih aralığında kayıt bulunamadı.');
        return;
      }
      const rows = [
        ['Numara', 'Durum', 'Öncelik', 'Açıklama', 'Kategori', 'Blok/Bölge', 'Firma', 'Açan', 'Atananlar', 'Açılış Tarihi', 'Termin Tarihi', 'Kapanış Tarihi'],
        ...data.nonconformities.map((n) => [
          n.number,
          n.status,
          n.priority,
          n.description,
          n.categoryName || '',
          n.blockName || '',
          n.companyName || '',
          n.openedByName || '',
          n.assigneeNames || '',
          n.createdAt,
          n.dueDate,
          n.closedAt || '',
        ]),
      ];
      downloadCsv(rows, `uygunsuzluklar-${from.slice(0, 10)}_${to.slice(0, 10)}.csv`);
    } catch (err) {
      setExportError(getErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  function handleExport() {
    if (!report) return;
    const rows = [
      ['Dönem', RANGE_LABELS[report.range]],
      ['Projede açılan toplam', report.totalOpened],
      ['Kendi açtığım', report.myOpened],
      ['Bana atanan', report.myAssigned],
      ['Kapattığım', report.myClosed],
      [],
      ['Firma', 'Açılan', 'Kapatılan'],
      ...(report.companyBreakdown || []).map((c) => [c.companyName, c.opened, c.closed]),
    ];
    downloadCsv(rows, `rapor-${report.range}-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800">Raporlar</h1>
        {hasPermission('rapor_alma') && report && (
          <Button variant="secondary" onClick={handleExport}>
            CSV İndir
          </Button>
        )}
      </div>

      {error && <Alert>{error}</Alert>}

      {user?.isSystemAdmin && adminProjects && (
        <Select label="Proje" value={adminProjectId} onChange={(e) => setAdminProjectId(e.target.value)}>
          {adminProjects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      )}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:flex-wrap">
        {Object.entries(RANGE_LABELS).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setRange(value)}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${
              range === value ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {range === 'custom' && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <Input label="Başlangıç" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </div>
          <div className="flex-1">
            <Input label="Bitiş" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        </div>
      )}

      {user?.isSystemAdmin && adminProjectId && (
        <div>
          {exportError && <Alert>{exportError}</Alert>}
          <Button variant="secondary" onClick={handleFullExport} disabled={exporting}>
            {exporting ? 'Hazırlanıyor...' : '📄 Tüm Kayıtları CSV Olarak İndir'}
          </Button>
          <p className="mt-1 text-xs text-slate-500">
            Seçili tarih aralığındaki (özel aralık seçmediyseniz bu dönemin başlangıcından bugüne kadar olan) tüm
            uygunsuzluk kayıtlarını, tüm alanlarıyla birlikte indirir.
          </p>
        </div>
      )}

      {range === 'custom' && (!customFrom || !customTo) && !error && (
        <p className="text-sm text-slate-500">Rapor görmek için başlangıç ve bitiş tarihi seçin.</p>
      )}

      {!report && !error && range !== 'custom' && <p className="text-sm text-slate-500">Yükleniyor...</p>}

      {report && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <div className="text-3xl font-bold text-slate-800">{report.totalOpened}</div>
            <div className="mt-1 text-sm text-slate-500">Projede bu dönemde açılan toplam uygunsuzluk</div>
          </Card>
          <Card>
            <div className="text-3xl font-bold text-brand-700">{report.myOpened}</div>
            <div className="mt-1 text-sm text-slate-500">Bu dönemde kendi açtığım uygunsuzluk</div>
          </Card>
          <Card>
            <div className="text-3xl font-bold text-amber-700">{report.myAssigned}</div>
            <div className="mt-1 text-sm text-slate-500">Bu dönemde bana atanan uygunsuzluk</div>
          </Card>
          <Card>
            <div className="text-3xl font-bold text-emerald-700">{report.myClosed}</div>
            <div className="mt-1 text-sm text-slate-500">Bu dönemde kapattığım uygunsuzluk</div>
          </Card>
        </div>
      )}

      {report?.companyBreakdown?.length > 0 && (
        <Card>
          <h2 className="mb-3 font-semibold text-slate-800">Firma Bazlı Kırılım</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                  <th className="py-2 pr-4">Firma</th>
                  <th className="py-2 pr-4">Açılan</th>
                  <th className="py-2 pr-4">Kapatılan</th>
                </tr>
              </thead>
              <tbody>
                {report.companyBreakdown.map((c) => (
                  <tr key={c.companyId || 'none'} className="border-b border-slate-100">
                    <td className="py-2 pr-4 text-slate-800">{c.companyName}</td>
                    <td className="py-2 pr-4">{c.opened}</td>
                    <td className="py-2 pr-4 text-emerald-700">{c.closed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
