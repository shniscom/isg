import { useEffect, useState } from 'react';
import apiClient, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Select, Alert, Button } from '../components/ui';

const RANGE_LABELS = { today: 'Bugün', week: 'Bu Hafta (son 7 gün)', month: 'Bu Ay (son 30 gün)' };

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
    try {
      const params = { range };
      if (user?.isSystemAdmin) params.projectId = adminProjectId;
      const { data } = await apiClient.get('/nonconformities/report', { params });
      setReport(data);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, adminProjectId]);

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

      <div className="flex gap-2">
        {Object.entries(RANGE_LABELS).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setRange(value)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              range === value ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!report && !error && <p className="text-sm text-slate-500">Yükleniyor...</p>}

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
