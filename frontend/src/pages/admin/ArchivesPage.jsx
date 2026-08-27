import { useEffect, useState } from 'react';
import apiClient, { getErrorMessage } from '../../api/client';
import { Card, Button, Select, Alert, Badge } from '../../components/ui';

const STATUS_LABELS = { OLUSTURULDU: 'Oluşturuldu (sunucuda hâlâ duruyor)', SILINDI: 'Silindi (sunucudan kaldırıldı)' };
const STATUS_VARIANT = { OLUSTURULDU: 'warning', SILINDI: 'default' };

/** Son 24 ay için 'YYYY-MM' etiketleri üretir (en yeni ay en üstte). */
function recentPeriods(count = 24) {
  const periods = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return periods;
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('tr-TR');
}

export function ArchivesPage() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [periodLabel, setPeriodLabel] = useState(recentPeriods()[1] || ''); // varsayılan: geçen ay
  const [preview, setPreview] = useState(null);
  const [archiveList, setArchiveList] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    apiClient
      .get('/admin/projects')
      .then(({ data }) => {
        setProjects(data.projects);
        if (data.projects.length > 0) setSelectedProjectId(data.projects[0].id);
      })
      .catch((err) => setError(getErrorMessage(err)));
  }, []);

  async function loadArchiveList(projectId) {
    if (!projectId) return;
    try {
      const { data } = await apiClient.get('/admin/archives', { params: { projectId } });
      setArchiveList(data.archives);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function loadPreview(projectId, period) {
    if (!projectId || !period) return;
    try {
      const { data } = await apiClient.get('/admin/archives/preview', { params: { projectId, periodLabel: period } });
      setPreview(data);
    } catch (err) {
      setError(getErrorMessage(err));
      setPreview(null);
    }
  }

  useEffect(() => {
    setError(null);
    loadArchiveList(selectedProjectId);
    loadPreview(selectedProjectId, periodLabel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, periodLabel]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const { data } = await apiClient.get('/admin/archives/generate', {
        params: { projectId: selectedProjectId, periodLabel },
        responseType: 'blob',
      });
      const project = projects.find((p) => p.id === selectedProjectId);
      const blob = new Blob([data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `arsiv_${(project?.code || project?.name || 'proje').replace(/\s+/g, '_')}_${periodLabel}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice(
        'Arşiv zip dosyası indirildi. Lütfen bu dosyayı kendi bilgisayarınıza/sisteminize kaydettiğinizden emin olun. Kaydettikten sonra aşağıdaki listeden bu dönemi "Sunucudan Sil" ile kaldırabilirsiniz.'
      );
      await loadArchiveList(selectedProjectId);
      await loadPreview(selectedProjectId, periodLabel);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  async function handleConfirmDelete(archive) {
    const ok = window.confirm(
      `${archive.periodLabel} dönemine ait ${archive.recordCount} uygunsuzluk kaydı (fotoğraflar dahil) sunucudan KALICI olarak silinecek. Zip dosyasını kendi sisteminize kaydettiğinizden emin misiniz? Bu işlem geri alınamaz.`
    );
    if (!ok) return;
    setDeletingId(archive.id);
    setError(null);
    setNotice(null);
    try {
      const { data } = await apiClient.post(`/admin/archives/${archive.id}/confirm-delete`);
      setNotice(`${data.deletedRecordCount} kayıt ve ${data.deletedPhotoCount} fotoğraf sunucudan silindi.`);
      await loadArchiveList(selectedProjectId);
      await loadPreview(selectedProjectId, periodLabel);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  const existingForPeriod = archiveList?.find((a) => a.periodLabel === periodLabel);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Arşiv</h1>
        <p className="mt-1 text-sm text-slate-500">
          Belirli bir proje ve ay için tüm uygunsuzluk kayıtlarını (fotoğraflar dahil) bir zip dosyası olarak
          indirin. İndirdiğiniz dosyayı kendi bilgisayarınıza/sisteminize kaydettikten sonra, sunucu yükünü
          azaltmak için o dönemin verilerini sunucudan kalıcı olarak silebilirsiniz. Zip içindeki{' '}
          <span className="font-mono text-xs">index.html</span> dosyasını çift tıklayarak, internet bağlantısı
          olmadan da arşivi masaüstünüzde görüntüleyebilirsiniz.
        </p>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Proje" value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select label="Dönem" value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)}>
            {recentPeriods().map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>

        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          {preview ? (
            <>
              Bu dönemde <span className="font-semibold text-slate-800">{preview.recordCount}</span> uygunsuzluk
              kaydı bulunuyor.
              {existingForPeriod && (
                <span className="ml-1">
                  Son üretim: {formatDateTime(existingForPeriod.createdAt)} ·{' '}
                  <Badge variant={STATUS_VARIANT[existingForPeriod.status]}>{STATUS_LABELS[existingForPeriod.status]}</Badge>
                </span>
              )}
            </>
          ) : (
            'Yükleniyor...'
          )}
        </div>

        <div className="mt-4">
          <Button onClick={handleGenerate} disabled={generating || !preview || preview.recordCount === 0}>
            {generating ? 'Zip hazırlanıyor...' : '📦 Zip Olarak İndir'}
          </Button>
          {preview?.recordCount === 0 && (
            <p className="mt-2 text-xs text-slate-400">Bu dönemde arşivlenecek kayıt yok.</p>
          )}
        </div>
      </Card>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-600">Bu Projenin Arşiv Geçmişi</h2>
        <div className="space-y-2">
          {archiveList === null && <p className="text-sm text-slate-500">Yükleniyor...</p>}
          {archiveList?.length === 0 && <p className="text-sm text-slate-500">Henüz arşiv oluşturulmamış.</p>}
          {archiveList?.map((a) => (
            <Card key={a.id} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-800">{a.periodLabel}</span>
                  <Badge variant={STATUS_VARIANT[a.status]}>{STATUS_LABELS[a.status]}</Badge>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {a.recordCount} kayıt · Üreten: {a.createdByName || '—'} · {formatDateTime(a.createdAt)}
                  {a.status === 'SILINDI' && <span> · Silindi: {formatDateTime(a.deletedAt)}</span>}
                </div>
              </div>
              {a.status === 'OLUSTURULDU' && (
                <Button
                  variant="danger"
                  disabled={deletingId === a.id}
                  onClick={() => handleConfirmDelete(a)}
                >
                  {deletingId === a.id ? 'Siliniyor...' : '🗑️ Sunucudan Sil'}
                </Button>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
