import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Button, Select, Textarea, Input, Alert } from '../components/ui';

/** Tek bir dosya (görsel veya PDF) seçip R2'ye presigned URL ile yükler, elde edilen key'i döner. */
function SingleFileUploader({ onUploaded, label = 'Dosya Yükle (Fotoğraf/PDF)' }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);

  async function handleFile(file) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { data } = await apiClient.post('/uploads/presign-upload', { fileName: file.name, contentType: file.type });
      const putRes = await fetch(data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!putRes.ok) throw new Error(`"${file.name}" yüklenemedi.`);
      setFileName(file.name);
      onUploaded(data.key);
    } catch (err) {
      setError(err.message || 'Dosya yüklenirken hata oluştu.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 transition hover:border-brand-400 hover:bg-brand-50">
        {uploading ? 'Yükleniyor...' : fileName ? `✓ ${fileName}` : '📎 Dosya Seç'}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

const EMPTY_FORM = {
  type: 'KAZA',
  companyId: '',
  eventDateTime: '',
  employeeId: '',
  eventDescription: '',
  location: '',
  cause: '',
  witnessEmployeeId: '',
  witnessStatement: '',
  referredToHospital: false,
  hospitalName: '',
  firstAidGiven: false,
  firstAidGivenBy: '',
  victimProfession: '',
  doctorReportPhotoKey: '',
  reportDaysOff: '',
  returnToWorkDate: '',
  actionsTaken: '',
};

export function NewIncidentPage() {
  const { user, hasPermission } = useAuth();
  const canReport = Boolean(user?.isSystemAdmin || hasPermission('kaza_bildirimi') || hasPermission('firma_yonetme'));

  const [adminProjects, setAdminProjects] = useState(null);
  const [adminProjectId, setAdminProjectId] = useState('');
  const activeProjectId = user?.isSystemAdmin ? adminProjectId : 'self';

  const [companies, setCompanies] = useState(null);
  const [companyEmployees, setCompanyEmployees] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

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

  useEffect(() => {
    if (!activeProjectId || !canReport) return;
    const params = user?.isSystemAdmin ? { projectId: activeProjectId } : {};
    setCompanies(null);
    apiClient
      .get('/admin/incidents/reference-data', { params })
      .then(({ data }) => setCompanies(data.companies))
      .catch((err) => setError(getErrorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, canReport]);

  useEffect(() => {
    setForm((f) => ({ ...f, employeeId: '', witnessEmployeeId: '' }));
    if (!form.companyId || !activeProjectId) {
      setCompanyEmployees([]);
      return;
    }
    const params = { companyId: form.companyId };
    if (user?.isSystemAdmin) params.projectId = activeProjectId;
    apiClient
      .get('/employees', { params })
      .then(({ data }) => setCompanyEmployees(data.employees))
      .catch(() => setCompanyEmployees([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.companyId, activeProjectId]);

  if (!canReport) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (user?.isSystemAdmin && !adminProjectId) {
      setError('Proje seçilmelidir.');
      return;
    }
    if (!form.companyId) {
      setError('Firma seçilmelidir.');
      return;
    }
    if (!form.eventDateTime || !form.eventDescription.trim()) {
      setError('Olay tarihi/saati ve olay şekli açıklaması zorunludur.');
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.post('/admin/incidents', {
        ...form,
        eventDateTime: new Date(form.eventDateTime).toISOString(),
        returnToWorkDate: form.returnToWorkDate ? new Date(form.returnToWorkDate).toISOString() : null,
        reportDaysOff: form.reportDaysOff ? Number(form.reportDaysOff) : null,
        employeeId: form.employeeId || null,
        witnessEmployeeId: form.witnessEmployeeId || null,
        witnessStatement: form.witnessEmployeeId ? form.witnessStatement : null,
        location: form.location || null,
        cause: form.cause || null,
        hospitalName: form.referredToHospital ? form.hospitalName : null,
        firstAidGivenBy: form.firstAidGiven ? form.firstAidGivenBy : null,
        victimProfession: form.victimProfession || null,
        doctorReportPhotoKey: form.doctorReportPhotoKey || null,
        actionsTaken: form.actionsTaken || null,
      });
      setNotice('Kayıt başarıyla eklendi.');
      setForm((f) => ({ ...EMPTY_FORM, companyId: f.companyId }));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/uygunsuzluklar" className="text-sm text-brand-700 hover:underline">
        ‹ Uygunsuzluklar
      </Link>
      <h1 className="text-2xl font-bold text-slate-800">Yeni Kaza / Ramak Kala Bildir</h1>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          {notice && <Alert variant="success">{notice}</Alert>}

          {user?.isSystemAdmin && adminProjects && (
            <Select label="Proje" value={adminProjectId} onChange={(e) => setAdminProjectId(e.target.value)} required>
              <option value="">Seçiniz</option>
              {adminProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}

          <Select label="Firma" value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))} required>
            <option value="">Seçiniz</option>
            {companies?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>

          <Select label="Tür" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
            <option value="KAZA">Kaza</option>
            <option value="RAMAK_KALA">Ramak Kala</option>
          </Select>

          <Input
            label="Olay Tarihi/Saati"
            type="datetime-local"
            value={form.eventDateTime}
            onChange={(e) => setForm((f) => ({ ...f, eventDateTime: e.target.value }))}
            required
          />

          <Textarea
            label="Olay Şekli"
            value={form.eventDescription}
            onChange={(e) => setForm((f) => ({ ...f, eventDescription: e.target.value }))}
            placeholder="Olayı detaylı açıklayın..."
            required
          />

          <Input label="Olay Yeri" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
          <Textarea label="Sebebi" value={form.cause} onChange={(e) => setForm((f) => ({ ...f, cause: e.target.value }))} />

          {form.type === 'KAZA' && (
            <>
              <Select
                label="Kazayı Geçiren Çalışan"
                value={form.employeeId}
                onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
                disabled={!form.companyId}
              >
                <option value="">Seçiniz</option>
                {companyEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.fullName}
                  </option>
                ))}
              </Select>
              <Input
                label="Kazazedenin Mesleği"
                value={form.victimProfession}
                onChange={(e) => setForm((f) => ({ ...f, victimProfession: e.target.value }))}
              />
            </>
          )}

          <Select
            label="Görgü Tanığı"
            value={form.witnessEmployeeId}
            onChange={(e) => setForm((f) => ({ ...f, witnessEmployeeId: e.target.value }))}
            disabled={!form.companyId}
          >
            <option value="">Yok</option>
            {companyEmployees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.fullName}
              </option>
            ))}
          </Select>
          {form.witnessEmployeeId && (
            <Textarea
              label="Görgü Tanığı İfadesi"
              value={form.witnessStatement}
              onChange={(e) => setForm((f) => ({ ...f, witnessStatement: e.target.value }))}
            />
          )}

          {form.type === 'KAZA' && (
            <>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.referredToHospital}
                  onChange={(e) => setForm((f) => ({ ...f, referredToHospital: e.target.checked }))}
                />
                Hastaneye sevk edildi
              </label>
              {form.referredToHospital && (
                <Input
                  label="Sevk Edilen Hastane"
                  value={form.hospitalName}
                  onChange={(e) => setForm((f) => ({ ...f, hospitalName: e.target.value }))}
                />
              )}

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.firstAidGiven}
                  onChange={(e) => setForm((f) => ({ ...f, firstAidGiven: e.target.checked }))}
                />
                İlk yardım müdahalesi yapıldı
              </label>
              {form.firstAidGiven && (
                <Input
                  label="Kim Tarafından Yapıldı"
                  value={form.firstAidGivenBy}
                  onChange={(e) => setForm((f) => ({ ...f, firstAidGivenBy: e.target.value }))}
                />
              )}

              <SingleFileUploader
                label="Doktor Raporu (Görsel/PDF, opsiyonel)"
                onUploaded={(key) => setForm((f) => ({ ...f, doctorReportPhotoKey: key }))}
              />

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Rapor (Gün)"
                  type="number"
                  min="0"
                  value={form.reportDaysOff}
                  onChange={(e) => setForm((f) => ({ ...f, reportDaysOff: e.target.value }))}
                />
                <Input
                  label="İşe Başlama Tarihi"
                  type="date"
                  value={form.returnToWorkDate}
                  onChange={(e) => setForm((f) => ({ ...f, returnToWorkDate: e.target.value }))}
                />
              </div>
            </>
          )}

          <Textarea label="Alınan Aksiyon" value={form.actionsTaken} onChange={(e) => setForm((f) => ({ ...f, actionsTaken: e.target.value }))} />

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Kaydediliyor...' : 'Kaydı Ekle'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
