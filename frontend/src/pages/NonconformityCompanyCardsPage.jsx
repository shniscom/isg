import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Button, Select, Alert, Badge } from '../components/ui';

/** Bir firma/genel kart için açık/bekleyen/kapalı/kaza/ramak kala/ceza rozetlerini gösterir. */
function SummaryBadges({ counts, kazaCount, ramakKalaCount, penaltyCount }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
      <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">Açık: {counts.ACIK || 0}</span>
      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">Bekleyen: {counts.BEKLEMEDE || 0}</span>
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">Kapalı: {counts.KAPALI || 0}</span>
      {kazaCount > 0 && <span className="rounded-full bg-slate-800 px-2 py-0.5 font-medium text-white">🚨 Kaza: {kazaCount}</span>}
      {ramakKalaCount > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">⚠️ Ramak Kala: {ramakKalaCount}</span>}
      {penaltyCount > 0 && <span className="rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-700">⚖️ Ceza: {penaltyCount}</span>}
    </div>
  );
}

export function NonconformityCompanyCardsPage() {
  const { user, hasPermission } = useAuth();
  const [summary, setSummary] = useState(null);
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
      const params = user?.isSystemAdmin ? { projectId: adminProjectId } : {};
      const { data } = await apiClient.get('/nonconformities/company-summary', { params });
      setSummary(data);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminProjectId]);

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

      {error && <Alert>{error}</Alert>}

      {!summary && !error && <p className="text-sm text-slate-500">Yükleniyor...</p>}

      {summary && (
        <div className="space-y-3">
          <Link to="/uygunsuzluklar/liste">
            <Card className="border-2 border-brand-200 bg-brand-50/40 transition hover:border-brand-400 hover:shadow-md">
              <div className="flex items-center gap-2">
                <span className="text-xl">📋</span>
                <span className="text-lg font-bold text-slate-800">Genel</span>
                <Badge variant="info">Tüm görebildiğiniz kayıtlar</Badge>
              </div>
              <SummaryBadges
                counts={summary.overall.counts}
                kazaCount={summary.overall.kazaCount}
                ramakKalaCount={summary.overall.ramakKalaCount}
                penaltyCount={summary.overall.penaltyCount}
              />
            </Card>
          </Link>

          {summary.companies.length === 0 && (
            <p className="text-sm text-slate-500">Sorumlu olduğunuz bir firma bulunmuyor. Firma bazlı görev ataması için yöneticinize başvurun.</p>
          )}

          {summary.companies.map((c) => (
            <Link key={c.companyId} to={`/uygunsuzluklar/liste?companyId=${c.companyId}`}>
              <Card className="transition hover:border-brand-300 hover:shadow-md">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🏢</span>
                  <span className="font-semibold text-slate-800">{c.companyName}</span>
                </div>
                <SummaryBadges counts={c.counts} kazaCount={c.kazaCount} ramakKalaCount={c.ramakKalaCount} penaltyCount={c.penaltyCount} />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
