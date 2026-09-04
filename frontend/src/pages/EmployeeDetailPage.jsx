import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Alert, Badge, Button, Input } from '../components/ui';
import { STATUS_LABELS, STATUS_BADGE_VARIANT, PRIORITY_LABELS, PRIORITY_BADGE_VARIANT, formatDate } from '../lib/nonconformity';
import { trainingStatusChip, medicalExamStatusChip, ek2StatusChip, MEDICAL_EXAM_TYPES } from '../lib/employee';
import { RoleAssignmentSelect } from '../components/RoleAssignmentSelect';

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
  const [notice, setNotice] = useState(null);

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

  const isTemp = !!data?.company?.isTemporaryAssignment;
  const canManage = user?.isSystemAdmin || hasPermission('uygunsuzluk_acma') || (isTemp && hasPermission('gecici_gorevlendirme_yonetimi'));
  const canDelete = user?.isSystemAdmin || (isTemp && hasPermission('gecici_gorevlendirme_yonetimi'));

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
      endDate: toDateInput(data.employee.endDate),
      assignmentFormExists: !!data.employee.assignmentFormExists,
      sgkEntryDocExists: !!data.employee.sgkEntryDocExists,
      orientationTrainingDate: toDateInput(data.employee.orientationTrainingDate),
      ppeHandoverDocExists: !!data.employee.ppeHandoverDocExists,
      ek2Suitable: !!data.employee.ek2Suitable,
      ek2Date: toDateInput(data.employee.ek2Date),
      isgSpecialistAssignmentId: data.employee.isgSpecialistAssignmentId || '',
      physicianAssignmentId: data.employee.physicianAssignmentId || '',
      dspAssignmentId: data.employee.dspAssignmentId || '',
      medicalExamTypes: data.employee.medicalExamTypes || [],
    });
    setShowEdit(true);
  }

  async function handleSaveEdit() {
    setEditSubmitting(true);
    setEditError(null);
    try {
      const payload = {
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
        ek2Suitable: editForm.ek2Suitable,
        ek2Date: editForm.ek2Date || null,
        isgSpecialistAssignmentId: editForm.isgSpecialistAssignmentId || null,
        physicianAssignmentId: editForm.physicianAssignmentId || null,
        dspAssignmentId: editForm.dspAssignmentId || null,
        medicalExamTypes: editForm.medicalExamTypes,
      };
      if (isTemp) {
        payload.endDate = editForm.endDate || null;
        payload.assignmentFormExists = editForm.assignmentFormExists;
        payload.sgkEntryDocExists = editForm.sgkEntryDocExists;
        payload.orientationTrainingDate = editForm.orientationTrainingDate || null;
        payload.ppeHandoverDocExists = editForm.ppeHandoverDocExists;
      }
      const { data: res } = await apiClient.patch(`/employees/${id}`, payload);
      setShowEdit(false);
      if (res?.queued) {
        setNotice(res.message || 'Değişiklik admin onayına gönderildi.');
      } else {
        load();
      }
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
  const ek2Chip = ek2StatusChip(employee);
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
        {notice && <Alert variant="success">{notice}</Alert>}
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-slate-800">{employee.fullName}</h1>
            {employee.position && <p className="text-sm text-slate-500">{employee.position}</p>}
            {data.company?.name && <p className="text-xs text-slate-400">{data.company.name}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {isTemp && <Badge variant="warning">🕐 Geçici Görevlendirme</Badge>}
            {!employee.isActive && <Badge variant="danger">Arşivde</Badge>}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <StatusChip chip={trainingChip} />
          <StatusChip chip={medicalChip} />
          <StatusChip chip={ek2Chip} />
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
          {isTemp && employee.orientationTrainingDate && (
            <div>
              <span className="text-slate-400">Oryantasyon Eğitimi:</span> {formatDate(employee.orientationTrainingDate)}
            </div>
          )}
          {employee.ek2Date && (
            <div>
              <span className="text-slate-400">Ek-2 Tarihi:</span> {formatDate(employee.ek2Date)}
            </div>
          )}
          {employee.medicalExamTypes && employee.medicalExamTypes.length > 0 && (
            <div>
              <span className="text-slate-400">Yapılan Tetkikler:</span> {employee.medicalExamTypes.join(', ')}
            </div>
          )}
          {employee.physicianAssignment && (
            <div>
              <span className="text-slate-400">İşyeri Hekimi:</span> {employee.physicianAssignment.fullName}
              {employee.physicianAssignment.certificateNo ? ` (Sertifika: ${employee.physicianAssignment.certificateNo})` : ''}
              {employee.physicianAssignment.certificateEndDate ? ' — Ayrıldı' : ''}
            </div>
          )}
          {employee.isgSpecialistAssignment && (
            <div>
              <span className="text-slate-400">İSG Uzmanı:</span> {employee.isgSpecialistAssignment.fullName}
              {employee.isgSpecialistAssignment.certificateClass ? ` (${employee.isgSpecialistAssignment.certificateClass})` : ''}
              {employee.isgSpecialistAssignment.certificateNo ? ` Sertifika: ${employee.isgSpecialistAssignment.certificateNo}` : ''}
              {employee.isgSpecialistAssignment.certificateEndDate ? ' — Ayrıldı' : ''}
            </div>
          )}
          {employee.dspAssignment && (
            <div>
              <span className="text-slate-400">DSP:</span> {employee.dspAssignment.fullName}
              {employee.dspAssignment.certificateEndDate ? ' — Ayrıldı' : ''}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-2.5">
          {employee.medicalExamDate && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">✓ Tetkik Yapıldı</span>
          )}
          {employee.ek2Date && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${employee.ek2Suitable ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
              {employee.ek2Suitable ? '✓' : '✗'} Ek-2 (İşe Uygunluk)
            </span>
          )}
          {isTemp && (
            <>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${employee.assignmentFormExists ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {employee.assignmentFormExists ? '✓' : '✗'} Görevlendirme Formu
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${employee.sgkEntryDocExists ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {employee.sgkEntryDocExists ? '✓' : '✗'} SGK Giriş Belgesi
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${employee.ppeHandoverDocExists ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                {employee.ppeHandoverDocExists ? '✓' : '✗'} KKD Zimmet Tutanağı
              </span>
            </>
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

        {canDelete && (
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
            <Input
              label="Ek-2 Tarihi"
              type="date"
              value={editForm.ek2Date}
              onChange={(e) => setEditForm((f) => ({ ...f, ek2Date: e.target.value }))}
            />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={editForm.ek2Suitable}
                onChange={(e) => setEditForm((f) => ({ ...f, ek2Suitable: e.target.checked }))}
              />
              Ek-2 formuna göre işe uygun
            </label>
            {editForm.medicalExamDate && (
              <div>
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Tetkik Türleri</span>
                <div className="flex flex-wrap gap-2">
                  {MEDICAL_EXAM_TYPES.map((t) => {
                    const checked = editForm.medicalExamTypes.includes(t);
                    return (
                      <label key={t} className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs ${checked ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-300 text-slate-600'}`}>
                        <input
                          type="checkbox"
                          className="hidden"
                          checked={checked}
                          onChange={() =>
                            setEditForm((f) => ({
                              ...f,
                              medicalExamTypes: checked ? f.medicalExamTypes.filter((x) => x !== t) : [...f.medicalExamTypes, t],
                            }))
                          }
                        />
                        {checked ? '✓ ' : ''}
                        {t}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <RoleAssignmentSelect
              companyId={data.employee.companyId}
              roleType="ISYERI_HEKIMI"
              label="İşyeri Hekimi"
              value={editForm.physicianAssignmentId}
              onChange={(id) => setEditForm((f) => ({ ...f, physicianAssignmentId: id }))}
            />
            <RoleAssignmentSelect
              companyId={data.employee.companyId}
              roleType="ISG_UZMANI"
              label="İSG Uzmanı (eğitimi veren)"
              value={editForm.isgSpecialistAssignmentId}
              onChange={(id) => setEditForm((f) => ({ ...f, isgSpecialistAssignmentId: id }))}
            />
            <RoleAssignmentSelect
              companyId={data.employee.companyId}
              roleType="DIGER_SAGLIK_PERSONELI"
              label="DSP (Diğer Sağlık Personeli)"
              value={editForm.dspAssignmentId}
              onChange={(id) => setEditForm((f) => ({ ...f, dspAssignmentId: id }))}
            />
            {isTemp && (
              <div className="space-y-2.5 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                <p className="text-xs font-semibold text-amber-800">🕐 Geçici Görevlendirme Bilgileri</p>
                <Input
                  label="Görev Bitiş Tarihi"
                  type="date"
                  value={editForm.endDate}
                  onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))}
                />
                <Input
                  label="Oryantasyon Eğitim Tarihi"
                  type="date"
                  value={editForm.orientationTrainingDate}
                  onChange={(e) => setEditForm((f) => ({ ...f, orientationTrainingDate: e.target.value }))}
                />
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={editForm.assignmentFormExists}
                    onChange={(e) => setEditForm((f) => ({ ...f, assignmentFormExists: e.target.checked }))}
                  />
                  Görevlendirme formu var
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={editForm.sgkEntryDocExists}
                    onChange={(e) => setEditForm((f) => ({ ...f, sgkEntryDocExists: e.target.checked }))}
                  />
                  SGK giriş belgesi var
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={editForm.ppeHandoverDocExists}
                    onChange={(e) => setEditForm((f) => ({ ...f, ppeHandoverDocExists: e.target.checked }))}
                  />
                  KKD zimmet tutanağı var
                </label>
              </div>
            )}
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
