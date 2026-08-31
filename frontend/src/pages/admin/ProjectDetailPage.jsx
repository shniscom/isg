import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../../api/client';
import { Card, Button, Input, Alert, Badge } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

export function ProjectDetailPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [error, setError] = useState(null);
  const [newBlockName, setNewBlockName] = useState('');
  const [blockError, setBlockError] = useState(null);
  const { user } = useAuth();
  const [showReset, setShowReset] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [resetError, setResetError] = useState(null);
  const [resetNotice, setResetNotice] = useState(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);

  const [showEditInfo, setShowEditInfo] = useState(false);
  const [infoForm, setInfoForm] = useState({ name: '', code: '' });
  const [infoError, setInfoError] = useState(null);
  const [infoNotice, setInfoNotice] = useState(null);
  const [infoSubmitting, setInfoSubmitting] = useState(false);

  async function load() {
    try {
      const { data } = await apiClient.get(`/admin/projects/${id}`);
      setProject(data.project);
      setBlocks(data.blocks);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleAddBlock(e) {
    e.preventDefault();
    setBlockError(null);
    if (!newBlockName.trim()) return;
    try {
      await apiClient.post(`/admin/projects/${id}/blocks`, { name: newBlockName.trim() });
      setNewBlockName('');
      await load();
    } catch (err) {
      setBlockError(getErrorMessage(err));
    }
  }

  async function handleDeleteBlock(blockId) {
    await apiClient.delete(`/admin/projects/${id}/blocks/${blockId}`);
    await load();
  }

  function openEditInfo() {
    setInfoForm({ name: project.name, code: project.code });
    setInfoError(null);
    setInfoNotice(null);
    setShowEditInfo(true);
  }

  async function handleSaveInfo(e) {
    e.preventDefault();
    setInfoError(null);
    setInfoNotice(null);
    setInfoSubmitting(true);
    try {
      const { data } = await apiClient.patch(`/admin/projects/${id}`, { name: infoForm.name, code: infoForm.code });
      setInfoNotice(
        data.queued
          ? 'Proje bilgisi değişikliği admin onayına gönderildi. Admin onaylarsa uygulanacak.'
          : 'Proje bilgileri güncellendi.'
      );
      setShowEditInfo(false);
      await load();
    } catch (err) {
      setInfoError(getErrorMessage(err));
    } finally {
      setInfoSubmitting(false);
    }
  }

  // Uygunsuzluk numarası formatı: {YIL}-{PROJE_KODU}-{6 haneli sıra no}, bkz.
  // backend/src/services/nonconformity.service.js -> generateNonconformityNumber.
  // Bir sonraki üretilecek numara, projenin mevcut sırasının bir fazlasıdır.
  function previewNonconformityNumber(code) {
    const year = new Date().getFullYear();
    const nextSeq = (project?.nonconformitySeq || 0) + 1;
    const seqPadded = String(nextSeq).padStart(6, '0');
    return `${year}-${(code || '???').trim() || '???'}-${seqPadded}`;
  }

  async function handleResetProject(e) {
    e.preventDefault();
    setResetError(null);
    setResetSubmitting(true);
    try {
      const { data } = await apiClient.post(`/admin/projects/${id}/reset-nonconformities`, { confirmCode: resetCode });
      setResetNotice(`${data.deletedCount} uygunsuzluk kaydı kalıcı olarak silindi.`);
      setResetCode('');
      setShowReset(false);
    } catch (err) {
      setResetError(getErrorMessage(err));
    } finally {
      setResetSubmitting(false);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!project) return <p className="text-sm text-slate-500">Yükleniyor...</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/admin/projeler" className="text-sm text-brand-700 hover:underline">
        ‹ Projeler
      </Link>

      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-800">{project.name}</h1>
        <Badge variant={project.status === 'AKTIF' ? 'success' : 'default'}>{project.status}</Badge>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          {project.code} {project.address ? `· ${project.address}` : ''}
        </p>
        {!showEditInfo && (
          <button onClick={openEditInfo} className="shrink-0 text-xs font-medium text-brand-700 hover:underline">
            Düzenle
          </button>
        )}
      </div>

      {infoNotice && !showEditInfo && <Alert variant="success">{infoNotice}</Alert>}

      {showEditInfo && (
        <Card>
          <h2 className="mb-3 font-semibold text-slate-800">Proje Bilgilerini Düzenle</h2>
          <form onSubmit={handleSaveInfo} className="space-y-4">
            {infoError && <Alert>{infoError}</Alert>}
            <Input label="Proje Adı" value={infoForm.name} onChange={(e) => setInfoForm({ ...infoForm, name: e.target.value })} required />
            <Input label="Proje Kodu" value={infoForm.code} onChange={(e) => setInfoForm({ ...infoForm, code: e.target.value })} required />
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="text-xs text-slate-500">
                Bu kodla bundan sonra açılacak bir sonraki uygunsuzluğun numarası şöyle görünecek:
              </p>
              <p className="mt-1 font-mono text-sm font-semibold text-slate-800">{previewNonconformityNumber(infoForm.code)}</p>
              {infoForm.code !== project.code && (
                <p className="mt-1 text-xs text-amber-700">
                  Not: Daha önce "{project.code}" koduyla açılmış uygunsuzlukların numaraları değişmez; yalnızca bundan
                  sonra açılacaklar yeni kodu kullanır.
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <Button type="submit" disabled={infoSubmitting}>
                {infoSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowEditInfo(false)}>
                Vazgeç
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Blok / Bölge Tanımları</h2>
        <p className="mb-3 text-sm text-slate-500">Örn: A Blok, B Blok, Otopark, Şantiye Alanı, Depo, Sosyal Tesis</p>

        {blockError && <Alert>{blockError}</Alert>}

        <form onSubmit={handleAddBlock} className="mb-4 flex gap-2">
          <div className="flex-1">
            <Input placeholder="Örn: A Blok" value={newBlockName} onChange={(e) => setNewBlockName(e.target.value)} />
          </div>
          <Button type="submit">Ekle</Button>
        </form>

        <div className="flex flex-wrap gap-2">
          {blocks.length === 0 && <p className="text-sm text-slate-400">Henüz blok/bölge tanımlanmamış.</p>}
          {blocks.map((b) => (
            <span key={b.id} className="flex items-center gap-2 rounded-full bg-slate-100 py-1.5 pl-4 pr-2 text-sm">
              {b.name}
              <button
                onClick={() => handleDeleteBlock(b.id)}
                className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600"
                aria-label={`${b.name} sil`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </Card>

      {user?.isSystemAdmin && (
        <Card className="border-red-200 bg-red-50/40">
          <h2 className="mb-1 font-semibold text-red-800">Tehlikeli Bölge</h2>
          <p className="mb-3 text-sm text-red-700">
            Bu projeye ait TÜM uygunsuzluk kayıtlarını (fotoğraf, düzeltme, tarihçe ve ceza kayıtları dahil)
            kalıcı olarak siler. Proje/firma/kullanıcı tanımlarına dokunmaz. Yalnızca test/deneme sürecinde
            kullanılması önerilir; geri alınamaz.
          </p>

          {resetNotice && <Alert variant="success">{resetNotice}</Alert>}
          {resetError && <Alert>{resetError}</Alert>}

          {!showReset ? (
            <Button variant="danger" onClick={() => setShowReset(true)}>
              Projeyi Sıfırla
            </Button>
          ) : (
            <form onSubmit={handleResetProject} className="space-y-3">
              <Input
                label={`Onaylamak için proje kodunu yazın: "${project.code}"`}
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                required
              />
              <div className="flex gap-3">
                <Button type="submit" variant="danger" disabled={resetSubmitting || resetCode !== project.code}>
                  {resetSubmitting ? 'Siliniyor...' : 'Evet, Tüm Uygunsuzlukları Sil'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => { setShowReset(false); setResetCode(''); }}>
                  Vazgeç
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
