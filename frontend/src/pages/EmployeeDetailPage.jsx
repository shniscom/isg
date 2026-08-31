import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Alert, Badge, Button, Input } from '../components/ui';
import { STATUS_LABELS, STATUS_BADGE_VARIANT, PRIORITY_LABELS, PRIORITY_BADGE_VARIANT, formatDate } from '../lib/nonconformity';
import { trainingStatusChip, medicalExamStatusChip } from '../lib/employee';

const CHIP_TONE_CLASS = {
  default: 'bg-slate-100 text-slate-600',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-700',
};

function StatusChip({ chip }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${CHIP_TONE_CLASS[chip.tone] || CHIP_TONE_CLASS.default}`}>{chip.text}</span>;
}

function toDateInput(value) {
  return value ? value.slice(0, 10) : '';
}

export function EmployeeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, hasPermission } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState(null);

  const [showExit, setShowExit] = useState(false);
  const [exitDate, setExitDate] = useState('');
  const [exitSubmitting, setExitSubmitting] = useState(false);

  const [deleting, setDeleting] = useState(false);

  function load() {
    apiClient
      .get(`/employees/${id}/nonconformities`)
      .then(({ data }) => setData(data))
      .catch((err) => setError(getErrorMessage(err)));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canManage = user?.isSystemAdmin || hasPermission('uygunsuzluk_acma');

  function openEdit() {
    setEditError(null);
    setEditForm({
      fullName: data.employee.fullName || '',
      nationalId: data.employee.nationalId || '',
      position: data.employee.position || '',
      isgTrainingDate: toDateInput(data.employee.isgTrainingDate),
      isgTrainingExpiryDate: toDateInput(data.employee.isgTrainingExpiryDate),
      medicalExamDate: toDateInput(data.employee.medicalExamDate),
      startWorkTrainingNote: data.employee.startWorkTrainingNote || '',
      ek2Note: data.employee.ek2Note || '',
      healthAuthoritySignatureNote: data.employee.healthAuthoritySignatureNote || '',
      isgRole: data.employee.isgRole || '',
      mykCertificateNo: data.employee.mykCertificateNo || '',
      mykCertificateDate: toDateInput(data.employee.mykCertificateDate),
      startDate: toDateInput(data.employee.startDate),
    });
    setShowEdit(true);
  }

  async function handleSaveEdit() {
    setEditSubmitting(true);
    setEditError(null);
    try {
      await apiClient.patch(`/employees/${id}`, {
        fullName: editForm.fullName.trim(),
        nationalId: editForm.nationalId.trim() || null,
        position: editForm.position.trim() || null,
        isgTrainingDate: editForm.isgTrainingDate || null,
        isgTrainingExpiryDate: editForm.isgTrainingExpiryDate || null,
        medicalExamDate: editForm.medicalExamDate || null,
        startWorkTrainingNote: editForm.startWorkTrainingNote.trim() || null,
        ek2Note: editForm.ek2Note.trim() || null,
        healthAuthoritySignatureNote: editForm.healthAuthoritySignatureNote.trim() || null,
        isgRole: editForm.isgRole.trim() || null,
        mykCertificateNo: editForm.mykCertificateNo.trim() || null,
        mykCertificateDate: editForm.mykCertificateDate || null,
        startDate: editForm.startDate || null,
      });
      setShowEdit(false);
      load();
    } catch (err) {
      setEditError(getErrorMessage(err));
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleSetExit() {
    setExitSubmitting(true);
    setError(null);
    try {
      await apiClient.patch(`/employees/${id}`, { endDate: exitDate || null });
      setShowExit(false);
      setExitDate('');
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setExitSubmitting(false);
    }
  }

  async function handleReactivate() {
    if (!window.confirm('Bu çalışanı yeniden aktif etmek istediğinize emin misiniz?')) return;
    try {
      await apiClient.patch(`/employees/${id}`, { endDate: null });
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function handleDelete() {
    if (!data) return;
    if (!window.confirm(`${data.employee.fullName} kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await apiClient.delete(`/employees/${id}`);
      navigate('/calisanlar');
    } catch (err) {
      setError(getErrorMessage(err));
      setDeleting(false);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="text-sm text-slate-500">Yükleniyor...</p>;

  const { employee, nonconformities } = data;
  const trainingChip = trainingStatusChip(employee);
  const medicalChip = medicalExamStatusChip(employee);
  // Yeniden işe alım: en son çıkış tarihi kayıtlıysa ve mevcut giriş tarihi o çıkıştan sonraysa
  // (yani aradan bir çıkış geçip yeniden aktif edilmişse) "ilk giriş / çıkış / yeniden giriş"
  // bilgisini birlikte gösteririz - bkz. backend schema.js employees.lastExitDate yorumu.
  const isRehire =
    employee.isActive &&
    employee.lastExitDate &&
    employee.startDate &&
    new Date(employee.startDate) > new Date(employee.lastExitDate);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link to="/calisanlar" className="text-sm text-brand-700 hover:underline">
        ‹ Çalışanlar
      </Link>

      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-slate-800">{employee.fullName}</h1>
            {employee.position && <p className="text-sm text-slate-500">{employee.position}</p>}
          </div>
          {!employee.isActive && <Badge variant="danger">Arşivde</Badge>}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <StatusChip chip={trainingChip} />
          <StatusChip chip={medicalChip} />
          {employee.isgRole && <span className="rounded-full bg-purple-100 px-2.5 py-1 text-xs font-medium text-purple-700">🦺 İSG Görevi: {employee.isgRole}</span>}
          {employee.mykCertificateNo && <span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-medium text-teal-700">🎓 MYK: {employee.mykCertificateNo}</span>}
        </div>

        {isRehire && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm">
            <p className="mb-1.5 font-medium text-blue-800">🔄 Yeniden İşe Alım</p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-blue-900 sm:grid-cols-3">
              <div>
                <span className="block text-xs text-blue-600">İlk Giriş Tarihi</span>
                {employee.firstStartDate ? formatDate(employee.firstStartDate) : '—'}
              </div>
              <div>
                <span className="block text-xs text-blue-600">Çıkış Tarihi</span>
                {formatDate(employee.lastExitDate)}
              </div>
              <div>
                <span className="block text-xs text-blue-600">Yeniden Giriş Tarihi</span>
                {formatDate(employee.startDate)}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm text-slate-600 sm:grid-cols-2">
          {employee.nationalId && (
            <div>
              <span className="text-slate-400">TC:</span> {employee.nationalId}
            </div>
          )}
          <div>
            <span className="text-slate-400">{isRehire ? 'Giriş Tarihi (yeniden):' : 'Giriş Tarihi:'}</span>{' '}
            {employee.startDate ? formatDate(employee.startDate) : '—'}
          </div>
          {employee.endDate && (
            <div>
              <span className="text-slate-400">Çıkış Tarihi:</span> {formatDate(employee.endDate)}
            </div>
          )}
          {employee.isgTrainingDate && (
            <div>
              <span className="text-slate-400">Eğitim Aldığı Tarih:</span> {formatDate(employee.isgTrainingDate)}
            </div>
          )}
          {employee.isgTrainingExpiryDate && (
            <div>
              <span className="text-slate-400">Eğitim Geçerlilik Tarihi:</span> {formatDate(employee.isgTrainingExpiryDate)}
            </div>
          )}
          {employee.medicalExamDate && (
            <div>
              <span className="text-slate-400">Tetkik Tarihi:</span> {formatDate(employee.medicalExamDate)}
            </div>
          )}
          {employee.startWorkTrainingNote && (
            <div>
              <span className="text-slate-400">İşe Başlama Eğitimi:</span> {employee.startWorkTrainingNote}
            </div>
          )}
          {employee.ek2Note && (
            <div>
              <span className="text-slate-400">EK-2:</span> {employee.ek2Note}
            </div>
          )}
          {employee.healthAuthoritySignatureNote && (
            <div>
              <span className="text-slate-400">Sağlık Yetkilisi İmzası:</span> {employee.healthAuthoritySignatureNote}
            </div>
          )}
        </div>

        {canManage && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={openEdit}>
              Düzenle
            </Button>
            {employee.isActive ? (
              <Button type="button" variant="danger" onClick={() => setShowExit((v) => !v)}>
                Çıkış Tarihi Gir
              </Button>
            ) : (
              <Button type="button" variant="ghost" onClick={handleReactivate}>
                Yeniden Aktif Et
              </Button>
            )}
          </div>
        )}

        {user?.isSystemAdmin && (
          <div className="border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
            >
              {deleting ? 'Siliniyor...' : '🗑 Çalışanı Kalıcı Olarak Sil'}
            </button>
          </div>
        )}

        {showExit && (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            <Input label="Çıkış Tarihi" type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />
            <Button type="button" variant="danger" onClick={handleSetExit} disabled={exitSubmitting || !exitDate}>
              {exitSubmitting ? 'Kaydediliyor...' : 'Çıkışı Onayla ve Arşivle'}
            </Button>
          </div>
        )}

        {showEdit && editForm && (
          <div className="space-y-3 rounded-xl bg-slate-50 p-3">
            {editError && <Alert>{editError}</Alert>}
            <Input label="Ad Soyad" value={editForm.fullName} onChange={(e) => setEditForm((f) => ({ ...f, fullName: e.target.value }))} />
            <Input label="TC Kimlik No" value={editForm.nationalId} onChange={(e) => setEditForm((f) => ({ ...f, nationalId: e.target.value }))} />
            <Input label="Görevi (SGK İş Kolu)" value={editForm.position} onChange={(e) => setEditForm((f) => ({ ...f, position: e.target.value }))} />
            <Input label="Giriş Tarihi" type="date" value={editForm.startDate} onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))} />
            <Input
              label="Eğitim Aldığı Tarih"
              type="date"
              value={editForm.isgTrainingDate}
              onChange={(e) => setEditForm((f) => ({ ...f, isgTrainingDate: e.target.value }))}
            />
            <Input
              label="Eğitim Geçerlilik Tarihi"
              type="date"
              value={editForm.isgTrainingExpiryDate}
              onChange={(e) => setEditForm((f) => ({ ...f, isgTrainingExpiryDate: e.target.value }))}
            />
            <Input
              label="Tetkik Tarihi"
              type="date"
              value={editForm.medicalExamDate}
              onChange={(e) => setEditForm((f) => ({ ...f, medicalExamDate: e.target.value }))}
            />
            <Input
              label="İşe Başlama Eğitimi"
              value={editForm.startWorkTrainingNote}
              onChange={(e) => setEditForm((f) => ({ ...f, startWorkTrainingNote: e.target.value }))}
            />
            <Input label="EK-2" value={editForm.ek2Note} onChange={(e) => setEditForm((f) => ({ ...f, ek2Note: e.target.value }))} />
            <Input
              label="Sağlık Yetkilisi İmzası"
              value={editForm.healthAuthoritySignatureNote}
              onChange={(e) => setEditForm((f) => ({ ...f, healthAuthoritySignatureNote: e.target.value }))}
            />
            <Input label="İSG Görevi" value={editForm.isgRole} onChange={(e) => setEditForm((f) => ({ ...f, isgRole: e.target.value }))} />
            <Input label="MYK Belge No" value={editForm.mykCertificateNo} onChange={(e) => setEditForm((f) => ({ ...f, mykCertificateNo: e.target.value }))} />
            <Input
              label="MYK Belge Tarihi"
              type="date"
              value={editForm.mykCertificateDate}
              onChange={(e) => setEditForm((f) => ({ ...f, mykCertificateDate: e.target.value }))}
            />
            <div className="flex gap-2">
              <Button type="button" onClick={handleSaveEdit} disabled={editSubmitting}>
                {editSubmitting ? 'Kaydediliyor...' : 'Kaydet'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowEdit(false)}>
                Vazgeç
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Uygunsuzluk Geçmişi ({nonconformities.length})</h2>
        {nonconformities.length === 0 ? (
          <p className="text-sm text-slate-400">Bu çalışana bağlı kayıt yok.</p>
        ) : (
          <div className="space-y-2">
            {nonconformities.map((n) => (
              <Link key={n.id} to={`/uygunsuzluklar/${n.id}`}>
                <div className="rounded-xl bg-slate-50 px-4 py-3 transition hover:bg-slate-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">{n.number}</span>
                    <Badge variant={STATUS_BADGE_VARIANT[n.status]}>{STATUS_LABELS[n.status]}</Badge>
                    <Badge variant={PRIORITY_BADGE_VARIANT[n.priority]}>{PRIORITY_LABELS[n.priority]}</Badge>
                    <span className="ml-auto text-xs text-slate-400">{formatDate(n.createdAt)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-700">{n.description}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
