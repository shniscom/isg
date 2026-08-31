import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Card, Button, Input, Select, Textarea, Alert, Badge } from '../../components/ui';
import { EmployeeCombobox } from '../../components/EmployeeCombobox';

const COMPANY_TYPE_LABELS = {
  ANA_FIRMA: 'Ana Firma',
  ALT_ISVEREN: 'Alt İşveren',
  TASERON: 'Taşeron',
  UCUNCU_SAHIS_HIZMET_VEREN: '3. Şahıs Hizmet Veren',
  TEDARIKCI: 'Tedarikçi',
  DIGER: 'Diğer',
};

const DANGER_CLASS_LABELS = { COK_TEHLIKELI: 'Çok Tehlikeli', TEHLIKELI: 'Tehlikeli', AZ_TEHLIKELI: 'Az Tehlikeli' };
const INCIDENT_TYPE_LABELS = { KAZA: 'Kaza', RAMAK_KALA: 'Ramak Kala' };
const DOC_TYPE_LABELS = { RISK_ANALIZI: 'Risk Analizi', ACIL_DURUM_EYLEM_PLANI: 'Acil Durum Eylem Planı' };
const PENALTY_STATUS_LABELS = { BEKLEMEDE: 'Onay Bekliyor', ONAYLANDI: 'Onaylandı', REDDEDILDI: 'Reddedildi' };
const PENALTY_STATUS_VARIANT = { BEKLEMEDE: 'warning', ONAYLANDI: 'success', REDDEDILDI: 'danger' };

const TABS = [
  { key: 'genel', label: 'Genel' },
  { key: 'roller', label: 'Roller & Ekipler' },
  { key: 'kaza', label: 'Kaza / Ramak Kala' },
  { key: 'belgeler', label: 'Belgeler' },
  { key: 'kurul', label: 'İSG Kurulu' },
  { key: 'ekipman', label: 'Ekipman' },
];

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('tr-TR');
}
function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('tr-TR');
}
function toInputDate(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

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
      onUploaded(data.key, file.name);
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

export function CompanyDetailPage() {
  const { id } = useParams();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('firma_yonetme');
  const [detail, setDetail] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [equipmentList, setEquipmentList] = useState(null);
  const [projectBlocks, setProjectBlocks] = useState([]);
  const [roleTypes, setRoleTypes] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [tab, setTab] = useState('genel');

  async function loadDetail() {
    try {
      const { data } = await apiClient.get(`/admin/companies/${id}`);
      setDetail(data);
      const empRes = await apiClient.get('/employees', { params: { projectId: data.company.projectId, companyId: id, status: 'active' } });
      setEmployees(empRes.data.employees);
      const blocksRes = await apiClient.get(`/admin/projects/${data.company.projectId}/blocks`);
      setProjectBlocks(blocksRes.data.blocks);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function loadEquipment() {
    try {
      const { data } = await apiClient.get('/admin/equipment', { params: { companyId: id } });
      setEquipmentList(data.equipment);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    loadDetail();
    loadEquipment();
    apiClient
      .get('/admin/company-role-types')
      .then(({ data }) => setRoleTypes(data.roleTypes))
      .catch(() => setRoleTypes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error && !detail) return <Alert>{error}</Alert>;
  if (!detail) return <p className="text-sm text-slate-500">Yükleniyor...</p>;

  const { company, blocks, roleAssignments, incidents, documents, boardMeetings, boardStatus, equipmentCount, mykStats, penalties } = detail;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/admin/firmalar" className="text-xs text-brand-700 hover:underline">
            ← Firmalar
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-800">{company.name}</h1>
          <p className="text-sm text-slate-500">{COMPANY_TYPE_LABELS[company.type]}</p>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 sm:flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${
              tab === t.key ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'genel' && (
        <GenelTab
          company={company}
          blocks={blocks}
          projectBlocks={projectBlocks}
          mykStats={mykStats}
          penalties={penalties}
          incidents={incidents}
          equipmentCount={equipmentCount}
          canManage={canManage}
          onUpdated={(c) => setDetail((d) => ({ ...d, company: c }))}
          onBlocksUpdated={(newBlocks) => setDetail((d) => ({ ...d, blocks: newBlocks }))}
          setError={setError}
          setNotice={setNotice}
        />
      )}
      {tab === 'roller' && (
        <RollerTab
          companyId={id}
          roles={roleAssignments}
          employees={employees}
          roleTypes={roleTypes}
          canManage={canManage}
          onChange={loadDetail}
          setError={setError}
          setNotice={setNotice}
        />
      )}
      {tab === 'kaza' && (
        <KazaTab companyId={id} incidents={incidents.recent} employees={employees} onChange={loadDetail} setError={setError} setNotice={setNotice} />
      )}
      {tab === 'belgeler' && (
        <BelgelerTab companyId={id} documents={documents} onChange={loadDetail} setError={setError} setNotice={setNotice} />
      )}
      {tab === 'kurul' && (
        <KurulTab companyId={id} meetings={boardMeetings} boardStatus={boardStatus} dangerClass={company.dangerClass} onChange={loadDetail} setError={setError} setNotice={setNotice} />
      )}
      {tab === 'ekipman' && (
        <EkipmanTab projectId={company.projectId} companyId={id} equipment={equipmentList} employees={employees} onChange={loadEquipment} setError={setError} setNotice={setNotice} />
      )}
    </div>
  );
}

function StatCard({ label, value, tone = 'default' }) {
  const tones = {
    default: 'bg-slate-50 text-slate-700',
    warning: 'bg-amber-50 text-amber-800',
    danger: 'bg-red-50 text-red-700',
    success: 'bg-emerald-50 text-emerald-700',
  };
  return (
    <div className={`rounded-xl p-4 ${tones[tone]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function GenelTab({ company, blocks, projectBlocks, mykStats, penalties, incidents, equipmentCount, canManage, onUpdated, onBlocksUpdated, setError, setNotice }) {
  const [form, setForm] = useState({ requiresBoard: company.requiresBoard, dangerClass: company.dangerClass || '' });
  const [saving, setSaving] = useState(false);
  const [blockIds, setBlockIds] = useState((blocks || []).map((b) => b.id));
  const [savingBlocks, setSavingBlocks] = useState(false);

  function toggleBlock(blockId) {
    setBlockIds((prev) => (prev.includes(blockId) ? prev.filter((id) => id !== blockId) : [...prev, blockId]));
  }

  async function handleSaveBlocks() {
    setSavingBlocks(true);
    setError(null);
    try {
      const { data } = await apiClient.patch(`/admin/companies/${company.id}`, { blockIds });
      if (data.queued) {
        setNotice('Bölge değişikliği admin onayına gönderildi. Admin onaylarsa uygulanacak.');
      } else {
        onBlocksUpdated((projectBlocks || []).filter((b) => blockIds.includes(b.id)));
        onUpdated(data.company);
        setNotice('Sorumlu bölgeler güncellendi.');
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSavingBlocks(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const { data } = await apiClient.patch(`/admin/companies/${company.id}`, {
        requiresBoard: form.requiresBoard,
        dangerClass: form.dangerClass || null,
      });
      if (data.queued) {
        setNotice('Firma düzenlemesi admin onayına gönderildi. Admin onaylarsa uygulanacak.');
      } else {
        onUpdated(data.company);
        setNotice('Firma bilgileri güncellendi.');
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const mykRatio = mykStats.total > 0 ? `${mykStats.withCertificate}/${mykStats.total}` : '0/0';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="MYK Belgeli Çalışan" value={mykRatio} tone={mykStats.withCertificate > 0 ? 'success' : 'default'} />
        <StatCard label="Kaza" value={incidents.counts.kazaCount} tone={incidents.counts.kazaCount > 0 ? 'danger' : 'default'} />
        <StatCard label="Ramak Kala" value={incidents.counts.ramakKalaCount} tone={incidents.counts.ramakKalaCount > 0 ? 'warning' : 'default'} />
        <StatCard label="Ekipman" value={equipmentCount} />
      </div>

      <Card>
        <h3 className="mb-3 font-semibold text-slate-800">Sorumlu Olduğu Bölgeler</h3>
        {!projectBlocks || projectBlocks.length === 0 ? (
          <p className="text-sm text-slate-500">Bu projede henüz bölge/blok tanımlanmamış - firma varsayılan olarak tüm proje kapsamında sorumlu sayılır.</p>
        ) : canManage ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Hiçbiri seçilmezse firma "Tüm Bölgeler"den sorumlu sayılır.</p>
            <div className="flex flex-wrap gap-2">
              {projectBlocks.map((b) => {
                const selected = blockIds.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => toggleBlock(b.id)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      selected ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-300 text-slate-600 hover:border-brand-300'
                    }`}
                  >
                    {selected ? '✓ ' : ''}
                    {b.name}
                  </button>
                );
              })}
            </div>
            <Button variant="secondary" onClick={handleSaveBlocks} disabled={savingBlocks}>
              {savingBlocks ? 'Kaydediliyor...' : 'Bölgeleri Kaydet'}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {blocks && blocks.length > 0 ? (
              blocks.map((b) => (
                <Badge key={b.id} variant="default">
                  📍 {b.name}
                </Badge>
              ))
            ) : (
              <Badge variant="default">📍 Tüm Bölgeler</Badge>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold text-slate-800">Ceza Durumu</h3>
        <div className="mb-3 flex flex-wrap gap-2">
          <Badge variant="warning">Onay Bekliyor – {penalties.counts.pending}</Badge>
          <Badge variant="success">Onaylandı – {penalties.counts.approved}</Badge>
          <Badge variant="danger">Reddedildi – {penalties.counts.rejected}</Badge>
        </div>
        <div className="space-y-2">
          {penalties.recent.length === 0 && <p className="text-sm text-slate-500">Ceza kaydı yok.</p>}
          {penalties.recent.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-slate-800">{p.employeeFullName}</span>
                <span className="ml-2 text-slate-500">{p.reason}</span>
              </div>
              <Badge variant={PENALTY_STATUS_VARIANT[p.status]}>{PENALTY_STATUS_LABELS[p.status]}</Badge>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 font-semibold text-slate-800">İSG Kurulu Ayarları</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              disabled={!canManage}
              checked={form.requiresBoard}
              onChange={(e) => setForm((f) => ({ ...f, requiresBoard: e.target.checked }))}
            />
            Bu firma için İSG kurulu kurulması gerekiyor
          </label>
          {form.requiresBoard && (
            <Select label="Tehlike Sınıfı" value={form.dangerClass} disabled={!canManage} onChange={(e) => setForm((f) => ({ ...f, dangerClass: e.target.value }))}>
              <option value="">Seçiniz</option>
              {Object.entries(DANGER_CLASS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
          {canManage && (
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function RollerTab({ companyId, roles, employees, roleTypes, canManage, onChange, setError, setNotice }) {
  const [showForm, setShowForm] = useState(false);
  const roleLabel = (key) => roleTypes.find((rt) => rt.key === key)?.label || key;
  const firmaRolleri = roleTypes.filter((rt) => rt.category === 'FIRMA_ROLU');
  const acilEkipleri = roleTypes.filter((rt) => rt.category === 'ACIL_EKIP');
  const [form, setForm] = useState({
    roleType: '',
    source: 'CALISAN',
    employeeId: '',
    outsideFullName: '',
    outsideCompanyName: '',
    outsideNationalId: '',
    outsidePhone: '',
    certificateNo: '',
    certificateClass: '',
    certificateStartDate: '',
    certificateEndDate: '',
  });
  const [submitting, setSubmitting] = useState(false);

  // Rol kataloğu yüklenince (veya değişince), formdaki seçili rolün hâlâ geçerli olduğundan
  // emin ol; değilse ilk seçeneğe düş - Görevler sayfasından yeni bir rol eklenip silinmiş
  // olabileceği için bu form aynı sekmede uzun süre açık kalırsa da tutarlı kalır.
  useEffect(() => {
    if (roleTypes.length === 0) return;
    if (!roleTypes.some((rt) => rt.key === form.roleType)) {
      setForm((f) => ({ ...f, roleType: roleTypes[0].key }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleTypes]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/admin/company-roles', { companyId, ...form });
      setShowForm(false);
      setForm((f) => ({ ...f, employeeId: '', outsideFullName: '', outsideCompanyName: '', outsideNationalId: '', outsidePhone: '', certificateNo: '', certificateClass: '', certificateStartDate: '', certificateEndDate: '' }));
      setNotice('Rol eklendi.');
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(roleId) {
    if (!window.confirm('Bu rol kaydı silinsin mi?')) return;
    try {
      await apiClient.delete(`/admin/company-roles/${roleId}`);
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  function RoleGroup({ title, types }) {
    const typeKeys = new Set(types.map((t) => t.key));
    const rows = roles.filter((r) => typeKeys.has(r.roleType));
    return (
      <Card>
        <h3 className="mb-3 font-semibold text-slate-800">{title}</h3>
        {rows.length === 0 && <p className="text-sm text-slate-500">Henüz kayıt yok.</p>}
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <Badge variant="purple">{roleLabel(r.roleType)}</Badge>
                  <span className="ml-2 font-medium text-slate-800">
                    {r.source === 'CALISAN' ? r.employeeFullName : r.outsideFullName}
                  </span>
                  {r.source === 'DISARIDAN' && r.outsideCompanyName && (
                    <span className="ml-1 text-xs text-slate-500">({r.outsideCompanyName})</span>
                  )}
                </div>
                {canManage && (
                  <button onClick={() => handleDelete(r.id)} className="text-xs text-red-600 hover:underline">
                    Sil
                  </button>
                )}
              </div>
              {(r.certificateNo || r.certificateClass || r.certificateStartDate) && (
                <div className="mt-1 text-xs text-slate-500">
                  {r.certificateNo && <>Belge No: {r.certificateNo} · </>}
                  {r.certificateClass && <>{r.certificateClass} · </>}
                  {r.certificateStartDate && <>{formatDate(r.certificateStartDate)} - {formatDate(r.certificateEndDate)}</>}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <RoleGroup title="Firma Rolleri" types={firmaRolleri} />
      <RoleGroup title="Acil Durum Ekipleri" types={acilEkipleri} />

      {!canManage ? null : !showForm ? (
        <Button variant="secondary" onClick={() => setShowForm(true)}>
          + Rol Ekle
        </Button>
      ) : (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Select label="Rol" value={form.roleType} onChange={(e) => setForm((f) => ({ ...f, roleType: e.target.value }))}>
              <optgroup label="Firma Rolleri">
                {firmaRolleri.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Acil Durum Ekipleri">
                {acilEkipleri.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            </Select>
            <Select label="Kaynak" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}>
              <option value="CALISAN">Firma çalışanlarından</option>
              <option value="DISARIDAN">Dışarıdan (OSGB vb.)</option>
            </Select>
            {form.source === 'CALISAN' ? (
              <div className="space-y-1.5">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Çalışan</span>
                <EmployeeCombobox employees={employees} value={form.employeeId} onChange={(id) => setForm((f) => ({ ...f, employeeId: id }))} />
              </div>
            ) : (
              <>
                <Input label="Ad Soyad" value={form.outsideFullName} onChange={(e) => setForm((f) => ({ ...f, outsideFullName: e.target.value }))} />
                <Input label="Firma (ör. OSGB adı)" value={form.outsideCompanyName} onChange={(e) => setForm((f) => ({ ...f, outsideCompanyName: e.target.value }))} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="T.C. Kimlik No" value={form.outsideNationalId} onChange={(e) => setForm((f) => ({ ...f, outsideNationalId: e.target.value }))} />
                  <Input label="Telefon" value={form.outsidePhone} onChange={(e) => setForm((f) => ({ ...f, outsidePhone: e.target.value }))} />
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Sertifika/Belge No" value={form.certificateNo} onChange={(e) => setForm((f) => ({ ...f, certificateNo: e.target.value }))} />
              <Input label="Sınıf (ör. B Sınıfı)" value={form.certificateClass} onChange={(e) => setForm((f) => ({ ...f, certificateClass: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Sertifika Başlangıç" type="date" value={form.certificateStartDate ? toInputDate(form.certificateStartDate) : ''} onChange={(e) => setForm((f) => ({ ...f, certificateStartDate: e.target.value }))} />
              <Input label="Sertifika Bitiş" type="date" value={form.certificateEndDate ? toInputDate(form.certificateEndDate) : ''} onChange={(e) => setForm((f) => ({ ...f, certificateEndDate: e.target.value }))} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Ekleniyor...' : 'Ekle'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Vazgeç
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function KazaTab({ companyId, incidents, employees, onChange, setError, setNotice }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    type: 'KAZA',
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
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.eventDateTime || !form.eventDescription) {
      setError('Olay tarihi ve olay şekli açıklaması zorunludur.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/admin/incidents', {
        companyId,
        ...form,
        eventDateTime: new Date(form.eventDateTime).toISOString(),
        returnToWorkDate: form.returnToWorkDate ? new Date(form.returnToWorkDate).toISOString() : null,
        reportDaysOff: form.reportDaysOff ? Number(form.reportDaysOff) : null,
        employeeId: form.employeeId || null,
        witnessEmployeeId: form.witnessEmployeeId || null,
      });
      setShowForm(false);
      setNotice('Kayıt eklendi.');
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {incidents.length === 0 && <p className="text-sm text-slate-500">Kaza/ramak kala kaydı yok.</p>}
        {incidents.map((inc) => (
          <Card key={inc.id}>
            <div className="flex items-center gap-2">
              <Badge variant={inc.type === 'KAZA' ? 'danger' : 'warning'}>{INCIDENT_TYPE_LABELS[inc.type]}</Badge>
              <span className="text-xs text-slate-500">{formatDateTime(inc.eventDateTime)}</span>
            </div>
            <p className="mt-1 text-sm text-slate-700">{inc.eventDescription}</p>
            {inc.employeeFullName && <p className="mt-1 text-xs text-slate-500">Çalışan: {inc.employeeFullName}</p>}
            {inc.reportDaysOff != null && <p className="text-xs text-slate-500">Rapor: {inc.reportDaysOff} gün</p>}
          </Card>
        ))}
      </div>

      {!showForm ? (
        <Button variant="secondary" onClick={() => setShowForm(true)}>
          + Kaza / Ramak Kala Ekle
        </Button>
      ) : (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Select label="Tür" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              <option value="KAZA">Kaza</option>
              <option value="RAMAK_KALA">Ramak Kala</option>
            </Select>
            <Input label="Olay Tarihi/Saati" type="datetime-local" value={form.eventDateTime} onChange={(e) => setForm((f) => ({ ...f, eventDateTime: e.target.value }))} required />
            <Textarea label="Olay Şekli" value={form.eventDescription} onChange={(e) => setForm((f) => ({ ...f, eventDescription: e.target.value }))} required />
            <Input label="Olay Yeri" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            <Textarea label="Sebebi" value={form.cause} onChange={(e) => setForm((f) => ({ ...f, cause: e.target.value }))} />
            {form.type === 'KAZA' && (
              <>
                <div className="space-y-1.5">
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">Kazayı Geçiren Çalışan</span>
                  <EmployeeCombobox employees={employees} value={form.employeeId} onChange={(id) => setForm((f) => ({ ...f, employeeId: id }))} />
                </div>
                <Input label="Kazazedenin Mesleği" value={form.victimProfession} onChange={(e) => setForm((f) => ({ ...f, victimProfession: e.target.value }))} />
              </>
            )}
            <div className="space-y-1.5">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Görgü Tanığı</span>
              <EmployeeCombobox
                employees={employees}
                value={form.witnessEmployeeId}
                onChange={(id) => setForm((f) => ({ ...f, witnessEmployeeId: id }))}
                placeholder="Yok - isim veya TC no yazarak arayın..."
              />
            </div>
            {form.witnessEmployeeId && (
              <Textarea label="Görgü Tanığı İfadesi" value={form.witnessStatement} onChange={(e) => setForm((f) => ({ ...f, witnessStatement: e.target.value }))} />
            )}
            {form.type === 'KAZA' && (
              <>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.referredToHospital} onChange={(e) => setForm((f) => ({ ...f, referredToHospital: e.target.checked }))} />
                  Hastaneye sevk edildi
                </label>
                {form.referredToHospital && (
                  <Input label="Sevk Edilen Hastane" value={form.hospitalName} onChange={(e) => setForm((f) => ({ ...f, hospitalName: e.target.value }))} />
                )}
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={form.firstAidGiven} onChange={(e) => setForm((f) => ({ ...f, firstAidGiven: e.target.checked }))} />
                  İlk yardım müdahalesi yapıldı
                </label>
                {form.firstAidGiven && (
                  <Input label="Kim Tarafından Yapıldı" value={form.firstAidGivenBy} onChange={(e) => setForm((f) => ({ ...f, firstAidGivenBy: e.target.value }))} />
                )}
                <SingleFileUploader label="Doktor Raporu (Görsel/PDF)" onUploaded={(key) => setForm((f) => ({ ...f, doctorReportPhotoKey: key }))} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Rapor (Gün)" type="number" min="0" value={form.reportDaysOff} onChange={(e) => setForm((f) => ({ ...f, reportDaysOff: e.target.value }))} />
                  <Input label="İşe Başlama Tarihi" type="date" value={form.returnToWorkDate} onChange={(e) => setForm((f) => ({ ...f, returnToWorkDate: e.target.value }))} />
                </div>
              </>
            )}
            <Textarea label="Alınan Aksiyon" value={form.actionsTaken} onChange={(e) => setForm((f) => ({ ...f, actionsTaken: e.target.value }))} />
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Ekleniyor...' : 'Kaydet'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Vazgeç
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function BelgelerTab({ companyId, documents, onChange, setError, setNotice }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ docType: 'RISK_ANALIZI', preparedDate: '', approved: false, approvedDate: '', validUntil: '', fileObjectKey: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/admin/company-documents', {
        companyId,
        ...form,
        preparedDate: form.preparedDate ? new Date(form.preparedDate).toISOString() : null,
        approvedDate: form.approvedDate ? new Date(form.approvedDate).toISOString() : null,
        validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : null,
      });
      setShowForm(false);
      setNotice('Belge eklendi.');
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(docId) {
    if (!window.confirm('Bu belge silinsin mi?')) return;
    try {
      await apiClient.delete(`/admin/company-documents/${docId}`);
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {documents.length === 0 && <p className="text-sm text-slate-500">Belge kaydı yok.</p>}
        {documents.map((d) => (
          <Card key={d.id}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="purple">{DOC_TYPE_LABELS[d.docType]}</Badge>
                <Badge variant={d.approved ? 'success' : 'warning'}>{d.approved ? 'Onaylı' : 'Onay Bekliyor'}</Badge>
              </div>
              <button onClick={() => handleDelete(d.id)} className="text-xs text-red-600 hover:underline">
                Sil
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Hazırlanma: {formatDate(d.preparedDate)} · Geçerlilik: {formatDate(d.validUntil)}
            </p>
            {d.fileViewUrl && (
              <a href={d.fileViewUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand-700 hover:underline">
                Dosyayı görüntüle
              </a>
            )}
          </Card>
        ))}
      </div>

      {!showForm ? (
        <Button variant="secondary" onClick={() => setShowForm(true)}>
          + Belge Ekle
        </Button>
      ) : (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Select label="Belge Türü" value={form.docType} onChange={(e) => setForm((f) => ({ ...f, docType: e.target.value }))}>
              {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Hazırlanma Tarihi" type="date" value={form.preparedDate} onChange={(e) => setForm((f) => ({ ...f, preparedDate: e.target.value }))} />
              <Input label="Geçerlilik Tarihi" type="date" value={form.validUntil} onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.approved} onChange={(e) => setForm((f) => ({ ...f, approved: e.target.checked }))} />
              Onaylandı
            </label>
            {form.approved && (
              <Input label="Onay Tarihi" type="date" value={form.approvedDate} onChange={(e) => setForm((f) => ({ ...f, approvedDate: e.target.value }))} />
            )}
            <SingleFileUploader onUploaded={(key) => setForm((f) => ({ ...f, fileObjectKey: key }))} />
            <Textarea label="Not" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Ekleniyor...' : 'Kaydet'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Vazgeç
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function KurulTab({ companyId, meetings, boardStatus, dangerClass, onChange, setError, setNotice }) {
  const [showForm, setShowForm] = useState(false);
  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [form, setForm] = useState({ meetingDate: '', periodLabel: defaultPeriod, isExtraordinary: false, attendanceFormFileKey: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.meetingDate) {
      setError('Toplantı tarihi zorunludur.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/admin/board-meetings', { companyId, ...form, meetingDate: new Date(form.meetingDate).toISOString() });
      setShowForm(false);
      setNotice('Toplantı kaydedildi.');
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(meetingId) {
    if (!window.confirm('Bu toplantı kaydı silinsin mi?')) return;
    try {
      await apiClient.delete(`/admin/board-meetings/${meetingId}`);
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      {!dangerClass ? (
        <Alert variant="info">Kurul periyodu takibi için "Genel" sekmesinden tehlike sınıfı seçilmelidir.</Alert>
      ) : (
        <Card>
          <h3 className="mb-3 font-semibold text-slate-800">{now.getFullYear()} Dönem Durumu ({DANGER_CLASS_LABELS[dangerClass]})</h3>
          <div className="space-y-2">
            {boardStatus.map((b) => (
              <div key={b.label} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span>{b.label}</span>
                <Badge variant={b.done ? 'success' : 'danger'}>{b.done ? 'Yapıldı' : 'Henüz Yapılmadı'}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {meetings.length === 0 && <p className="text-sm text-slate-500">Toplantı kaydı yok.</p>}
        {meetings.map((m) => (
          <Card key={m.id}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-800">{formatDate(m.meetingDate)}</span>
                <Badge variant="default">{m.periodLabel}</Badge>
                {m.isExtraordinary && <Badge variant="orange">Olağanüstü</Badge>}
              </div>
              <button onClick={() => handleDelete(m.id)} className="text-xs text-red-600 hover:underline">
                Sil
              </button>
            </div>
            {m.notes && <p className="mt-1 text-sm text-slate-600">{m.notes}</p>}
            {m.attendanceFormViewUrl && (
              <a href={m.attendanceFormViewUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-brand-700 hover:underline">
                Katılım formunu görüntüle
              </a>
            )}
          </Card>
        ))}
      </div>

      {!showForm ? (
        <Button variant="secondary" onClick={() => setShowForm(true)}>
          + Toplantı Ekle
        </Button>
      ) : (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input label="Toplantı Tarihi" type="date" value={form.meetingDate} onChange={(e) => setForm((f) => ({ ...f, meetingDate: e.target.value }))} required />
            <Input label="Dönem (YYYY-MM)" value={form.periodLabel} onChange={(e) => setForm((f) => ({ ...f, periodLabel: e.target.value }))} required />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.isExtraordinary} onChange={(e) => setForm((f) => ({ ...f, isExtraordinary: e.target.checked }))} />
              Olağanüstü toplantı
            </label>
            <SingleFileUploader label="İmzalı Katılım Formu (Görsel/PDF)" onUploaded={(key) => setForm((f) => ({ ...f, attendanceFormFileKey: key }))} />
            <Textarea label="Not" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Ekleniyor...' : 'Kaydet'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Vazgeç
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function EkipmanTab({ projectId, companyId, equipment, employees, onChange, setError, setNotice }) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    serialNumber: '',
    licenseNumber: '',
    periodicInspectionDate: '',
    periodicInspectionValidUntil: '',
    hasDamage: false,
    damageDescription: '',
    fitForUse: true,
    assignedTo: 'FIRMA',
    assignedEmployeeId: '',
    operatorSource: 'YOK',
    operatorEmployeeId: '',
    operatorOutsideFullName: '',
    operatorOutsideCompanyName: '',
    operatorOutsideNationalId: '',
    operatorOutsideSgkNo: '',
    operatorCertificateNo: '',
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name) {
      setError('Ekipman adı zorunludur.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post('/admin/equipment', { projectId, companyId, ...form });
      setShowForm(false);
      setNotice('Ekipman eklendi.');
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(equipmentId) {
    if (!window.confirm('Bu ekipman kaydı silinsin mi?')) return;
    try {
      await apiClient.delete(`/admin/equipment/${equipmentId}`);
      onChange();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {(!equipment || equipment.length === 0) && <p className="text-sm text-slate-500">Ekipman kaydı yok.</p>}
        {equipment?.map((eq) => (
          <Card key={eq.id}>
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-800">{eq.name}</span>
              <div className="flex items-center gap-2">
                <Badge variant={eq.fitForUse ? 'success' : 'danger'}>{eq.fitForUse ? 'Çalışmaya Uygun' : 'Uygun Değil'}</Badge>
                <button onClick={() => handleDelete(eq.id)} className="text-xs text-red-600 hover:underline">
                  Sil
                </button>
              </div>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {eq.serialNumber && <>Seri No: {eq.serialNumber} · </>}
              Periyodik Kontrol: {formatDate(eq.periodicInspectionDate)} → {formatDate(eq.periodicInspectionValidUntil)}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Zimmet: {eq.assignedTo === 'KISI' ? eq.assignedEmployeeName || '—' : 'Firma'} · Operatör:{' '}
              {eq.operatorSource === 'CALISAN' ? eq.operatorEmployeeId && employees.find((emp) => emp.id === eq.operatorEmployeeId)?.fullName : eq.operatorSource === 'DISARIDAN' ? `${eq.operatorOutsideFullName} (${eq.operatorOutsideCompanyName || 'Dışarıdan'})` : 'Yok'}
            </div>
            {eq.hasDamage && <p className="mt-1 text-xs text-red-600">Hasar/Eksiklik: {eq.damageDescription}</p>}
          </Card>
        ))}
      </div>

      {!showForm ? (
        <Button variant="secondary" onClick={() => setShowForm(true)}>
          + Ekipman Ekle
        </Button>
      ) : (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input label="Ekipman Adı/Tipi" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Seri No" value={form.serialNumber} onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))} />
              <Input label="Ruhsat No" value={form.licenseNumber} onChange={(e) => setForm((f) => ({ ...f, licenseNumber: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Periyodik Kontrol Tarihi" type="date" value={form.periodicInspectionDate} onChange={(e) => setForm((f) => ({ ...f, periodicInspectionDate: e.target.value }))} />
              <Input label="Geçerlilik Tarihi" type="date" value={form.periodicInspectionValidUntil} onChange={(e) => setForm((f) => ({ ...f, periodicInspectionValidUntil: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.hasDamage} onChange={(e) => setForm((f) => ({ ...f, hasDamage: e.target.checked }))} />
              Hasar/eksiklik var
            </label>
            {form.hasDamage && (
              <Textarea label="Hasar/Eksiklik Açıklaması" value={form.damageDescription} onChange={(e) => setForm((f) => ({ ...f, damageDescription: e.target.value }))} />
            )}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.fitForUse} onChange={(e) => setForm((f) => ({ ...f, fitForUse: e.target.checked }))} />
              Çalışmaya uygun
            </label>
            <Select label="Zimmet" value={form.assignedTo} onChange={(e) => setForm((f) => ({ ...f, assignedTo: e.target.value }))}>
              <option value="FIRMA">Firmaya zimmetli</option>
              <option value="KISI">Kişiye zimmetli</option>
            </Select>
            {form.assignedTo === 'KISI' && (
              <div className="space-y-1.5">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Zimmetli Kişi</span>
                <EmployeeCombobox
                  employees={employees}
                  value={form.assignedEmployeeId}
                  onChange={(id) => setForm((f) => ({ ...f, assignedEmployeeId: id }))}
                />
              </div>
            )}
            <Select label="Operatör" value={form.operatorSource} onChange={(e) => setForm((f) => ({ ...f, operatorSource: e.target.value }))}>
              <option value="YOK">Yok</option>
              <option value="CALISAN">Firma çalışanlarından</option>
              <option value="DISARIDAN">Dışarıdan</option>
            </Select>
            {form.operatorSource === 'CALISAN' && (
              <div className="space-y-1.5">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Operatör Çalışan</span>
                <EmployeeCombobox
                  employees={employees}
                  value={form.operatorEmployeeId}
                  onChange={(id) => setForm((f) => ({ ...f, operatorEmployeeId: id }))}
                />
              </div>
            )}
            {form.operatorSource === 'DISARIDAN' && (
              <>
                <Input label="Operatör Ad Soyad" value={form.operatorOutsideFullName} onChange={(e) => setForm((f) => ({ ...f, operatorOutsideFullName: e.target.value }))} />
                <Input label="Operatör Firması" value={form.operatorOutsideCompanyName} onChange={(e) => setForm((f) => ({ ...f, operatorOutsideCompanyName: e.target.value }))} />
                <div className="grid grid-cols-2 gap-3">
                  <Input label="T.C. Kimlik No" value={form.operatorOutsideNationalId} onChange={(e) => setForm((f) => ({ ...f, operatorOutsideNationalId: e.target.value }))} />
                  <Input label="SGK No" value={form.operatorOutsideSgkNo} onChange={(e) => setForm((f) => ({ ...f, operatorOutsideSgkNo: e.target.value }))} />
                </div>
              </>
            )}
            {form.operatorSource !== 'YOK' && (
              <Input label="Operatörlük Belge No" value={form.operatorCertificateNo} onChange={(e) => setForm((f) => ({ ...f, operatorCertificateNo: e.target.value }))} />
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Ekleniyor...' : 'Kaydet'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Vazgeç
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
